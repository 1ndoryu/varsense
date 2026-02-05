/*
 * Runner de tests para la extensión
 */

import * as path from 'path';
import Mocha from 'mocha';
import glob from 'glob';

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
