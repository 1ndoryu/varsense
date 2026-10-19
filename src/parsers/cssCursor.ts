/*
 * Consultas por posición del cursor: variable, propiedad y definición bajo el cursor.
 * Las usan hover y autocompletado; no depende de la ejecución del parser.
 */

import { CorePosition, CoreRange, CoreTextDocument, createCoreRange } from '@/core/types';

/*
 * Encuentra la variable bajo el cursor en un documento
 */
export function encontrarVariableEnPosicion(documento: CoreTextDocument, posicion: CorePosition): {nombre: string; rango: CoreRange} | null {
    const lineaTexto = documento.lineAt(posicion.line).text;

    /* Buscar var(--...) en la línea */
    const varRegex = /var\(\s*(--[\w-]+)\s*(?:,\s*[^)]+)?\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = varRegex.exec(lineaTexto)) !== null) {
        const inicio = match.index;
        const fin = inicio + match[0].length;

        /* Verificar si el cursor está dentro del match */
        if (posicion.character >= inicio && posicion.character <= fin) {
            /* Encontrar el rango exacto del nombre de la variable */
            const nombreInicio = lineaTexto.indexOf(match[1], inicio);
            const nombreFin = nombreInicio + match[1].length;

            return {
                nombre: match[1],
                rango: createCoreRange(posicion.line, nombreInicio, posicion.line, nombreFin)
            };
        }
    }

    /* También buscar definiciones de variables: --nombre: */
    const defRegex = /(--[\w-]+)\s*:/g;
    while ((match = defRegex.exec(lineaTexto)) !== null) {
        const inicio = match.index;
        const fin = inicio + match[1].length;

        if (posicion.character >= inicio && posicion.character <= fin) {
            return {
                nombre: match[1],
                rango: createCoreRange(posicion.line, inicio, posicion.line, fin)
            };
        }
    }

    return null;
}

/*
 * Obtiene la propiedad CSS en una posición del documento
 * Útil para autocompletado contextual
 */
export function obtenerPropiedadEnPosicion(documento: CoreTextDocument, posicion: CorePosition): string | null {
    const lineaTexto = documento.lineAt(posicion.line).text;

    /* Buscar propiedad: valor en la línea */
    const propRegex = /^\s*([a-zA-Z-]+)\s*:\s*/;
    const match = propRegex.exec(lineaTexto);

    if (match && posicion.character > lineaTexto.indexOf(':')) {
        return match[1];
    }

    return null;
}
