/*
 * [17AA-3] Enmascara comentarios de JS/TS/JSX/TSX para que los detectores que
 * recorren el texto con una regex no lean lo que hay dentro.
 *
 * [por que] `cssInlineReact` aplicaba `style\s*=\s*\{` sobre `document.getText()`
 * crudo, asi que un `style={}` escrito **dentro de un comentario** contaba como
 * CSS inline. Medido el 2026-10-17: los dos hallazgos de NAKOMI
 * (`CarruselShowcase.tsx:73`, `SeccionGaleriaServicio.tsx:29`) son la misma
 * frase de un comentario de bloque explicando el propio detector; el de
 * RESTAURANTE si es un `style={{...}}` real. `cssInlineScript` recorria el texto
 * igual, con el mismo defecto.
 *
 * La ruta CSS ya tenia su `eliminarComentarios`, pero solo cubre `/* *\/` y vive
 * dentro de `CssParser`. Aqui se cubren ademas los `//` de linea, que es lo que
 * aparece en un `.tsx`.
 *
 * Los comentarios se sustituyen por espacios de la **misma longitud** (los
 * saltos de linea se conservan), de modo que los offsets y las lineas siguen
 * valiendo sobre el texto original: quien llama busca sobre el enmascarado y
 * publica posiciones sobre el original.
 *
 * [limite conocido] El interior de un template `${...}` se trata como parte del
 * template, asi que un comentario anidado ahi no se enmascara. Es el lado
 * conservador: se deja de enmascarar, nunca se enmascara de mas.
 */

/* Cierra una comilla simple o doble. Devuelve el indice de la comilla de cierre
 * o -1 si no la hay **en la misma linea**: en JS/TS un literal '...' o "..."
 * puede contener `\n` escapado, pero no un salto real, asi que un apostrofo
 * suelto (`don't`, en texto JSX) no abre un literal que se trague el fichero. */
function cierraEnLinea(texto: string, inicio: number): number {
    for (let i = inicio + 1; i < texto.length; i++) {
        const c = texto[i];
        if (c === '\\') { i++; continue; }
        if (c === '\n' || c === '\r') { return -1; }
        if (c === texto[inicio]) { return i; }
    }
    return -1;
}

/* Cierra un template con backtick. Si puede cruzar lineas, por eso no se limita
 * a la linea actual. Devuelve el indice de la comilla de cierre, o el final. */
function cierraTemplate(texto: string, inicio: number): number {
    for (let i = inicio + 1; i < texto.length; i++) {
        const c = texto[i];
        if (c === '\\') { i++; continue; }
        if (c === '`') { return i; }
    }
    return texto.length - 1;
}

/** Texto con los comentarios sustituidos por espacios, conservando longitudes. */
export function enmascararComentarios(texto: string): string {
    const salida = texto.split('');
    const borrar = (desde: number, hasta: number): void => {
        for (let k = desde; k < hasta; k++) {
            if (salida[k] !== '\n' && salida[k] !== '\r') { salida[k] = ' '; }
        }
    };

    let i = 0;
    while (i < texto.length) {
        const c = texto[i];
        const siguiente = texto[i + 1];

        if (c === '/' && siguiente === '*') {
            const fin = texto.indexOf('*/', i + 2);
            const hasta = fin === -1 ? texto.length : fin + 2;
            borrar(i, hasta);
            i = hasta;
            continue;
        }
        if (c === '/' && siguiente === '/') {
            const fin = texto.indexOf('\n', i);
            const hasta = fin === -1 ? texto.length : fin;
            borrar(i, hasta);
            i = hasta;
            continue;
        }
        if (c === '`') {
            i = cierraTemplate(texto, i) + 1;
            continue;
        }
        if (c === '"' || c === "'") {
            const fin = cierraEnLinea(texto, i);
            i = fin === -1 ? i + 1 : fin + 1;
            continue;
        }
        i++;
    }
    return salida.join('');
}
