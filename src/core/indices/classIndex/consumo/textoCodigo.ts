/* Texto de código: quita comentarios y literales de regex, y ubica dónde empiezan las cadenas. Lo usan los extractores de consumo. */
import { memoPorFuente } from '../fuentes/memoFuente';

export function removeComments(texto: string): string {
    let result = '';
    let quote = '';
    let escaped = false;
    let comment = '';
    let regex = false;
    let inClass = false;
    let prevSig = '';
    /* [318A-7V22][M5] Un regex literal puede contener comillas o backticks
     * (`/[&<>"]/g`, `/`([^`]+)`/g` en useScratchpad.ts de un proyecto real): sin estado
     * regex, removeComments trataba esa comilla como apertura de string y
     * Todo el texto posterior del archivo quedaba "dentro de string" →
     * escanearDeclaraciones/escanearAsignacionesCompuestas saltaban los
     * `html +=` con clases reales (scratchpadVistaPrevia* seguían huérfanas)
     * por isCodeMatch. Aquí se reconoce un regex literal cuando el '/' NO va
     * precedido de algo que lo haga división (identificador, número, cierre
     * de bloque/llamada) y se consume hasta su '/' de cierre sin tratar las
     * comillas/backticks internas como strings (excepto dentro de [clase]).
     * El cuerpo del regex se conserva en la salida (es código, no comentario)
     * para no alterar índices: solo se evita que sus comillas abran string.
     * prevSig es el último carácter significativo (no-whitespace): con
     * espacios, `width / 2` sigue siendo división (prevSig='h') y no regex. */
    for (let index = 0; index < texto.length; index++) {
        const current = texto[index];
        const next = texto[index + 1] ?? '';

        if (comment === 'line') {
            result += current === '\n' ? '\n' : ' ';
            if (current === '\n') {comment = '';}
            continue;
        }
        if (comment === 'block') {
            result += current === '\n' ? '\n' : ' ';
            if (current === '*' && next === '/') {
                result += ' ';
                index++;
                comment = '';
            }
            continue;
        }

        if (regex) {
            /* Dentro de un regex literal: comillas/backticks NO abren string.
             * Se neutralizan EN LA SALIDA (emitidas como espacio, misma
             * longitud) para que los escáneres posteriores tampoco las vean
             * como apertura: `isInsideString`/`escanearAsignacionesCompuestas`
             * no conocen el estado regex y una comilla interna (`/[&<>"]/g`,
             * `/`([^`]+)`/g`) corrompía Todo el texto posterior del archivo
             * (los `html +=` con clases reales quedaban "dentro de string"). */
            result += (current === '"' || current === "'" || current === '`') ? ' ' : current;
            if (escaped) {
                escaped = false;
            } else if (current === '\\') {
                escaped = true;
            } else if (current === '[') {
                inClass = true;
            } else if (current === ']') {
                inClass = false;
            } else if (current === '/' && !inClass) {
                regex = false;
            }
            continue;
        }

        if (quote) {
            result += current;
            if (escaped) {
                escaped = false;
            } else if (current === '\\') {
                escaped = true;
            } else if (current === quote) {
                quote = '';
                prevSig = current;
            }
            continue;
        }

        if (current === '/' && next === '/') {
            result += '  ';
            index++;
            comment = 'line';
            continue;
        }
        if (current === '/' && next === '*') {
            result += '  ';
            index++;
            comment = 'block';
            continue;
        }
        /* [318A-7V22][M5] Inicio de regex literal SOLO tras un carácter que en
         * la práctica precede a un regex (whitelist): apertura de llamada/
         * array/objeto, asignación, coma, dos puntos, operadores. Un blacklist
         * era insuficiente: en TSX real el '/' de self-closing `<Tag "x" />`
         * va tras una comilla de cierre y disparaba un falso regex que se
         * tragaba el resto del archivo (medición de un proyecto real 156→419). NUNCA es regex
         * tras cierre de string/comilla (`"foo" / 2` = división), `) ] }`,
         * identificador, número, `<` (cierre etiqueta JSX) ni `>`. */
        if (current === '/' && /[=(,:;!?&|[+*%~^{]/.test(prevSig)) {
            /* Se consume hasta el cierre sin abrir strings por comillas
             * internas; las comillas/backticks del interior se neutralizan en
             * la salida (emitidas como espacio, misma longitud) para que los
             * escáneres posteriores tampoco las vean como apertura
             * (`isInsideString`/`escanearAsignacionesCompuestas` no conocen el
             * estado regex: `/[&<>"]/g` y `/`([^`]+)`/g` corrompían Todo el
             * texto posterior del archivo, dejando los `html +=` con clases
             * reales "dentro de string"). */
            regex = true;
            inClass = false;
            escaped = false;
            result += current;
            continue;
        }
        if (current === '"' || current === "'" || current === '`') {
            quote = current;
        }
        result += current;
        if (!/\s/.test(current)) {
            prevSig = current;
        }
    }
    return result;
}

/* Estado de cadena en cada posición de la fuente. Se calcula una sola vez por archivo:
 * recorrer la fuente desde el principio en cada match era O(matches × longitud) y
 * dominaba el escaneo (classIndexMs). La caché es por fuente, no de una sola entrada,
 * para que alternar entre archivos no la invalide. */
const mapasCadenas = new Map<string, Uint8Array>();

function mapaCadenas(source: string): Uint8Array {
    return memoPorFuente(mapasCadenas, source, calcularMapaCadenas);
}

function calcularMapaCadenas(source: string): Uint8Array {
    const mapa = new Uint8Array(source.length + 1);
    let quote = '';
    let escaped = false;
    for (let cursor = 0; cursor < source.length; cursor++) {
        mapa[cursor] = quote ? 1 : 0;
        const current = source[cursor];
        if (quote) {
            if (escaped) {escaped = false;}
            else if (current === '\\') {escaped = true;}
            else if (current === quote) {quote = '';}
        } else if (current === '"' || current === "'" || current === '`') {
            quote = current;
        }
    }
    mapa[source.length] = quote ? 1 : 0;
    return mapa;
}

export function isInsideString(source: string, index: number): boolean {
    /* Más allá del final, el estado es el del último carácter, igual que el recorrido anterior */
    const mapa = mapaCadenas(source);
    return mapa[Math.min(index, source.length)] === 1;
}

export function isCodeMatch(source: string, matchIndex: number): boolean {
    return !isInsideString(source, matchIndex);
}
