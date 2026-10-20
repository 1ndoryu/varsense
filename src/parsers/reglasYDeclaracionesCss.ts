/*
 * Extracción de reglas y declaraciones CSS con sus rangos en el documento
 * Usada por CssParser sobre el texto sin comentarios
 */

import {CssDeclaration, CssRule} from '@/types';
import {CoreRange, CoreTextDocument, createCoreRange, positionAtOffset} from '@/core/types';
import {extraerVariablesDeValor, esDefinicionVariable, extraerValorLimpio, crearUsosVariable} from './valueParser';

/*
 * Regex para encontrar bloques de reglas CSS
 * Captura selector y contenido entre llaves
 */
const RULE_REGEX = /([^{}]+)\{([^{}]*)\}/g;

/*
 * Regex para encontrar declaraciones CSS (propiedad: valor)
 */
const DECLARATION_REGEX = /([a-zA-Z-]+)\s*:\s*([^;]+);?/g;

/*
 * Regex para detectar comentarios CSS
 */
const COMMENT_REGEX = /\/\*[\s\S]*?\*\//g;

/*
 * Elimina comentarios del CSS y construye mapa de offsets
 */
export function eliminarComentarios(texto: string): string {
    let resultado = '';
    let ultimoFin = 0;
    let match: RegExpExecArray | null;

    COMMENT_REGEX.lastIndex = 0;

    while ((match = COMMENT_REGEX.exec(texto)) !== null) {
        /* Agregar texto antes del comentario */
        resultado += texto.slice(ultimoFin, match.index);

        /* Reemplazar comentario con espacios para mantener posiciones */
        resultado += ' '.repeat(match[0].length);

        ultimoFin = match.index + match[0].length;
    }

    resultado += texto.slice(ultimoFin);

    return resultado;
}

/*
 * Obtiene el offset original (con comentarios) desde offset sin comentarios
 */
export function obtenerOffsetOriginal(offsetSinComentarios: number): number {
    /* En esta implementación simplificada, los offsets se mantienen
       porque reemplazamos comentarios con espacios */
    return offsetSinComentarios;
}

/*
 * Crea un CoreRange desde offset y longitud
 */
export function crearRangoDesdeOffset(documento: CoreTextDocument, offset: number, longitud: number): CoreRange {
    const inicio = positionAtOffset(documento, offset);
    const fin = positionAtOffset(documento, offset + longitud);
    return { start: inicio, end: fin };
}

/*
 * Parsea las reglas CSS del documento
 */
export function parsearReglas(documento: CoreTextDocument, texto: string): CssRule[] {
    const reglas: CssRule[] = [];
    let match: RegExpExecArray | null;

    RULE_REGEX.lastIndex = 0;

    while ((match = RULE_REGEX.exec(texto)) !== null) {
        const selector = match[1].trim();
        const contenido = match[2];
        const inicioSelector = obtenerOffsetOriginal(match.index);

        const regla: CssRule = {
            selector,
            rangoSelector: crearRangoDesdeOffset(documento, inicioSelector, selector.length),
            declaraciones: parsearDeclaraciones(documento, contenido, match.index + match[1].length + 1)
        };

        reglas.push(regla);
    }

    return reglas;
}

/*
 * Parsea las declaraciones dentro de un bloque CSS
 */
export function parsearDeclaraciones(documento: CoreTextDocument, contenido: string, offsetBase: number): CssDeclaration[] {
    const declaraciones: CssDeclaration[] = [];
    let match: RegExpExecArray | null;

    DECLARATION_REGEX.lastIndex = 0;

    while ((match = DECLARATION_REGEX.exec(contenido)) !== null) {
        const propiedad = match[1].trim();
        const offsetPropiedad = obtenerOffsetOriginal(offsetBase + match.index);
        const valorRaw = match[2];
        const indiceValorEnMatch = match[0].indexOf(valorRaw);
        const espaciosInicioValor = valorRaw.search(/\S|$/);
        const valor = extraerValorLimpio(valorRaw);

        /* Offset real del inicio del valor dentro del documento */
        const offsetValor = offsetBase + match.index + indiceValorEnMatch + espaciosInicioValor;
        const posPropiedad = positionAtOffset(documento, offsetPropiedad);
        let rangoValor = crearRangoDesdeOffset(documento, offsetValor, valor.length);

        /*
         * Corrección de precisión: si el valor no es multilínea, forzar el rango
         * a la misma línea de la propiedad para evitar subrayado desplazado.
         */
        if (!valor.includes('\n') && rangoValor.start.line !== posPropiedad.line) {
            const textoLinea = documento.lineAt(posPropiedad.line).text;
            const desdeColumna = Math.max(0, posPropiedad.character + propiedad.length);
            const indiceEnLinea = textoLinea.indexOf(valor, desdeColumna);

            if (indiceEnLinea >= 0) {
                rangoValor = createCoreRange(
                    posPropiedad.line,
                    indiceEnLinea,
                    posPropiedad.line,
                    indiceEnLinea + valor.length
                );
            }
        }

        /* Extraer variables usadas en el valor */
        const variablesMatch = extraerVariablesDeValor(valor);
        const posValor = positionAtOffset(documento, offsetValor);

        const variablesUsadas = crearUsosVariable(variablesMatch, documento, posValor.line, posValor.character, valor);

        declaraciones.push({
            propiedad,
            valor,
            rangoPropiedad: crearRangoDesdeOffset(documento, offsetPropiedad, propiedad.length),
            rangoValor,
            variablesUsadas,
            esDefinicionVariable: esDefinicionVariable(propiedad)
        });
    }

    return declaraciones;
}
