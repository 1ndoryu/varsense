/* [V6] Partición de classIndexBuilder.ts: portadores de clases y llamadas a sus funciones. Sin cambio de comportamiento. */
import { isCodeMatch } from '../consumo/consumidores';
import { cuerpoDeFuncionEn, dividirArgumentosLlamada } from '../consumo/llamadas';
import { previousCodeCharacter } from '../consumo/tokens';
import { escanearDeclaraciones, estadoScanning } from './mapasJs';

/* [318A-7V17] Un ternario real tiene el '?' PEGADO/SEGUIDO de un literal
 * (`cond ? 'a' : 'b'`, `${x ? 'a' : ''}`). El optional-chaining (`resto?.claseExt`)
 * también contiene '?' pero no es ternario de literales: un includes('?')
 * amplio hacía que el valor completo de un closure (React.forwardRef con
 * `resto?.claseExt`) se clasificara como ternario, extrayendo sus literales
 * y registrando familias falsas. */
/* [318A-7V20] RC-1: `clase += 'selectorFechaCalendario__dia--hoy'` — el
 * acumulador compone clases sobre una variable ya portadora. escanearDeclaraciones
 * solo lee `x =`; este barrido captura `x +=` con el mismo escaneo acotado. */
export function escanearAsignacionesCompuestas(source: string): Array<{ nombre: string; valor: string; indice: number }> {
    const REGEX_COMPUESTO = /\b([A-Za-z_$][\w$]*)\s*\+=\s*/g;
    const resultados: Array<{ nombre: string; valor: string; indice: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = REGEX_COMPUESTO.exec(source)) !== null) {
        const nombre = match[1];
        const indice = match.index;
        if (!isCodeMatch(source, indice)) {
            continue;
        }
        const previo = previousCodeCharacter(source, indice);
        /* `miembro.objeto +=` o un identificador pegado no es un acumulador de
         * sentencia; solo cuenta un nombre en posición de statement. */
        if (previo && /[\w.$]/.test(previo)) {
            continue;
        }
        const { profundidad: inicial } = estadoScanning(source, indice);
        const desde = REGEX_COMPUESTO.lastIndex;
        let quote = '';
        let escaped = false;
        let profundidad = inicial;
        let fin = -1;
        for (let cursor = desde; cursor < source.length; cursor++) {
            const current = source[cursor];
            if (quote) {
                if (escaped) {escaped = false;}
                else if (current === '\\') {escaped = true;}
                else if (current === quote) {quote = '';}
                continue;
            }
            if (current === '"' || current === "'" || current === '`') {quote = current; continue;}
            if (current === '(' || current === '[' || current === '{') {profundidad++; continue;}
            if (current === ')' || current === ']' || current === '}') {profundidad--; continue;}
            if (current === ';' && profundidad <= inicial) {fin = cursor; break;}
        }
        if (fin === -1) {
            continue;
        }
        resultados.push({ nombre, valor: source.slice(desde, fin), indice });
    }
    return resultados;
}

/* [318A-7V21] RC-4: `clases.push('literal')` sobre un array ya portador
 * (WANDORIUS notifications-popover.ts:80-82: `const clases = ['...__item'];
 * ...; clases.push('...--leida')`). Hermano directo de la asignación compuesta
 * RC-1 (V20): el literal empujado compone el set de clases del runtime y jamás
 * llegaba al índice. Solo cuenta push sobre identificadores ya declarados como
 * portadores (ver recopilarDeclaraciones); un `x.push` cualquiera no aporta. */
export function escanearPushs(source: string): Array<{ nombre: string; valor: string; indice: number }> {
    const REGEX_PUSH = /\b([A-Za-z_$][\w$]*)\s*\.push\s*\(/g;
    const resultados: Array<{ nombre: string; valor: string; indice: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = REGEX_PUSH.exec(source)) !== null) {
        const indice = match.index;
        if (!isCodeMatch(source, indice)) {
            continue;
        }
        const { profundidad: inicial } = estadoScanning(source, indice);
        const desde = REGEX_PUSH.lastIndex;
        let quote = '';
        let escaped = false;
        let profundidad = inicial;
        let fin = -1;
        for (let cursor = desde; cursor < source.length; cursor++) {
            const current = source[cursor];
            if (quote) {
                if (escaped) {escaped = false;}
                else if (current === '\\') {escaped = true;}
                else if (current === quote) {quote = '';}
                continue;
            }
            if (current === '"' || current === "'" || current === '`') {quote = current; continue;}
            if (current === '(' || current === '[' || current === '{') {profundidad++; continue;}
            if (current === ')') {
                profundidad--;
                /* El '(' del push queda FUERA del rango (desde = tras él), así
                 * que su cierre baja de 0 a -1; los paréntesis anidados vuelven
                 * a su nivel sin cruzarlo. Cortar solo por debajo del inicial
                 * evita tronchar `push(fn('x'))` en el ')' interno. */
                if (profundidad < inicial) {fin = cursor; break;}
                continue;
            }
            if (current === ']' || current === '}') {profundidad--; continue;}
        }
        if (fin === -1) {
            continue;
        }
        resultados.push({ nombre: match[1], valor: source.slice(desde, fin), indice });
    }
    return resultados;
}

/* [318A-7V23] Valores de `return <expr>;`: el mismo barrido acotado que las
 * declaraciones, anclado en la palabra `return`. Sin valor (`return;`) o sin
 * `;` de cierre (ASI) no aporta. Solo cuenta en posición de sentencia: un
 * `return` pegado a identificador es otra cosa (inexistente en la práctica,
 * pero el guard es gratis). */
export function escanearReturns(source: string): Array<{ valor: string; indice: number }> {
    const REGEX_RETURN = /\breturn\b/g;
    const resultados: Array<{ valor: string; indice: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = REGEX_RETURN.exec(source)) !== null) {
        const indice = match.index;
        if (!isCodeMatch(source, indice)) {
            continue;
        }
        const previo = previousCodeCharacter(source, indice);
        if (previo && /[\w$]/.test(previo)) {
            continue;
        }
        const { profundidad: inicial } = estadoScanning(source, indice);
        const desde = REGEX_RETURN.lastIndex;
        let quote = '';
        let escaped = false;
        let profundidad = inicial;
        let fin = -1;
        for (let cursor = desde; cursor < source.length; cursor++) {
            const current = source[cursor];
            if (quote) {
                if (escaped) {escaped = false;}
                else if (current === '\\') {escaped = true;}
                else if (current === quote) {quote = '';}
                continue;
            }
            if (current === '"' || current === "'" || current === '`') {quote = current; continue;}
            if (current === '(' || current === '[' || current === '{') {profundidad++; continue;}
            if (current === ')' || current === ']' || current === '}') {profundidad--; continue;}
            if (current === ';' && profundidad <= inicial) {fin = cursor; break;}
        }
        if (fin === -1) {
            continue;
        }
        resultados.push({ valor: source.slice(desde, fin), indice });
    }
    return resultados;
}

/* [318A-7V23] Parámetros portadores del MISMO archivo: una función cuyos
 * parámetros fluyen a un sink de clase (`el('span', clase)` en crearStat de
 * panelGit.ts:174, `el('div', icono)` vía iconoDeEstado en tareasMeta.ts:54)
 * aplica en runtime los literales que recibe en esa posición
 * (`crearStat('+', n, 'git-adiciones')` en :105). Sin esta resolución el
 * literal del call-site jamás llega al índice y la clase se reporta.
 * Detección por función definida en el archivo (function + flecha con
 * paréntesis): el parámetro es portador si se menciona en un argumento de
 * sink (2º arg de el()/createElement, 1er arg de classList.*, RHS de
 * .className, 2º arg de setAttribute('class',...), contenido de
 * class="..." en templates) o a un hop por un local (`const cls = ...
 * extraClase ...` + `<svg class="${cls}">` en iconoHtml de iconos.ts:121),
 * o si se reenvía como ident puro a una posición portadora de otra función
 * del archivo (ponerIcono → icono; punto fijo ≤3). Solo literales string en
 * el call-site aportan (un ident/boolean nunca se indexa). La detección de
 * carriers es mismo-archivo (el cuerpo que prueba el sink está aquí), pero
 * [318A-7V24] el CRUCE es global: scan() une los carriers de todos los
 * archivos y marca los literales de call-sites en posiciones portadoras
 * (marcarCuerpo/icono/ponerIcono de GH definidos en un módulo y llamados
 * desde otro). Cache-safe: cada entrada persistente solo guarda sus propios
 * carriers + llamadas (ver extraerCarriersYLlamadas); la unión se computa en
 * memoria por ejecución. */
export function nombreParametroBase(parametro: string): string | null {
    let actual = parametro.trim().replace(/^\.\.\./, '');
    /* Recorta tipo (`p: string`) y default (`p = 'x'`) a profundidad 0. */
    let profundidad = 0;
    let quote = '';
    for (let i = 0; i < actual.length; i++) {
        const ch = actual[i];
        if (quote) {
            if (ch === quote) {quote = '';}
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {quote = ch; continue;}
        if (ch === '<' || ch === '(' || ch === '[' || ch === '{') {profundidad++; continue;}
        if (ch === '>' || ch === ')' || ch === ']' || ch === '}') {profundidad--; continue;}
        if ((ch === ':' || ch === '=') && profundidad === 0) {actual = actual.slice(0, i); break;}
    }
    actual = actual.trim();
    return /^[A-Za-z_$][\w$]*$/.test(actual) ? actual : null;
}

export function mencionaIdentificador(texto: string, nombre: string): boolean {
    return new RegExp('\\b' + nombre + '\\b').test(texto);
}

/* Textos de sink dentro de un cuerpo: argumentos que en runtime SON clases.
 * Se reutiliza dividirArgumentosLlamada para no tronchar args anidados. */
export function textosSinkDeCuerpo(cuerpo: string): string[] {
    const textos: string[] = [];
    const source = cuerpo;
    const reEl = /\b(?:el|createElement)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = reEl.exec(source)) !== null) {
        const args = dividirArgumentosLlamada(source, match.index + match[0].length - 1);
        if (args && args.length >= 2) {textos.push(args[1]);}
    }
    const reList = /classList\.(?:add|toggle|remove|contains|replace)\s*\(/g;
    while ((match = reList.exec(source)) !== null) {
        const args = dividirArgumentosLlamada(source, match.index + match[0].length - 1);
        if (args && args.length >= 1) {textos.push(args[0]);}
    }
    const reClassName = /\.\s*className\s*=\s*([^;]+)/g;
    while ((match = reClassName.exec(source)) !== null) {textos.push(match[1]);}
    const reSetAttr = /setAttribute\s*\(\s*['"]class['"]\s*,/g;
    while ((match = reSetAttr.exec(source)) !== null) {
        /* [318A-7V24] El match termina en ',' (no en '(' como reEl/reList):
         * la apertura es el '(' del match, no length - 1. Antes se dividía
         * desde la ',' → null siempre → ningún carrier vía setAttribute se
         * detectaba (icono de GH nunca fue carrier). */
        const args = dividirArgumentosLlamada(source, match.index + match[0].indexOf('('));
        if (args && args.length >= 2) {textos.push(args[1]);}
    }
    /* [299A-13 F4] Helpers rest+join (`function combinarClases(...clases) {
     * return clases.filter(Boolean).join(' ')}` en Modal.tsx:12 de NAKOMI): el
     * parámetro fluye al string de clases vía return, no vía sink clásico, así
     * que la función nunca era carrier y el literal del call-site
     * (`combinarClases('modalBaseContenedor', ...)`) se perdía. El
     * `return <expr con .join(`> (y la flecha `=> <expr con .join(`>) se
     * trata como texto de sink: el ident mencionado ahí es portador. Solo
     * .join (idioma de composición de clases: clsx/classnames/join casero);
     * un `return x` plano NO es sink (evita que cualquier getter sea carrier).
     * Límite documentado: un join() no-de-clases (csv/slug) llamado con un
     * literal con forma de clase bendeciría esa clase; no observado en el área. */
    const reReturnJoin = /\breturn\s+([^;]+)/g;
    while ((match = reReturnJoin.exec(source)) !== null) {
        if (match[1].includes('.join(')) {textos.push(match[1]);}
    }
    const reArrowJoin = /=>\s*([^;{}]+)/g;
    while ((match = reArrowJoin.exec(source)) !== null) {
        if (match[1].includes('.join(')) {textos.push(match[1]);}
    }
    /* Contenido de class="..." en templates del cuerpo (iconoHtml:
     * `<svg class="${cls}">`): el local interpolado resuelve a un hop. */
    const reAttrHtml = /\bclass\s*=\s*(["'])([\s\S]*?)\1/g;
    while ((match = reAttrHtml.exec(source)) !== null) {textos.push(match[2]);}
    return textos;
}

export function escanearDefinicionesFunciones(source: string): Array<{ nombre: string; params: Array<string | null>; cuerpo: string }> {
    const defs: Array<{ nombre: string; params: Array<string | null>; cuerpo: string }> = [];
    const vistos = new Set<string>();
    /* Solo flechas CON paréntesis: `const f = x => {` no casa y queda fuera
     * por diseño (su único parámetro no es posicional múltiple). Se admite
     * `async function` y `export function`: el prev-guard solo rechaza que el
     * nombre cuelgue de un identificador, número o miembro (`x.f(`). */
    const reDef = /(?:(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\()/g;
    let match: RegExpExecArray | null;
    while ((match = reDef.exec(source)) !== null) {
        const nombre = match[1] ?? match[2];
        if (!nombre || vistos.has(nombre) || !isCodeMatch(source, match.index)) {continue;}
        if (match[1]) {
            /* `export function` / `async function`: el match arranca en
             * `function` y el previo salta blancos hasta la 't' de export o
             * la 'c' de async — solo '.' o '$' excluyen (miembro/otra fn). */
            const previo = previousCodeCharacter(source, match.index);
            if (previo === '.' || previo === '$') {continue;}
        }
        const cuerpo = cuerpoDeFuncionEn(source, nombre);
        if (!cuerpo) {continue;}
        /* En el formulario function el match termina tras el NOMBRE (el patrón
         * no incluye `\(`): el '(' de parámetros se busca hacia adelante
         * (admite `function f (` con espacio). En el formulario flecha el
         * match sí termina en el '(' y vale length - 1. */
        const inicioParams = match[1]
            ? source.indexOf('(', match.index + match[0].length)
            : match.index + match[0].length - 1;
        if (inicioParams < 0) {continue;}
        const args = dividirArgumentosLlamada(source, inicioParams);
        if (!args) {continue;}
        /* null preserva el índice posicional tras un destructurado
         * (`(a, {b}, c)`: c sigue en 2 aunque {b} no sea portable). */
        const params: Array<string | null> = args.map(arg => nombreParametroBase(arg));
        vistos.add(nombre);
        defs.push({ nombre, params, cuerpo });
    }
    return defs;
}

/* [318A-7V24] Exportada para tests: la detección de carriers alimenta tanto
 * el cruce mismo-archivo de extraerTokensDeTexto como la unión cross-file. */
export function detectarCarriersMismoArchivo(source: string): Map<string, Set<number>> {
    const carriers = new Map<string, Set<number>>();
    const defs = escanearDefinicionesFunciones(source);
    if (defs.length === 0) {return carriers;}
    const sinksPorFuncion = new Map<string, string[]>();
    for (const def of defs) {
        sinksPorFuncion.set(def.nombre, textosSinkDeCuerpo(def.cuerpo));
    }
    /* Paso 1: mención directa en sink + un hop por local. */
    for (const def of defs) {
        const sinks = sinksPorFuncion.get(def.nombre) ?? [];
        if (sinks.length === 0) {continue;}
        const posiciones = new Set<number>();
        def.params.forEach((param, i) => {
            if (param && sinks.some(texto => mencionaIdentificador(texto, param))) {posiciones.add(i);}
        });
        /* Un hop: local cuyo inicializador menciona el parámetro y que a su
         * vez se menciona en un sink (cls ← extraClase, cls en class="${cls}"). */
        if (posiciones.size < def.params.length) {
            for (const declaracion of escanearDeclaraciones(def.cuerpo)) {
                for (let i = 0; i < def.params.length; i++) {
                    if (posiciones.has(i)) {continue;}
                    const param = def.params[i];
                    if (!param || !mencionaIdentificador(declaracion.valor, param)) {continue;}
                    if (sinks.some(texto => mencionaIdentificador(texto, declaracion.nombre))) {
                        posiciones.add(i);
                    }
                }
            }
        }
        if (posiciones.size > 0) {carriers.set(def.nombre, posiciones);}
    }
    /* Paso 2: reenvío a carriers (punto fijo ≤3; ponerIcono → icono). */
    for (let iter = 0; iter < 3; iter++) {
        let cambio = false;
        for (const def of defs) {
            const posiciones = carriers.get(def.nombre) ?? new Set<number>();
            const reLlamada = /\b([A-Za-z_$][\w$]*)\s*\(/g;
            let llamada: RegExpExecArray | null;
            while ((llamada = reLlamada.exec(def.cuerpo)) !== null) {
                const destino = carriers.get(llamada[1]);
                if (!destino || llamada[1] === def.nombre) {continue;}
                const args = dividirArgumentosLlamada(def.cuerpo, llamada.index + llamada[0].length - 1);
                if (!args) {continue;}
                for (const pos of destino) {
                    const arg = (args[pos] ?? '').trim();
                    if (!/^[A-Za-z_$][\w$]*$/.test(arg)) {continue;}
                    const propio = def.params.indexOf(arg);
                    if (propio >= 0 && !posiciones.has(propio)) {
                        posiciones.add(propio);
                        cambio = true;
                    }
                }
            }
            if (posiciones.size > 0 && !carriers.has(def.nombre)) {carriers.set(def.nombre, posiciones);}
        }
        if (!cambio) {break;}
    }
    return carriers;
}

/* [318A-7V24] Extrae, para UN archivo, sus carriers (vía
 * detectarCarriersMismoArchivo) y sus call-sites con literales string:
 * toda llamada `fn(...)` con argumento literal quoted o template PURO
 * (sin ${}) se registra como {fn, pos, literal}. Los templates con ${} se
 * omiten: su valor depende del mapa de variables del archivo definidor y no
 * son resolubles cross-file sin contexto. Tope 1000 registros/archivo por
 * diseño (un archivo con más llamadas literales es generado; el exceso se
 * ignora y queda documentado en el resumen de scan). El cruce (unión global
 * de carriers × literales en posiciones portadoras) lo hace scan(): así la
 * entrada en caché de B NO depende del contenido de A y el caché por hash
 * sigue siendo válido. */
export interface CarrierCallSite {
    fn: string;
    pos: number;
    literal: string;
}

export function extraerCarriersYLlamadas(source: string): { carriers: Record<string, number[]>; llamadas: CarrierCallSite[] } {
    const carriers: Record<string, number[]> = {};
    for (const [nombre, posiciones] of detectarCarriersMismoArchivo(source)) {
        carriers[nombre] = [...posiciones];
    }
    const llamadas: CarrierCallSite[] = [];
    const reLlamada = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = reLlamada.exec(source)) !== null) {
        if (llamadas.length >= 1000) {break;}
        if (!isCodeMatch(source, match.index)) {continue;}
        const previo = previousCodeCharacter(source, match.index);
        if (previo === '.' || previo === '$') {continue;}
        const args = dividirArgumentosLlamada(source, match.index + match[0].length - 1);
        if (!args) {continue;}
        for (let pos = 0; pos < args.length; pos++) {
            const arg = args[pos].trim();
            if (/^(['"])[\s\S]*\1$/.test(arg) && arg.length >= 2) {
                llamadas.push({ fn: match[1], pos, literal: arg.slice(1, -1) });
            } else if (arg.startsWith('`') && arg.endsWith('`') && arg.length >= 2 && !arg.includes('${')) {
                llamadas.push({ fn: match[1], pos, literal: arg.slice(1, -1) });
            }
        }
        if (llamadas.length >= 1000) {break;}
    }
    return { carriers, llamadas };
}
