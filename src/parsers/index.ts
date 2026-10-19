/* [V4-P] Adapter del puerto ParserVarsense (src/core/puertoParsers.ts). Quien compone
 * (CLI, LSP, extension, tests) importa `parserCssVarsense` y lo pasa al core. */

import type { ParserVarsense } from '@/core/puertoParsers';
import { parsearDefiniciones, parsearDefinicionesRuntime, parsearDocumento } from './cssParser';
import { REGEX_ATRIBUTO_ESTILO, clavesDeExpresionEstilo, esSoloDefinicionTokens, finExpresionEstilo } from './estiloInline';

export const parserCssVarsense: ParserVarsense = {
    parsearDocumento,
    parsearDefiniciones,
    parsearDefinicionesRuntime,
    estilo: {
        regexAtributo: REGEX_ATRIBUTO_ESTILO,
        finExpresion: finExpresionEstilo,
        clavesDeExpresion: clavesDeExpresionEstilo,
        esSoloDefinicionTokens,
    },
};
