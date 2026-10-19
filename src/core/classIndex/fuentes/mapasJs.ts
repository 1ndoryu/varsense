/* [V6] Partición de classIndexBuilder.ts: mapas de clases exportados y parseo de declaraciones JS. Sin cambio de comportamiento. */
import { isCodeMatch } from '../consumo/consumidores';
import { finTemplateLiteral } from '../plantillas/plantillas';

/* [318A-7V17] Any variable declaration whose value is a class literal
 * (string, template, ternary, array/object of literals). Resolves
 * className={ident} and classList.add(ident) by indirection.
 * The old non-greedy regex broke on closures: in
 * `const Boton = React.forwardRef(..., () => { const clases = [...]; ... })`
 * the first ';' belongs to the INNER declaration, so the match swallowed
 * `const clases = [...]` and its template families (`boton--${variante}`)
 * were never indexed (they stayed orphan FPs). This scan balances (), []
 * and {} with string awareness and cuts only at depth 0. The MAX_TOKENS cap
 * still bounds total memory. */
/* [318A-7V17] Estado de brackets/strings en un índice: permite cortar cada
 * declaración al ';' que devuelve la profundidad a SU nivel de partida (no a
 * 0): `const Boton = React.forwardRef((...) => { const clases = [...]; ... });`
 * arranca a profundidad 0 y solo corta en el ';' tras `});`; la declaración
 * INTERNA `clases` arranca a profundidad 1 y corta en su propio ';' sin ser
 * tragada. Antes, el salto tras el corte ocultaba las declaraciones anidadas
 * y su familia de clases (boton--, 20 FPs en Boton.tsx de PT). */
/* Estado de brackets y comillas en cada posición de la última fuente pedida.
 * escanearDeclaraciones llama a estadoScanning una vez por declaración sobre
 * la misma fuente: sin memo, cada llamada recorría la fuente desde 0. */
let fuenteEstados: string | null = null;
let profundidadesMemo = new Int32Array(0);
let enCadenaMemo = new Uint8Array(0);

function calcularEstados(source: string): void {
    if (source === fuenteEstados) {
        return;
    }
    const profundidades = new Int32Array(source.length + 1);
    const enCadena = new Uint8Array(source.length + 1);
    let profundidad = 0;
    let quote = '';
    let escaped = false;
    for (let cursor = 0; cursor < source.length; cursor++) {
        profundidades[cursor] = profundidad;
        enCadena[cursor] = quote ? 1 : 0;
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
    }
    profundidades[source.length] = profundidad;
    enCadena[source.length] = quote ? 1 : 0;
    fuenteEstados = source;
    profundidadesMemo = profundidades;
    enCadenaMemo = enCadena;
}

export function estadoScanning(source: string, indice: number): { profundidad: number; enString: boolean } {
    calcularEstados(source);
    /* Más allá del final no cambia nada: el estado es el del último carácter */
    const posicion = Math.max(0, Math.min(indice, source.length));
    return { profundidad: profundidadesMemo[posicion], enString: enCadenaMemo[posicion] === 1 };
}

export function escanearDeclaraciones(source: string): Array<{ nombre: string; valor: string; indice: number }> {
    /* [318A-7V22][M1] Admite anotación de tipo TS entre el nombre y el '=':
     * `const CLASES_FUENTE: Record<TamanoFuenteRecordatorio, string> = { ... }`
     * (PanelRecordatorios.tsx:19). La anotación típica (Record<...>, tipo
     * simple) no contiene '=' suelto; el grupo opcional se detiene en el '='
     * de asignación. Un arrow type como anotación (`const f: (a)=>b = ...`,
     * rarísimo en const de componentes) no casa y esa declaración se ignora,
     * igual que antes (sin regresión). */
    const REGEX_INICIO = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:\s*(?:[^=;{}]|=(?!>))*?)?\s*=/g;
    const resultados: Array<{ nombre: string; valor: string; indice: number }> = [];
    let inicio: RegExpExecArray | null;
    while ((inicio = REGEX_INICIO.exec(source)) !== null) {
        const nombre = inicio[1];
        const indice = inicio.index;
        const { profundidad: inicial, enString } = estadoScanning(source, indice);
        if (enString) {
            continue;
        }
        const desde = REGEX_INICIO.lastIndex;
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
        /* No saltar tras el corte: las declaraciones anidadas dentro del valor
         * (const clases dentro del closure de un forwardRef) son declaraciones
         * propias y se capturan en la siguiente iteración del regex. */
    }
    return resultados;
}
/* [318A-7V22][M1] Extrae los valores con forma de clase de un objeto literal
 * (mapa Record<Tipo,string>): `{ pequeno: 'a--p', normal: '', grande: 'a--g' }`
 * devuelve ['a--p', 'a--g']. Escanea miembros de nivel superior (clave: valor)
 * por pares de comillas; ignora objetos anidados y strings vacíos (no clase).
 * No resuelve indentificadores: un valor `clave: otraVariable` no aporta
 * literal y queda fuera (retener > arriesgar FN). */
export function extraerValoresDeMapaClase(valor: string): string[] {
    const valores: string[] = [];
    const cuerpo = valor.trim().replace(/^\{/, '').replace(/\}\s*$/, '');
    /* Miembro `clave: 'valor'` o `'clave': 'valor'` con comillas simples o
     * dobles; el valor se captura sin escapar (solo comillas sin backslash). */
    const reMiembro = /(?:^|[,{])\s*(?:[A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*:\s*(['"])((?:[^'"]|\\.)*?)\1/g;
    let match: RegExpExecArray | null;
    while ((match = reMiembro.exec(cuerpo)) !== null) {
        valores.push(match[2]);
    }
    return valores;
}

/* [299A-13 F3b] Cierre balanceado de un objeto literal desde su '{' de
 * apertura: respeta strings con escape, templates (vía finTemplateLiteral)
 * y comentarios de línea/bloque. -1 sin cierre. */
export function finObjetoLiteral(source: string, apertura: number): number {
    let profundidad = 0;
    let quote = '';
    let escaped = false;
    for (let cursor = apertura; cursor < source.length; cursor++) {
        const current = source[cursor];
        if (quote) {
            if (escaped) {escaped = false;}
            else if (current === '\\') {escaped = true;}
            else if (current === quote) {quote = '';}
            continue;
        }
        if (current === '`') {
            const cierre = finTemplateLiteral(source, cursor);
            if (cierre < 0) {return -1;}
            cursor = cierre;
            continue;
        }
        if (current === '"' || current === "'") {quote = current; continue;}
        if (current === '/' && source[cursor + 1] === '/') {
            const salto = source.indexOf('\n', cursor + 2);
            cursor = salto < 0 ? source.length : salto;
            continue;
        }
        if (current === '/' && source[cursor + 1] === '*') {
            const cierre = source.indexOf('*/', cursor + 2);
            if (cierre < 0) {return -1;}
            cursor = cierre + 1;
            continue;
        }
        if (current === '{') {profundidad++;}
        else if (current === '}') {
            profundidad--;
            if (profundidad === 0) {return cursor;}
        }
    }
    return -1;
}

/* [299A-13 F3b] Mapas de clases exportados de UN archivo: `export const
 * PAYMENT_STATUS_CLASS: Record<PaymentStatus, string> = { pendiente:
 * 'pagoEstado--pendiente', ... }` (api/payments.ts:133 de NAKOMI). Solo
 * exportados (importables cross-file; los locales ya los cubre M1 vía
 * variables); solo valores con forma de clase; la anotación de tipo no
 * puede contener llaves (fail-closed). [11AA-2] También escalares exportados
 * (`export const X = 'a b'`), ver pasada posterior. Exportada para tests. */
export function extraerMapasExportados(source: string): Record<string, string[]> {
    const mapas: Record<string, string[]> = {};
    const reExportMapa = /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;{]+)?=\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = reExportMapa.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const nombre = match[1];
        if (mapas[nombre]) {continue;}
        const apertura = match.index + match[0].length - 1;
        const cierre = finObjetoLiteral(source, apertura);
        if (cierre < 0) {continue;}
        const clases = extraerValoresDeMapaClase(source.slice(apertura, cierre + 1))
            .filter(valor => valor.length > 1 && /^[a-zA-Z_][\w-]*$/.test(valor));
        if (clases.length > 0) {mapas[nombre] = [...new Set(clases)];}
    }
    /* [11AA-2] Escalares exportados (`export const CLASE_TEXTO = 'a b';`) con
     * literal completo: el cierre debe ser `;`, fin de línea o fin de archivo.
     * `'x' + Y` queda fuera (fail-closed). Cada token con forma de clase cuenta;
     * los que llevan brackets o espacios raros se descartan. */
    const reExportEscalar = /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;{]+)?=\s*(['"])([^'"\\\r\n]*)\2(?=[ \t]*(?:;|\r?\n|$))/g;
    let escalar: RegExpExecArray | null;
    while ((escalar = reExportEscalar.exec(source)) !== null) {
        if (!isCodeMatch(source, escalar.index)) {continue;}
        const nombre = escalar[1];
        if (mapas[nombre]) {continue;}
        const clases = escalar[3].split(/\s+/).filter(token => token.length > 1 && /^[a-zA-Z_][\w-]*$/.test(token));
        if (clases.length > 0) {mapas[nombre] = [...new Set(clases)];}
    }
    return mapas;
}

/* [299A-13 F3b] Nombres importados por ruta relativa (`import {
 * STATUS_CLASS } from '../api/admin-users'`, `import D from './x'`,
 * `import * as Ns from './y'`). Solo specs que empiezan por '.' (código
 * propio; librerías fuera por diseño). `import type` se ignora (sin valor
 * runtime). Exportada para tests. */
export function extraerNombresImportadosRelativos(source: string): Set<string> {
    const nombres = new Set<string>();
    const reImport = /import\s+([^'";]+?)\s+from\s*(['"])(\.[^'"]*)\2/g;
    let match: RegExpExecArray | null;
    while ((match = reImport.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        if (/^import\s+type\b/.test(match[0])) {continue;}
        const clausula = match[1].trim();
        /* Miembros nombrados: se extraen por grupo {..} ANTES de partir por
         * comas (partir la cláusula entera rompería `{ A, B as C }` en
         * `{ A` + ` B as C }` y el alias del segundo miembro se perdería). */
        const reGrupoNombrado = /\{([^}]*)\}/g;
        let grupo: RegExpExecArray | null;
        while ((grupo = reGrupoNombrado.exec(clausula)) !== null) {
            for (const miembro of grupo[1].split(',')) {
                const m = miembro.trim();
                if (!m || m.startsWith('type ')) {continue;}
                const alias = /\bas\s+([A-Za-z_$][\w$]*)\s*$/.exec(m);
                const final = alias ? alias[1] : m.split(/\s+/)[0];
                if (/^[A-Za-z_$][\w$]*$/.test(final)) {nombres.add(final);}
            }
        }
        /* Default + namespace: lo que queda fuera de los grupos. */
        const sinGrupos = clausula.replace(/\{[^}]*\}/g, ' ');
        for (const parte of sinGrupos.split(',')) {
            const p = parte.trim();
            if (!p || p.startsWith('{') || p.startsWith('type ')) {continue;}
            if (p.startsWith('*')) {
                const alias = /\bas\s+([A-Za-z_$][\w$]*)\s*$/.exec(p);
                if (alias) {nombres.add(alias[1]);}
            } else {
                const base = p.split(/\s+/)[0];
                if (/^[A-Za-z_$][\w$]*$/.test(base)) {nombres.add(base);}
            }
        }
    }
    return nombres;
}
