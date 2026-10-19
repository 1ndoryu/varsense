/*
 * Ámbitos de cascada de un CSS: qué bloque (selector) contiene cada offset.
 * Distingue shadowing intencional de duplicados reales (ver parsearSoloDefiniciones).
 */

/*
 * [229A-1] Pre-escaneo de ambitos: por cada `{` registra el selector del
 * bloque que abre (texto desde el ultimo `;`, `{` o `}`), ignorando
 * comentarios y literales. `buscarAmbitoInnermost` resuelve el bloque mas
 * interno que contiene un offset con busqueda binaria. El mismo token con
 * el mismo valor en ambitos distintos es shadowing de cascada, no
 * duplicado; el mismo selector repetido conserva su texto y sigue
 * agrupando igual que antes.
 */
export interface EntradaAmbito {
    apertura: number;
    cierre: number;
    ambito: string;
}

export function mapearAmbitosBloques(texto: string): EntradaAmbito[] {
    const ambitos: EntradaAmbito[] = [];
    const pila: Array<{ apertura: number; ambito: string }> = [];
    let inicioSelector = 0;
    let i = 0;

    const saltarLiteral = (comilla: string): void => {
        i++;
        while (i < texto.length) {
            if (texto[i] === '\\') {
                i += 2;
                continue;
            }
            if (texto[i] === comilla) {
                i++;
                return;
            }
            i++;
        }
    };

    while (i < texto.length) {
        const actual = texto[i];
        const siguiente = i + 1 < texto.length ? texto[i + 1] : '';

        if (actual === '/' && siguiente === '*') {
            const fin = texto.indexOf('*/', i + 2);
            i = fin < 0 ? texto.length : fin + 2;
            inicioSelector = i;
            continue;
        }

        if (actual === '"' || actual === "'") {
            saltarLiteral(actual);
            continue;
        }

        if (actual === '{') {
            const selector = texto.slice(inicioSelector, i).trim().replace(/\s+/g, ' ');
            pila.push({ apertura: i, ambito: selector });
            inicioSelector = i + 1;
            i++;
            continue;
        }

        if (actual === '}') {
            const abierto = pila.pop();
            if (abierto !== undefined) {
                ambitos.push({ apertura: abierto.apertura, cierre: i, ambito: abierto.ambito });
            }
            inicioSelector = i + 1;
            i++;
            continue;
        }

        if (actual === ';' && pila.length === 0) {
            inicioSelector = i + 1;
        }
        i++;
    }

    ambitos.sort((a, b) => a.apertura - b.apertura);
    return ambitos;
}

export function buscarAmbitoInnermost(ambitos: EntradaAmbito[], offset: number): string | undefined {
    /* Ultimo bloque con apertura <= offset: el mas interno posible. */
    let izquierda = 0;
    let derecha = ambitos.length - 1;
    let posicion = -1;

    while (izquierda <= derecha) {
        const medio = (izquierda + derecha) >> 1;
        if (ambitos[medio].apertura <= offset) {
            posicion = medio;
            izquierda = medio + 1;
        } else {
            derecha = medio - 1;
        }
    }

    /* Retroceder hasta el primero que realmente contenga el offset. */
    while (posicion >= 0) {
        const candidato = ambitos[posicion];
        if (offset <= candidato.cierre) {
            return candidato.ambito;
        }
        posicion--;
    }

    return undefined;
}
