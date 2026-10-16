/*
 * [15A-25] Reconocedor compartido del atributo `style={...}` de JSX.
 *
 * Vivía dentro de `core/analyzeDocument.ts`, que lo usaba para decidir si un
 * `style={{}}` es estilo inline o definicion runtime de tokens. El parser de
 * CSS necesita la MISMA respuesta para indexar esas claves como variables: en
 * KAMPLES casi todos los `variableNoDefinida` (`--top`, `--notaTop`,
 * `--tecladoAncho`, `--porcentaje`...) se definen en el TSX y los consume la
 * hoja. Una sola implementacion para que el indice y el veredicto no puedan
 * divergir.
 *
 * La version anterior reconocia el atributo con `style\s*=\s*\{\s*\{`, que
 * exige un objeto literal inmediato. Un `style={cond ? { '--top': v } :
 * undefined}` quedaba fuera del reconocedor y caia en la rama generica de
 * `style={ident}`: se reportaba como estilo inline y sus claves no entraban en
 * el indice. Ahora el atributo se delimita balanceando llaves y se inspeccionan
 * TODOS los objetos literales que contenga la expresion, este o no envuelta en
 * un ternario.
 */

/* Clave de nivel superior de un objeto `style={{...}}`, con el offset de su
 * inicio en el texto: el indice de variables necesita la posicion para
 * publicar el hallazgo. */
export interface ClaveEstilo {
    texto: string;
    offset: number;
}

/* `style={` — la llave de apertura de la expresion queda en el ultimo indice
 * del match. */
export const REGEX_ATRIBUTO_ESTILO = /style\s*=\s*\{/g;

/* Salta un literal '...' "..." `...` desde su comilla de apertura y devuelve
 * el offset posterior al cierre. Los templates `...${...}...` recorren la
 * expresion interpolada con balanceo para no confundir sus llaves, comas o
 * dos puntos con la estructura del objeto que los contiene. */
export function saltarLiteralEstilo(texto: string, inicio: number): number {
    const comilla = texto[inicio];
    let i = inicio + 1;

    while (i < texto.length) {
        const actual = texto[i];
        if (actual === '\\') {
            i += 2;
            continue;
        }
        if (comilla === '`' && actual === '$' && texto[i + 1] === '{') {
            let profundidad = 1;
            i += 2;
            while (i < texto.length && profundidad > 0) {
                const interno = texto[i];
                if (interno === '\\') {
                    i += 2;
                    continue;
                }
                if (interno === "'" || interno === '"' || interno === '`') {
                    i = saltarLiteralEstilo(texto, i);
                    continue;
                }
                if (interno === '{') {
                    profundidad++;
                } else if (interno === '}') {
                    profundidad--;
                }
                i++;
            }
            continue;
        }
        if (actual === comilla) {
            return i + 1;
        }
        i++;
    }

    return i;
}

/* Devuelve el offset posterior a la llave que cierra la expresion abierta en
 * `inicioLlave`. Los literales se saltan enteros: una llave o una comilla
 * dentro de una cadena no altera el balance. */
export function finExpresionEstilo(texto: string, inicioLlave: number): number {
    let profundidad = 0;
    let i = inicioLlave;

    while (i < texto.length) {
        const actual = texto[i];
        if (actual === "'" || actual === '"' || actual === '`') {
            i = saltarLiteralEstilo(texto, i);
            continue;
        }
        if (actual === '{') {
            profundidad++;
        } else if (actual === '}') {
            profundidad--;
            if (profundidad === 0) {
                return i + 1;
            }
        }
        i++;
    }

    return i;
}

/*
 * Extrae las claves de nivel superior del objeto literal abierto en
 * `inicioLlave`. Solo se inspecciona el primer nivel: `style={{ color: 'red' }}`,
 * spreads o shorthands siguen apareciendo como clave, de modo que el veredicto
 * queda del lado conservador. `fin` acota el recorrido a la expresion del
 * atributo cuando el objeto no esta balanceado (no deberia ocurrir, pero evita
 * que un fichero truncado arrastre el resto del archivo).
 */
export function extraerClavesObjetoEstilo(texto: string, inicioLlave: number, fin = texto.length): ClaveEstilo[] {
    const claves: ClaveEstilo[] = [];
    let profundidad = 0;
    let segmento = '';
    let inicioSegmento = -1;
    let claveExtraida = false;
    let i = inicioLlave;

    const volcarSegmento = (): void => {
        const recortado = segmento.trim();
        if (recortado.length > 0) {
            claves.push({ texto: recortado, offset: inicioSegmento });
        }
        segmento = '';
        inicioSegmento = -1;
    };

    while (i < fin) {
        const actual = texto[i];

        if (actual === "'" || actual === '"' || actual === '`') {
            const finLiteral = saltarLiteralEstilo(texto, i);
            /* Clave entrecomillada ('--x', "--x"): el literal ES la clave en
             * posicion de clave; acumular su contenido para que
             * esSoloDefinicionTokens la vea. En posicion de valor se ignora. */
            if (profundidad === 1 && !claveExtraida) {
                if (inicioSegmento < 0) {
                    inicioSegmento = i + 1;
                }
                segmento += texto.slice(i + 1, finLiteral - 1);
            }
            i = finLiteral;
            continue;
        }

        if (actual === '{' || actual === '[' || actual === '(') {
            profundidad++;
            i++;
            continue;
        }

        if (actual === '}' || actual === ']' || actual === ')') {
            if (profundidad === 1 && actual === '}') {
                if (!claveExtraida) {
                    /* Spread/shorthand sin dos puntos: tambien es clave. */
                    volcarSegmento();
                }
                return claves;
            }
            profundidad--;
            i++;
            continue;
        }

        if (profundidad === 1 && actual === ':' && !claveExtraida) {
            volcarSegmento();
            claveExtraida = true;
            i++;
            continue;
        }

        if (profundidad === 1 && actual === ',') {
            if (!claveExtraida) {
                volcarSegmento();
            }
            segmento = '';
            inicioSegmento = -1;
            claveExtraida = false;
            i++;
            continue;
        }

        if (profundidad === 1) {
            if (inicioSegmento < 0 && !/\s/.test(actual)) {
                inicioSegmento = i;
            }
            segmento += actual;
        }
        i++;
    }

    return claves;
}

/*
 * Claves de todos los objetos literales contenidos en la expresion del
 * atributo, sea `{{...}}` directo o un ternario `cond ? {...} : undefined`.
 * Los objetos anidados a mayor profundidad (un valor que a su vez es objeto)
 * se recorren tambien, pero sus claves internas no son de nivel superior y no
 * se recogen: solo se desciende para buscar mas objetos, no para leer dentro.
 */
export function clavesDeExpresionEstilo(texto: string, inicioLlave: number, fin: number): ClaveEstilo[] {
    const claves: ClaveEstilo[] = [];
    /* La llave de `inicioLlave` es la de la EXPRESION (`style={ ... }`), no la
     * de un objeto: recorrerla como objeto recogeria la expresion entera como
     * una sola clave falsa. Se empieza dentro. */
    let i = inicioLlave + 1;

    while (i < fin) {
        const actual = texto[i];
        if (actual === "'" || actual === '"' || actual === '`') {
            i = saltarLiteralEstilo(texto, i);
            continue;
        }
        if (actual === '{') {
            const finObjeto = finExpresionEstilo(texto, i);
            claves.push(...extraerClavesObjetoEstilo(texto, i, Math.min(finObjeto, fin)));
            i = finObjeto;
            continue;
        }
        i++;
    }

    return claves;
}

/* Un objeto cuyas claves son TODAS custom properties (`--*`) no aplica estilo
 * inline: solo define tokens que el CSS consume via var(). */
export function esSoloDefinicionTokens(claves: ClaveEstilo[]): boolean {
    if (claves.length === 0) {
        return false;
    }
    return claves.every(clave => clave.texto.replace(/^['"]|['"]$/g, '').startsWith('--'));
}

/* Normaliza una clave a su nombre de custom property, o null si no lo es. */
export function nombreCustomProperty(clave: ClaveEstilo): string | null {
    const texto = clave.texto.replace(/^['"]|['"]$/g, '');
    return /^--[\w-]+$/.test(texto) ? texto : null;
}
