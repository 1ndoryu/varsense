/*
 * Runner de tests sin VS Code: empaqueta cada suite con esbuild (resuelve @/) y la ejecuta con mocha.
 * Una suite que importa 'vscode', directa o indirectamente, no puede correr fuera del host:
 * se omite y se lista. Esas suites corren en `npm test`.
 */

import * as esbuild from 'esbuild';
import Mocha from 'mocha';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { aliasPlugin } from './alias-esbuild.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const carpetaTests = path.join(raiz, 'src', 'test');
const salida = path.join(raiz, 'dist', 'test', 'unit');

/* Lista los archivos *.test.ts de forma recursiva */
function buscarTests(directorio) {
    return fs.readdirSync(directorio, { withFileTypes: true }).flatMap(entrada => {
        const ruta = path.join(directorio, entrada.name);
        if (entrada.isDirectory()) {
            return buscarTests(ruta);
        }
        return entrada.name.endsWith('.test.ts') ? [ruta] : [];
    });
}

/* Ruta de salida del bundle de un test */
function destinoDe(archivo) {
    return path.join(salida, path.relative(carpetaTests, archivo)).replace(/\.ts$/, '.js');
}

/* Empaqueta un test; devuelve true si no depende de 'vscode' */
async function empaquetar(archivo) {
    const destino = destinoDe(archivo);
    const { metafile } = await esbuild.build({
        entryPoints: [archivo],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: destino,
        external: ['vscode'],
        plugins: [aliasPlugin],
        metafile: true,
        logLevel: 'silent',
    });

    const usaVscode = Object.values(metafile.outputs)
        .some(salidaArchivo => salidaArchivo.imports.some(imp => imp.path === 'vscode'));

    if (usaVscode) {
        fs.rmSync(destino, { force: true });
    }
    return !usaVscode;
}

async function main() {
    fs.rmSync(salida, { recursive: true, force: true });

    const incluidos = [];
    const omitidos = [];
    for (const archivo of buscarTests(carpetaTests)) {
        (await empaquetar(archivo) ? incluidos : omitidos).push(destinoDe(archivo));
    }

    if (omitidos.length > 0) {
        console.log(`Omitidos (requieren VS Code, se ejecutan con npm test): ${omitidos.map(f => path.relative(salida, f)).join(', ')}`);
    }
    if (incluidos.length === 0) {
        throw new Error('No hay tests sin VS Code que ejecutar.');
    }

    const mocha = new Mocha({ ui: 'tdd', timeout: 10000, reporter: 'spec' });
    incluidos.forEach(archivo => mocha.addFile(archivo));

    /* Fallos de mocha → rc 1 para que pretest y CI lo vean */
    await new Promise(resolve => mocha.run(fallos => {
        process.exitCode = fallos > 0 ? 1 : 0;
        resolve();
    }));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
