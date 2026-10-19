/*
 * Script para ejecutar tests de la extensión
 * Workaround para rutas con espacios: copiar la extensión a directorio temporal
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

/* Función para copiar directorio recursivamente */
function copyDirSync(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        /* Excluir node_modules y .vscode-test para acelerar copia */
        if (entry.name === 'node_modules' || entry.name === '.vscode-test' || entry.name === '.git') {
            continue;
        }

        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

async function main() {
    /* Directorio temporal fuera del try: hay que limpiarlo pase lo que pase */
    const tempBase = path.join(os.tmpdir(), 'vscode-test-cssvar');
    /* Borrar restos de una corrida anterior que murió sin limpiar */
    fs.rmSync(tempBase, { recursive: true, force: true });

    try {
        /* 
         * Ruta original de la extensión (puede contener espacios)
         */
        const originalExtensionPath = path.resolve(__dirname, '../..');
        
        /* 
         * Crear directorio temporal sin espacios para la extensión
         */
        const tempExtensionPath = path.join(tempBase, 'extension');
        const tempTestsPath = path.join(tempExtensionPath, 'dist', 'test', 'suite', 'index.js');
        const userDataDir = path.join(tempBase, 'user-data');
        const extensionsDir = path.join(tempBase, 'extensions');

        /* Crear directorios */
        [userDataDir, extensionsDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });

        /* Copiar extensión a directorio temporal */
        console.log('Copiando extensión a directorio temporal...');
        console.log('De:', originalExtensionPath);
        console.log('A:', tempExtensionPath);
        
        /* Limpiar directorio temporal si existe */
        if (fs.existsSync(tempExtensionPath)) {
            fs.rmSync(tempExtensionPath, { recursive: true, force: true });
        }
        
        copyDirSync(originalExtensionPath, tempExtensionPath);
        
        /* También copiar node_modules (necesario para tests) */
        const nodeModulesSrc = path.join(originalExtensionPath, 'node_modules');
        const nodeModulesDest = path.join(tempExtensionPath, 'node_modules');
        if (fs.existsSync(nodeModulesSrc)) {
            copyDirSync(nodeModulesSrc, nodeModulesDest);
        }

        /* Verificar que las rutas son válidas */
        console.log('Extension path:', tempExtensionPath);
        console.log('Tests path:', tempTestsPath);

        /* Descargar VS Code en ubicación temporal sin espacios */
        const vscodeExecutablePath = await downloadAndUnzipVSCode({
            cachePath: tempBase
        });

        console.log('VS Code executable:', vscodeExecutablePath);

        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath: tempExtensionPath,
            extensionTestsPath: tempTestsPath,
            launchArgs: [
                '--disable-extensions',
                '--disable-gpu',
                '--no-sandbox',
                `--user-data-dir=${userDataDir}`,
                `--extensions-dir=${extensionsDir}`
            ]
        });
    } catch (err) {
        console.error('Error ejecutando tests:', err);
        /* No usar process.exit: aborta sin ejecutar el finally que limpia el temporal */
        process.exitCode = 1;
    } finally {
        /* Borrar siempre el temporal: VS Code descargado + copia de la extensión superan 1 GB */
        fs.rmSync(tempBase, { recursive: true, force: true });
    }
}

main();
