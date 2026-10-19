#!/usr/bin/env node

/* Punto de entrada de la CLI: se compila a dist/cli/index.js (bin y scripts).
 * Re-exporta la API pública para que los tests y scripts importen el mismo bundle. */

import { TiempoAgotadoError } from '@/core/limites';
import { runCli } from './run';

export * from './index';

if (require.main === module) {
    runCli(process.argv.slice(2))
        .then(code => { process.exitCode = code; })
        .catch(error => {
            const mensaje = `${error instanceof Error ? error.message : String(error)}
`;
            process.exitCode = 2;
            if (error instanceof TiempoAgotadoError) {
                /* El análisis que excedió el tiempo sigue en curso y mantendría vivo el proceso. */
                process.stderr.write(mensaje, () => process.exit(2));
                return;
            }
            process.stderr.write(mensaje);
        });
}
