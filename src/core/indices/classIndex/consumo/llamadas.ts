/* [V6] Partición de classIndexBuilder.ts: llamadas a funciones que devuelven clases. Sin cambio de comportamiento. */
import { escanearDefinicionesFunciones } from '../fuentes/carriers';
import { extraerLiterales } from '../plantillas/plantillas';
import { isCodeMatch } from './consumidores';
import { addClassTokens } from './tokens';

/* [318A-7V23] Divide los argumentos top-level de una llamada a partir del
 * índice de su '(' de apertura. Respeta strings/templates con escape y
 * anidado de paréntesis/corchetes/llaves, así que soporta llamadas
 * multilínea (`el('div', 'conv' + (x ? ' archivada' : ''))`) y args con
 * paréntesis internos, donde el regex plano `([^)]*)` [J-8] se troncha.
 * Devuelve null sin cierre balanceado; las comas a profundidad 1 separan. */
export function dividirArgumentosLlamada(source: string, apertura: number): string[] | null {
    const args: string[] = [];
    let actual = '';
    let profundidad = 0;
    let quote = '';
    let escaped = false;
    for (let cursor = apertura; cursor < source.length; cursor++) {
        const ch = source[cursor];
        if (quote) {
            actual += ch;
            if (escaped) {escaped = false;}
            else if (ch === '\\') {escaped = true;}
            else if (ch === quote) {quote = '';}
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {quote = ch; actual += ch; continue;}
        if (ch === '(' || ch === '[' || ch === '{') {profundidad++; if (profundidad > 1) {actual += ch;} continue;}
        if (ch === ')' || ch === ']' || ch === '}') {
            profundidad--;
            if (profundidad === 0) {args.push(actual); return args;}
            if (profundidad < 0) {return null;}
            actual += ch;
            continue;
        }
        if (ch === ',' && profundidad === 1) {args.push(actual); actual = ''; continue;}
        actual += ch;
    }
    return null;
}

/* [318A-7V20] RC-3: mapper de clases del MISMO archivo llamado dentro de un
 * atributo de clase (`claseAdicional={obtenerClase()}` en IndicadorPlan.tsx,
 * className={`etiqueta ${obtenerClasePrioridad(p)}`} en ListaProyectos.tsx).
 * Sus literales de return son las clases reales que el runtime aplica; sin
 * esta resolución el extractor los reporta huérfanos. Solo se invoca desde
 * contextos de atributo de clase (ver extraerTokensDeTexto); una llamada en
 * una declaración (helper('x'), contrato 'unusedPanel') nunca llega aquí. */
export function cuerpoDeFuncionEn(source: string, nombre: string): string | null {
    /* Admite anotación de retorno TS entre parámetros y cuerpo:
     * `function f(p: string): string {`, `const f = (): string => {`
     * (IndicadorPlan.tsx:23, ListaProyectos.tsx:24). */
    const regex = new RegExp(
        '(?:function\\s+' + nombre + '\\s*\\([^)]*\\)\\s*(?::\\s*[^{;]*?)?\\s*\\{|' +
        '(?:const|let|var)\\s+' + nombre + '\\s*=\\s*(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*(?::\\s*[^{;]*?)?\\s*=>\\s*\\{)',
        'g'
    );
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {
            continue;
        }
        let profundidad = 0;
        let quote = '';
        let escaped = false;
        /* Recorre desde la '{' final del match hasta su cierre balanceado. */
        for (let cursor = match.index + match[0].length - 1; cursor < source.length; cursor++) {
            const current = source[cursor];
            if (quote) {
                if (escaped) {escaped = false;}
                else if (current === '\\') {escaped = true;}
                else if (current === quote) {quote = '';}
                continue;
            }
            if (current === '"' || current === "'" || current === '`') {quote = current; continue;}
            if (current === '{') {profundidad++;}
            else if (current === '}') {
                profundidad--;
                if (profundidad === 0) {
                    return source.slice(match.index + match[0].length, cursor);
                }
            }
        }
        return null;
    }
    return null;
}

/* [299A-13 F3b-2] `MAPA[x] || ''` (UsuariosFila.tsx:80,
 * HostingDetalle.tsx:155 de NAKOMI): el fallback literal rompía el match
 * exacto del subíndice y el mapa importado nunca se registraba. Solo se
 * despoja un fallback de literal único (`||`/`??` + string); cualquier otra
 * forma conserva el fail-closed previo. */
export function sinFallbackClase(expr: string): string {
    return expr.replace(/\s*(?:\|\||\?\?)\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*$/, '');
}

/* [299A-13 F3b-2] Cuerpo de función sin strings (comillas simples/dobles con
 * escape) para buscar formas de código (`MAPA[x]`, `MAPA.prop`) sin que un
 * literal las falsee. Los templates se conservan: pueden contener código. */
export function sinStringsClase(cuerpo: string): string {
    let out = '';
    let quote = '';
    let escaped = false;
    for (let i = 0; i < cuerpo.length; i++) {
        const c = cuerpo[i];
        if (quote) {
            if (escaped) {escaped = false;}
            else if (c === '\\') {escaped = true;}
            else if (c === quote) {quote = '';}
            continue;
        }
        if (c === '"' || c === "'") {quote = c; continue;}
        out += c;
    }
    return out;
}

/* [299A-13 F3b-2] Acceso por punto sobre un mapa (`PAYMENT_STATUS_CLASS.
 * released` en SeccionPagos.parts.tsx:16 de NAKOMI): misma regla que el
 * subíndice — set local o referencia al mapa importado para la fase 2.
 * Solo `Nombre.prop` simple (sin `(` detrás: no llamadas); las cadenas con
 * más puntos pertenecen al camino switch preexistente. */
export function resolverAccesoPuntoMapa(nombre: string, variables: Map<string, Set<string>>, tokens: Set<string>, importsPropios?: Set<string>, referenciasMapa?: Set<string>): void {
    const resueltoLocal = variables.get(nombre);
    if (resueltoLocal) {
        for (const token of resueltoLocal) {
            tokens.add(token);
        }
    } else if (importsPropios?.has(nombre)) {
        referenciasMapa?.add(nombre);
    }
}

export function resolverLlamadaMapper(body: string, source: string, tokens: Set<string>, importsPropios?: Set<string>, referenciasMapa?: Set<string>, llamadasClaseFuera?: Set<string>): void {
    const llamada = body.trim().match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (!llamada) {
        return;
    }
    const cuerpo = cuerpoDeFuncionEn(source, llamada[1]);
    if (!cuerpo) {
        /* [15A-27] La funcion no esta en ESTE archivo: se anota el nombre para
         * que la union de fase 2 lo cruce con el archivo que la define (ver
         * extraerFuncionesQueDevuelvenClases). Sin esto una funcion que
         * devuelve la clase por ramas (`claseEstadoSample` de estadoVisual.tsx)
         * solo se resolvia si el consumidor vivia en el mismo archivo. Solo
         * nombres traidos por import relativo: un homonimo local o global no
         * aporta (fail-closed, mismo criterio que referenciasMapa). */
        if (llamadasClaseFuera && importsPropios?.has(llamada[1])) {
            llamadasClaseFuera.add(llamada[1]);
        }
        return;
    }
    /* Cada `return <literal>` del mapper aporta la(s) clase(s) reales. Se
     * avanza hasta el ';' del return para no releer returns posteriores. */
    const reReturn = /\breturn\b/g;
    while (reReturn.exec(cuerpo) !== null) {
        const resto = cuerpo.slice(reReturn.lastIndex);
        const literales = extraerLiterales(resto);
        if (literales.length > 0) {
            addClassTokens(literales[0], tokens);
        }
        const finStatement = resto.indexOf(';');
        if (finStatement < 0) {
            break;
        }
        reReturn.lastIndex = reReturn.lastIndex + finStatement + 1;
    }
    /* [299A-13 F3b-2] Helper que envuelve un mapa importado (`return ...
     * PAYMENT_STATUS_CLASS[payment.status]` / `PAYMENT_STATUS_CLASS.released`
     * en paymentStatusClass de SeccionPagos.parts.tsx:15-16 de NAKOMI,
     * invocado como ${paymentStatusClass(payment)} en :76): el cuerpo no
     * aporta literales y el return-literal de arriba no ve nada. Se registra
     * la referencia al mapa importado para la fase 2 (unión post-hoc). Solo
     * nombres traídos por import relativo; el cuerpo se escanea sin strings
     * para no falsear con literales. Sin import no hay registro (fail-closed:
     * podría ser un mapa local ya cubierto por M1 o un global). */
    if (importsPropios && referenciasMapa) {
        const codigo = sinStringsClase(cuerpo);
        const reUsoMapa = /\b([A-Za-z_$][\w$]*)\s*\[[^\]\n]*\]|\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b(?!\s*\()/g;
        let uso: RegExpExecArray | null;
        while ((uso = reUsoMapa.exec(codigo)) !== null) {
            const nombre = uso[1] ?? uso[2];
            if (importsPropios.has(nombre)) {
                referenciasMapa.add(nombre);
            }
        }
    }
}

/* [15A-27] Literales de clase que devuelve cada funcion definida en ESTE
 * archivo: `case 'error': return 'sincPanelEstadoError';` (claseEstadoSample de
 * estadoVisual.tsx:52-63). Era la mitad que faltaba del cruce cross-file: el
 * consumidor vive en otro archivo (`ListaHistorialSync.tsx:85` interpola la
 * llamada en una plantilla de className) y resolverLlamadaMapper solo mira el
 * archivo del consumidor, asi que la definicion le era invisible y la clase
 * salia huerfana. La otra mitad la aporta llamadasClaseFuera.
 *
 * Solo se acepta el literal cuando el `return` EMPIEZA por comilla: el barrido
 * del mapper toma el primer literal que encuentra, y sin ese guard un
 * `return null;` seguido de cualquier literal posterior colaria como valor de
 * retorno. El literal se parte por espacios porque un return puede devolver la
 * cadena entera (`return 'a b'`). */
export function extraerFuncionesQueDevuelvenClases(source: string): Map<string, Set<string>> {
    const resultado = new Map<string, Set<string>>();
    for (const def of escanearDefinicionesFunciones(source)) {
        const literales = new Set<string>();
        const reReturn = /\breturn\b/g;
        while (reReturn.exec(def.cuerpo) !== null) {
            const resto = def.cuerpo.slice(reReturn.lastIndex);
            if (/^\s*['"`]/.test(resto)) {
                for (const encontrado of extraerLiterales(resto)) {
                    for (const clase of encontrado.split(/\s+/)) {
                        if (clase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(clase)) {
                            literales.add(clase);
                        }
                    }
                    break;
                }
            }
            const finStatement = resto.indexOf(';');
            if (finStatement < 0) {break;}
            reReturn.lastIndex = reReturn.lastIndex + finStatement + 1;
        }
        if (literales.size > 0) {
            resultado.set(def.nombre, literales);
        }
    }
    return resultado;
}

export function pareceTernarioDeLiterales(valor: string): boolean {
    return /\?\s*['"`]/.test(valor);
}
