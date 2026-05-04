/*
 * Runner de tests para la extensión
 */

import * as path from 'path';
import Mocha from 'mocha';
import glob from 'glob';

/* [045A-1] Los tests se compilan con tsc, asi que los imports @/... quedan como require('@/...').
 * El bundle de la extension si resuelve alias con esbuild, pero la suite necesita este puente runtime. */
const Module = require('module') as {
    _resolveFilename: (request: string, ...args: unknown[]) => string;
};
const originalResolveFilename = Module._resolveFilename;
const distRoot = path.resolve(__dirname, '../..');

Module._resolveFilename = function resolverAliasVarSense(
    request: string,
    ...args: unknown[]
): string {
    if (request.startsWith('@/')) {
        const resolvedRequest = path.join(distRoot, request.slice(2));
        return originalResolveFilename.call(this, resolvedRequest, ...args) as string;
    }

    return originalResolveFilename.call(this, request, ...args) as string;
};

export function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 10000
    });

    const testsRoot = path.resolve(__dirname, '..');

    /* Buscar archivos de test usando glob.sync */
    const files = glob.sync('**/**.test.js', { cwd: testsRoot });
    
    /* Agregar archivos de test */
    files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

    return new Promise((resolve, reject) => {
        try {
            /* Ejecutar tests */
            mocha.run(failures => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests fallaron.`));
                } else {
                    resolve();
                }
            });
        } catch (error) {
            console.error(error);
            reject(error);
        }
    });
}
