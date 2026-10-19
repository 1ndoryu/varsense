/*
 * Plugin de esbuild que resuelve el alias @/ -> src/ (equivalente a paths de tsconfig.json).
 * Lo comparten el bundle de extensión, CLI y LSP (esbuild.config.mjs) y el runner de tests sin VS Code.
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const aliasPlugin = {
    name: 'alias-path',
    setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => {
            const basePath = path.resolve(raiz, args.path.replace(/^@\//, 'src/'));

            /* Primero el archivo, luego el index del directorio */
            const candidatos = [`${basePath}.ts`, path.join(basePath, 'index.ts')];
            const encontrado = candidatos.find(candidato => fs.existsSync(candidato));

            return { path: encontrado ?? basePath };
        });
    }
};
