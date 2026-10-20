/* [V6] Lectura y validación de argumentos de la CLI. Vive aparte de index.ts para mantener ese módulo bajo el límite de líneas. */
import * as path from 'path';
import { TIMEOUT_CLI_POR_DEFECTO_MS } from '@/core/analisis/limites';

export type VarsenseCliCommand = 'scan' | 'orphan-classes' | 'all';
export type VarsenseCliFormat = 'markdown' | 'json';

export interface ParsedCliArgs {
    command: VarsenseCliCommand;
    workspacePath: string;
    format: VarsenseCliFormat;
    outputPath?: string;
    configPath?: string;
    filesFromPath?: string;
    indexDir?: string;
    /* [V7] Límite de tiempo del análisis en milisegundos; 0 lo desactiva. */
    timeoutMs: number;
    /* [V10] --help en cualquier posición: se pide la ayuda, no es un error de uso. */
    ayuda?: boolean;
}

export function usage(): string {
    return [
        'Uso:',
        '  varsense scan --workspace . --format markdown --output .varsense-report.md',
        '  varsense orphan-classes --workspace . --format json',
        '  varsense all --workspace . --format json',
        '  varsense --version',
        '',
        'Opciones:',
        '  --workspace <path>  Analiza un workspace. Por defecto: cwd',
        '  --format <type>     markdown | json. Por defecto: markdown',
        '  --output <path>     Escribe salida en archivo; si falta, imprime en stdout',
        '  --config <path>     Carga varsense.config.json',
        '  --files-from <path> Limita los archivos reportados a un manifiesto relativo',
        '  --index-dir <path>  Guarda el índice entre ejecuciones en ese directorio',
        '  --timeout <segundos> Límite de tiempo del análisis. 0 lo desactiva. Por defecto: 600',
        '  --help, -h          Muestra esta ayuda',
        '  --version           Muestra la version instalada',
        '',
        'Códigos de salida:',
        '  0  sin errores',
        '  1  hay hallazgos de severidad error',
        '  2  uso incorrecto, --config inexistente o tiempo agotado',
    ].join('\n');
}

function takeValue(args: string[], index: number, option: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`Falta valor para ${option}`);
    }
    return value;
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
    const command = args[0];
    if (command !== 'scan' && command !== 'orphan-classes' && command !== 'all') {
        // Un comando desconocido no imprime toda la ayuda: basta con indicar cómo verla.
        throw new Error(`Comando no reconocido: ${command ?? '(ninguno)'}. Ejecuta con --help para ver el uso.`);
    }

    const parsed: ParsedCliArgs = {
        command,
        workspacePath: process.cwd(),
        format: 'markdown',
        timeoutMs: TIMEOUT_CLI_POR_DEFECTO_MS,
    };

    for (let index = 1; index < args.length; index++) {
        const arg = args[index];

        switch (arg) {
            case '--workspace':
                parsed.workspacePath = takeValue(args, index, arg);
                index++;
                break;
            case '--format': {
                const value = takeValue(args, index, arg);
                if (value !== 'markdown' && value !== 'json') {
                    throw new Error('--format debe ser markdown o json');
                }
                parsed.format = value;
                index++;
                break;
            }
            case '--output':
                parsed.outputPath = takeValue(args, index, arg);
                index++;
                break;
            case '--config':
                parsed.configPath = takeValue(args, index, arg);
                index++;
                break;
            case '--files-from':
                parsed.filesFromPath = takeValue(args, index, arg);
                index++;
                break;
            case '--index-dir':
                parsed.indexDir = takeValue(args, index, arg);
                index++;
                break;
            case '--timeout': {
                const segundos = Number(takeValue(args, index, arg));
                if (!Number.isInteger(segundos) || segundos < 0) {
                    throw new Error('--timeout debe ser un entero de segundos >= 0 (0 desactiva el límite)');
                }
                parsed.timeoutMs = segundos * 1000;
                index++;
                break;
            }
            case '--help':
            case '-h':
                // Se corta aquí: lo que venga después no se valida si se pidió ayuda.
                parsed.ayuda = true;
                return parsed;
            default:
                // Mismo formato que el comando desconocido: el error indica cómo ver la ayuda, sin volcarla entera.
                throw new Error(`Opcion no reconocida: ${arg}. Ejecuta con --help para ver el uso.`);
        }
    }

    parsed.workspacePath = path.resolve(parsed.workspacePath);
    return parsed;
}
