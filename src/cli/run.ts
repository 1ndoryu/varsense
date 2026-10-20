/* Ejecución de la CLI: parsea argumentos, ejecuta el análisis y escribe la salida.
 * Sin efectos al importar; el arranque como binario vive en main.ts. */

import { conTiempoLimite } from '@/core/analisis/limites';
import { parseCliArgs, usage } from './args';
import { analyzeCliTarget } from './analisis/objetivos';
import { avisarOmitidos, renderOutput, writeOrPrint } from './salida';
import { readPackageVersion } from './version';

export async function runCli(rawArgs: string[]): Promise<number> {
    if (rawArgs.length === 1 && (rawArgs[0] === '--help' || rawArgs[0] === '-h')) {
        process.stdout.write(`${usage()}\n`);
        return 0;
    }
    if (rawArgs.length === 1 && rawArgs[0] === '--version') {
        process.stdout.write(`${await readPackageVersion()}\n`);
        return 0;
    }
    const args = parseCliArgs(rawArgs);
    if (args.ayuda) {
        process.stdout.write(`${usage()}\n`);
        return 0;
    }
    /* [V7] El límite cancela el token: el análisis se detiene en su siguiente punto de control. El punto de entrada cierra el proceso si queda algo síncrono. */
    const result = await conTiempoLimite(token => analyzeCliTarget(args, token), args.timeoutMs);
    avisarOmitidos(result.omitidosPorTamano, args.workspacePath);
    await writeOrPrint(renderOutput(result, args, await readPackageVersion()), args.outputPath);
    return result.hasErrors ? 1 : 0;
}
