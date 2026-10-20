import { VarsenseConfigFile, validateVarsenseConfig } from './config';

/* Interpreta el texto de varsense.config.json. El core no lee disco: la lectura
 * vive en src/node/configArchivo.ts, y la CLI y el LSP usan ambas piezas igual. */
export function interpretarVarsenseConfig(raw: string): VarsenseConfigFile {
    const parsed: unknown = JSON.parse(raw);
    validateVarsenseConfig(parsed);
    return parsed;
}
