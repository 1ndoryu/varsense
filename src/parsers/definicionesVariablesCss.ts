/*
 * Definiciones de variables CSS y en runtime (setProperty y style JSX)
 * Usada por CssParser sobre el texto sin comentarios
 */

import {CssVariable} from '@/types';
import {CoreTextDocument, positionAtOffset} from '@/core/types';
import {extraerValorLimpio} from './valueParser';
import {REGEX_ATRIBUTO_ESTILO, clavesDeExpresionEstilo, finExpresionEstilo, nombreCustomProperty} from './estiloInline';
import {buscarAmbitoInnermost, mapearAmbitosBloques} from './cssAmbitos';
import {esColor} from '@/utils/color/colorUtils';

/*
 * Parsea solo las definiciones de variables del documento
 * Versión optimizada para escaneo inicial
 */
export function parsearSoloDefinicionesCss(documento: CoreTextDocument, texto: string): CssVariable[] {
    const variables: CssVariable[] = [];
    /* [FIX-fantasma] Buscar definiciones sobre el texto sin comentarios
     * (offsets preservados por relleno con espacios): `.boton--primario:hover`
     * en prosa casa `--primario` + `:` y el valor se extendia hasta el `;`
     * siguiente fuera del comentario -> token-unused fantasma (caso TASKS
     * --primario en modalCreacionRapida.css:92 y accionesItem.css:29). */
    const ambitos = mapearAmbitosBloques(texto);

    /* Regex optimizada para buscar solo definiciones de variables */
    const varDefRegex = /(--[\w-]+)\s*:\s*([^;{}]+);/g;
    let match: RegExpExecArray | null;

    while ((match = varDefRegex.exec(texto)) !== null) {
        const posicion = positionAtOffset(documento, match.index);
        const valorLimpio = extraerValorLimpio(match[2]);

        variables.push({
            nombre: match[1],
            valor: valorLimpio,
            archivo: documento.fileName,
            linea: posicion.line,
            columna: posicion.character,
            esColor: esColor(valorLimpio),
            frecuenciaUso: 0,
            /* [229A-1] Ambito de cascada: dos definiciones con el mismo
             * valor en ambitos distintos son shadowing intencional. */
            ambito: buscarAmbitoInnermost(ambitos, match.index)
        });
    }

    return variables;
}

/*
 * [318A-7V24] Parsea definiciones de variables en runtime: llamadas
 * `algo.setProperty('--x', valor)` en TS/JS. El primer argumento literal
 * '--x' define la variable aunque ningún CSS la declare (patrón habitual
 * en GH: panelDerechoAncho.ts, panelEntrada.ts, barraLateral.ts...).
 * Solo literales quoted (incluye backtick sin interpolación: el nombre
 * queda cerrado por el backtick antes de cualquier ${...}); si el nombre
 * es dinámico no se puede indexar y se ignora. El valor runtime es
 * desconocido: se registra como '' (no color) para que la definición
 * exista en el índice.
 *
 * [15A-25] Cubre ademas las claves de un `style={{...}}` de JSX, que es la
 * otra forma de definir tokens en runtime y la dominante en KAMPLES: los
 * `--top`, `--notaTop`, `--tecladoAncho` de las hojas se declaran asi en el
 * TSX. Sin indexarlas, cada `var()` que las consume salia como
 * `variableNoDefinida`. Se indexa la clave aunque el objeto mezcle
 * propiedades reales: la custom property existe en runtime igual, y el
 * estilo inline mixto lo reporta `cssInlineReact` por su cuenta.
 */
export function parsearDefinicionesRuntimeCss(documento: CoreTextDocument, texto: string): CssVariable[] {
    const variables: CssVariable[] = [];
    /* [FIX-fantasma] Igual que en parsearSoloDefinicionesCss: un
     * `.setProperty('--x', ...)` mencionado en un comentario de bloque no
     * define nada (caso --fantasma). No se tocan comentarios de linea `//`
     * (riesgo con `https://` en strings): limitacion documentada.
     * `eliminarComentarios` sustituye cada comentario por espacios de la
     * misma longitud, de modo que los offsets siguen siendo validos. */
    const runtimeDefRegex = /\.setProperty\s*\(\s*(['"`])--([\w-]+)\1/g;
    let match: RegExpExecArray | null;

    const registrar = (nombre: string, offset: number): void => {
        const posicion = positionAtOffset(documento, offset);
        variables.push({
            nombre,
            valor: '',
            archivo: documento.fileName,
            linea: posicion.line,
            columna: posicion.character,
            esColor: false,
            frecuenciaUso: 0
        });
    };

    while ((match = runtimeDefRegex.exec(texto)) !== null) {
        registrar(`--${match[2]}`, match.index);
    }

    REGEX_ATRIBUTO_ESTILO.lastIndex = 0;
    while ((match = REGEX_ATRIBUTO_ESTILO.exec(texto)) !== null) {
        const inicioLlave = match.index + match[0].length - 1;
        const fin = finExpresionEstilo(texto, inicioLlave);
        for (const clave of clavesDeExpresionEstilo(texto, inicioLlave, fin)) {
            const nombre = nombreCustomProperty(clave);
            if (nombre) {
                registrar(nombre, clave.offset);
            }
        }
    }

    return variables;
}
