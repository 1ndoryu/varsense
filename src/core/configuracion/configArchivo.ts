import { VarsenseConfigFile, validateVarsenseConfig } from './config';

/* Interpreta el texto de varsense.config.json. El core no lee disco: la lectura
 * vive en src/node/configArchivo.ts, y la CLI y el LSP usan ambas piezas igual.
 * `origen` (la ruta del fichero) va delante de cada error para que el usuario sepa dónde mirar. */
export function interpretarVarsenseConfig(raw: string, origen = 'varsense.config.json'): VarsenseConfigFile {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`${origen}: JSON no válido: ${(error as Error).message}`);
    }
    validateVarsenseConfig(parsed, origen);
    return parsed;
}
