/* [V4-P] Puerto de parsing: el core declara QUE necesita del parser CSS y el adapter
 * `src/parsers/` lo implementa. Gotcha: el core no importa `@/parsers`; quien compone
 * (CLI, LSP, extension, tests) pasa la implementacion, asi el core sigue agnostico. */

import type { CssVariable, ParseResult } from '@/types';
import type { CoreTextDocument } from './types';

/* Opciones del parser CSS: decide que propiedades y valores se marcan. */
export interface OpcionesParserCss {
    debeVerificarPropiedad?: (propiedad: string) => boolean;
    esValorPermitido?: (valor: string) => boolean;
    propiedadesProhibidas?: {
        habilitado: boolean;
        propiedades: string[];
    };
}

/* Clave de nivel superior de un objeto `style={{...}}` con su offset en el texto. */
export interface ClaveEstiloPuerto {
    texto: string;
    offset: number;
}

/* Reconocimiento del atributo `style={...}` de JSX (lo usan el core y el parser CSS). */
export interface ReconocedorEstilo {
    /* Global: el llamador reinicia `lastIndex` antes de recorrerlo. */
    readonly regexAtributo: RegExp;
    finExpresion(texto: string, inicioLlave: number): number;
    clavesDeExpresion(texto: string, inicioLlave: number, fin: number): ClaveEstiloPuerto[];
    esSoloDefinicionTokens(claves: ClaveEstiloPuerto[]): boolean;
}

export interface ParserVarsense {
    parsearDocumento(documento: CoreTextDocument, opciones?: OpcionesParserCss): ParseResult;
    parsearDefiniciones(documento: CoreTextDocument): CssVariable[];
    parsearDefinicionesRuntime(documento: CoreTextDocument): CssVariable[];
    readonly estilo: ReconocedorEstilo;
}
