import { CancellationError, CancellationToken, DocumentCacheProvider, DocumentProvider, throwIfCancelled, WorkspaceFile, WorkspaceFileProvider } from './workspaceProviders';
import { PersistentIndexStore, sha256File } from './persistentIndex';

export interface ClaseCssDefinida {
    nombre: string;
    archivo: string;
    linea: number;
    columna: number;
    selector: string;
}

export interface ResultadoClasesHuerfanas {
    totalClasesDefinidas: number;
    totalClasesUsadas: number;
    totalClasesHuerfanas: number;
    clasesHuerfanas: ClaseCssDefinida[];
    archivosAnalizadosCss: number;
    archivosAnalizadosConsumo: number;
    tiempoMs: number;
}

export interface ClassIndexScanOptions {
    exclude: string[];
    minLength?: number;
    excludedClassPatterns?: string[];
    cssPatterns?: string[];
    consumerPatterns?: string[];
    token?: CancellationToken;
}

export type ClassScanProgress = (fase: string, actual: number, total: number) => void;

const DEFAULT_CSS_PATTERNS = ['**/*.css'];
/* [318A-7V3] Los CSS también consumen clases: un selector compuesto en otro
 * archivo (.dashboardGrid en movilBase.css refiriendo la definición de
 * base.css) prueba que la clase se aplica en runtime; borrarla cambiaría el
 * diseño. El scan() excluye el archivo de definición de cada clase (por eso
 * el extractor devuelve tokens por archivo), así una clase solo pierde su
 * reporte si aparece como selector en OTRO CSS. */
const DEFAULT_CONSUMER_PATTERNS = [
    '**/*.tsx', '**/*.jsx',
    '**/*.ts', '**/*.js',
    '**/*.php', '**/*.html',
    '**/*.css'
];
const DEFAULT_MIN_LENGTH = 3;
/* [318A-7V2] Props que portan clases en los design systems del área:
 * className/class más cualquier prop con nombre clase/Clase al inicio
 * (claseAdicional, claseExtra, claseContenido, claseOverlay, claseContenedor,
 * clase). Verificado repo-wide: en todos los consumidores estas props se
 * concatenan al className del componente; ninguna prop *clase es dato.
 * El patrón se reutiliza en attr/template/jsx-expr para que los tres
 * formularios de valor cubran las mismas props. */
/* Los tres patrones comparten la alternancia de props portadoras:
 * className/class y cualquier prop cuyo nombre empiece por clase/Clase. */
const REGEX_CLASS_ATTR = /(?:className|class|[Cc]lase[\w$]*)\s*=\s*["']([^"']+)["']/g;
/* [318A-7V18] Apertura de template literal en atributo de clase:
 * className/class/*clase={...`template`...}. El scanner balanceado
 * (finTemplateLiteral/finExpresion) sustituye al regex plano [J-8]
 * porque el regex no puede con templates anidados
 * (claseAdicional={`a ${x ? `b${y}` : ''}`} en SelectorNivel/ModalExperimentos)
 * ni con post-procesado tras el cierre (className={`a ${x}`.trim()} en
 * AccionesItem). */
const REGEX_CLASS_TEMPLATE_INICIO = /(?:className|class|[Cc]lase[\w$]*)\s*=\s*\{\s*`/g;
/* [J-8] JSX/TSX className={expr} con ternarios y literales: cubre
 * className={cond ? 'a' : 'b'} y className={'a b'}. Los identificadores
 * puros se resuelven por indirección de variables (ver recopilarDeclaraciones).
 * [318A-7V2] Ídem para props *clase (claseAdicional={cond ? 'a' : 'b'}). */
const REGEX_CLASS_JSX_EXPR = /(?:className|class|[Cc]lase[\w$]*)\s*=\s*\{([^{}]*)\}/g;
/* Vanilla TS/DOM factories commonly pass classes as object attributes:
 * createEl('div', { className: 'panel panel--active' }). Keep this parser
 * framework-agnostic while covering the project's createEl contract.
 * [318A-7V3] Misma familia de props portadoras que las atribuciones
 * (verificada repo-wide): { clase: 'badgePremium' }, { claseAdicional: x } —
 * el consumidor concatena el valor al className (FilaUsuario/ResumenAdmin
 * de PT). Las props de datos (estado, tipo, texto) no casan con el patrón.
 * [318A-7V21] La alternancia admite también claves camelCase que TERMINAN
 * en Class/clase (imageClass, iconClass): el nombre es la convención del
 * carrier (AGAPE AgapeLanding.tsx:20/27/34 imageClass: 'activity-image-*'
 * interpolado en className={`activity-image ${item.imageClass}`}). Solo
 * casan claves finales: classification/classList no terminan en Class y
 * quedan fuera por diseño (son dato/método, no carrier). */
const REGEX_CLASS_OBJECT = /(?:['"]?(?:className|class|[Cc]lase[\w$]*|[\w$]*[Cc]lass)['"]?)\s*:\s*(?:['"]([^'"]+)['"]|[`]([^`]+)[`])/g;
/* [318A-7V21] RC-4: propiedad objeto con VALOR VARIABLE (`className:
 * clases.join(' ')` en notifications-popover.ts:83). La vía literal de arriba
 * no casa; aquí se captura el identificador (con su `.join(...)` opcional) y
 * se resuelve por indirección contra el mapa de declaraciones + pushs. */
const REGEX_CLASS_OBJECT_VAR = /(?:['"]?(?:className|class|[Cc]lase[\w$]*|[\w$]*[Cc]lass)['"]?)\s*:\s*([A-Za-z_$][\w$]*)(?:\s*\.\s*join\s*\([^)]*\))?\s*(?=[,}])/g;
const REGEX_CLASS_FACTORY = /createContainer\s*\(\s*['"]([^'"]+)['"]/g;
const REGEX_EXTERNAL_LINK_CLASS = /createExternalLink\s*\([^,]+,[^,]+,\s*['"]([^'"]+)['"]/g;
/* [J-8] createElement(tag, 'clase') posicional: Glory-Laminal pasa la clase
 * como segundo argumento (helper createElement(tag, className, text)). */
const REGEX_CREATE_ELEMENT_CLASS = /createElement\s*\(\s*['"][^'"]+['"]\s*,\s*([^)]*)\)/g;
/* [318A-7V23] Apertura de la factoría DOM posicional el(tag, cls): el
 * micro-helper el() (GH dom.ts: `el(tag, cls?) → e.className = cls`) porta
 * clases en su 2º argumento igual que createElement [J-8]. El 2º argumento se
 * extrae con el divisor balanceado (soporta ternarios/concat multilínea y
 * templates con ${}; el regex plano [J-8] no puede con paréntesis anidados).
 * Solo cuenta con 1er argumento tag literal ('div'): un el() con tag dinámico
 * u otra semántica queda fuera por diseño (retener > arriesgar FN). */
const REGEX_EL_FACTORY = /\bel\s*\(/g;
/* [J-8] classList.add/toggle/remove: toggle('clase', cond) y remove('clase')
 * son usos reales igual que add.
 * [318A-7V23] contains/replace: classList.contains('sel') es una lectura que
 * exige la clase en runtime igual que add (glory-harness sidebarCeldas); sin
 * esta rama la clase solo se veía si otro sink la tocaba. */
const REGEX_CLASS_LIST = /classList\.(?:add|toggle|remove|contains|replace)\s*\(([^)]*)\)/g;
/* [318A-7V23] Apertura de setAttribute('class', ...): el 2º argumento se
 * extrae balanceado (ver loop en extraerTokensDeTexto). */
const REGEX_SET_ATTRIBUTE_CLASS = /\bsetAttribute\s*\(\s*['"]class['"]\s*,/g;
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
function estadoScanning(source: string, indice: number): { profundidad: number; enString: boolean } {
    let profundidad = 0;
    let quote = '';
    let escaped = false;
    for (let cursor = 0; cursor < indice; cursor++) {
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
    return { profundidad, enString: Boolean(quote) };
}

function escanearDeclaraciones(source: string): Array<{ nombre: string; valor: string; indice: number }> {
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
function extraerValoresDeMapaClase(valor: string): string[] {
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

/* [318A-7V22][M2] Compone los tokens de templates que interpolan variables
 * locales ya declaradas con valor de clase: `const claseBase =
 * 'itemNotificacion'; const claseLeida = notif.leida ? \`${claseBase}--leida\`
 * : ''` (ItemNotificacion.tsx:77). En runtime el template concatena el
 * literal de la variable con el segmento estático pegado → `itemNotificacion--
 * leida`. addClassTokens no compone (descarta el `${ident}` por no ser
 * literal); aquí, si TODAS las interpolaciones del template son identificadores
 * puros con set en `variables`, se genera el producto acotado segmento +
 * token + segmento. Guard: el token compuesto debe tener FORMA de clase (BEM
 * `--`, CamelCase/dígito); una palabra minúscula (prosa: `archivo${x}s`) no
 * pasa, reteniendo el contrato de no inventar familias. */
function resolverTemplatesDeVariables(
    valor: string,
    variables: Map<string, Set<string>>,
    destino: Set<string>
): void {
    for (const literal of extraerLiterales(valor)) {
        if (!literal.includes('${')) {
            continue;
        }
        const { segmentos, expresiones } = descomponerTemplate(literal);
        if (expresiones.length === 0) {
            continue;
        }
        const conjuntos: Array<Set<string>> = [];
        let combinaciones = 1;
        let resoluble = true;
        for (const expr of expresiones) {
            const ident = expr.trim();
            if (!/^[A-Za-z_$][\w$]*$/.test(ident)) {
                resoluble = false;
                break;
            }
            const conjunto = variables.get(ident);
            if (!conjunto || conjunto.size === 0) {
                resoluble = false;
                break;
            }
            conjuntos.push(conjunto);
            combinaciones *= conjunto.size;
            if (combinaciones > 64) {
                resoluble = false;
                break;
            }
        }
        if (!resoluble || conjuntos.length !== expresiones.length) {
            continue;
        }
        /* Producto cartesiano acotado: segmento_0 · token_0 · segmento_1 ·
         * token_1 · ... · segmento_n. */
        let resultados = [''] as string[];
        for (let e = 0; e < expresiones.length; e++) {
            const siguientes: string[] = [];
            for (const base of resultados) {
                for (const token of conjuntos[e]) {
                    siguientes.push(base + token + segmentos[e + 1]);
                }
            }
            /* El primer segmento (antes de la primera interpolación) se aplica
             * al inicio. */
            if (e === 0) {
                resultados = siguientes.map(s => segmentos[0] + s);
            } else {
                resultados = siguientes;
            }
        }
        for (const compuesto of resultados) {
            if (compuesto.length > 1 && /^[a-zA-Z_][\w-]*$/.test(compuesto)) {
                destino.add(compuesto);
            }
        }
    }
}

/* [318A-7V22][M3] Literales de return de una flecha AUTO-INVOCADA (IIFE) con
 * cuerpo de bloque, asignada a una variable portadora que luego se interpola
 * en un className:
 * `const claseUrgencia = (() => { if (x) return 'barraRellenoCompletado'; if
 * (p >= 80) return 'barraRellenoUrgenteCritico'; ... return ''; })();`
 * (FilaSubHabito.tsx:51-55). Cada `return <literal>` es una clase real que el
 * runtime aplica sobre la base. Sin resolver, los sufijos
 * `barraRellenoCompletado/UrgenteCritico/Urgente/Advertencia` se reportan
 * huérfanos (el valor no es string/ternario/array/objeto, así que
 * recopilarDeclaraciones no registra nada).
 * Guard anti-FN: solo se procesan flechas auto-invocadas (`})()` tras el
 * cierre del cuerpo). Una flecha NO invocada (`const C = (p) => { return
 * <div className="x"/>; }`) tiene returns JSX y no produce un string de
 * clases en runtime; si se incluyera, `x` del JSX entraría al set de una
 * variable y podría tapar una clase muerta por indirección. */
function extraerReturnsDeIIFE(valor: string, tokens: Set<string>, familyPrefixes?: Set<string>): void {
    const reArrow = /=>\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = reArrow.exec(valor)) !== null) {
        const indiceCuerpo = match.index + match[0].length - 1;
        let profundidad = 0;
        let quote = '';
        let cierre = -1;
        for (let cursor = indiceCuerpo; cursor < valor.length; cursor++) {
            const c = valor[cursor];
            if (quote) {
                if (c === '\\') {cursor++; continue;}
                if (c === quote) {quote = '';}
                continue;
            }
            if (c === '"' || c === "'" || c === '`') {quote = c; continue;}
            if (c === '{') {profundidad++;}
            else if (c === '}') {
                profundidad--;
                if (profundidad === 0) {cierre = cursor; break;}
            }
        }
        if (cierre < 0) {
            continue;
        }
        const restoTrasCierre = valor.slice(cierre + 1);
        if (!/^\s*\)\s*\(\s*\)/.test(restoTrasCierre)) {
            reArrow.lastIndex = cierre + 1;
            continue;
        }
        const cuerpo = valor.slice(indiceCuerpo + 1, cierre);
        const reReturn = /\breturn\b/g;
        let ret: RegExpExecArray | null;
        while ((ret = reReturn.exec(cuerpo)) !== null) {
            const resto = cuerpo.slice(reReturn.lastIndex);
            const literales = extraerLiterales(resto);
            if (literales.length > 0) {
                addClassTokens(literales[0], tokens, familyPrefixes);
            }
            const finStatement = resto.indexOf(';');
            if (finStatement < 0) {
                break;
            }
            reReturn.lastIndex = reReturn.lastIndex + finStatement + 1;
        }
        reArrow.lastIndex = cierre + 1;
    }
}

/* [318A-7V5] Extracción de literales por pares de comillas. El regex de
 * agrupación anterior (['"`]([^'"`$]+)['"`]) falla con literales vacíos
 * seguidos de más texto: `: ''\n , estaX ? 'claseReal'` toma la comilla de
 * cierre del vacío como apertura y se traga la clase real, emitiendo en su
 * lugar el identificador (VistaCelda.tsx de PT). El escaneo respeta pares,
 * escapes y el contenido de templates con ${...}. */
function extraerLiterales(value: string): string[] {
    const literales: string[] = [];
    for (let index = 0; index < value.length; index++) {
        const current = value[index];
        if (current !== "'" && current !== '"' && current !== '`') {
            continue;
        }
        const quote = current;
        let contenido = '';
        index++;
        for (; index < value.length; index++) {
            const c = value[index];
            if (c === '\\') {
                contenido += c;
                if (index + 1 < value.length) {
                    contenido += value[index + 1];
                    index++;
                }
                continue;
            }
            if (c === quote) {
                break;
            }
            contenido += c;
        }
        literales.push(contenido);
    }
    return literales;
}
/* [J-8] El cap evita que un workspace enorme agote memoria, pero 10000 deja
 * sin escanear archivos posteriores (MapaV2.tsx etc.) en proyectos medianos.
 * 50k cubre la práctica real con RSS holgado (70MB en workspace-manager). */
const MAX_TOKENS = 50000;

/* [028A-8 tramo 4] Nombres de variables referenciadas con var(--x) en un
 * texto CSS. Permite al índice inverso de variables seleccionar consumidores. */
export function extraerUsoVariablesDeTexto(texto: string): string[] {
    const usos = new Set<string>();
    const regexVar = /var\(\s*(--[\w-]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regexVar.exec(texto)) !== null) {
        usos.add(match[1]);
    }
    return [...usos].sort();
}

export function extraerClasesDeTexto(texto: string, rutaArchivo: string): ClaseCssDefinida[] {
    const clases: ClaseCssDefinida[] = [];
    const textoLimpio = texto.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
    const lineas = textoLimpio.split('\n');
    const regexClase = /\.([a-zA-Z_][\w-]*)/g;

    for (let numLinea = 0; numLinea < lineas.length; numLinea++) {
        const linea = lineas[numLinea];
        const trimmed = linea.trim();

        if (!trimmed) {
            continue;
        }

        /* [318A-7V21] `url('/logo-agape.png')` no es un selector: el `.png`
         * del nombre de archivo casaba con regexClase y producía la clase
         * fantasma 'png' (AgapeLanding.css:43-44 en AGAPE). Se neutraliza
         * el segmento url(...) (con o sin comillas) antes del escaneo. */
        const lineaEscaneable = linea.replace(/url\(\s*(['"])(?:(?!\1).)*\1\s*\)|url\(\s*[^)'"]+\s*\)/gi, ' ');

        const esPropiedad = /^\s*[\w-]+\s*:(?!:)/.test(linea) && !linea.includes('{');
        if (esPropiedad) {
            continue;
        }

        if (trimmed.startsWith('@') && !trimmed.includes('{')) {
            continue;
        }

        let match: RegExpExecArray | null;
        while ((match = regexClase.exec(lineaEscaneable)) !== null) {
            clases.push({
                nombre: match[1],
                archivo: rutaArchivo,
                linea: numLinea,
                columna: match.index,
                selector: trimmed
            });
        }
        regexClase.lastIndex = 0;
    }

    return clases;
}

/* [318A-7V14] Prefijo de familia de template literal. Un token estático
 * PEGADO a una interpolación (`badgeInfo--${variante}`, `selectorNivelBoton${sufijo}`,
 * `boton--${variante}`) marca como EN-USO toda la familia de clases cuyo
 * nombre empiece por ese prefijo: el sufijo se emite en runtime desde una
 * unión/mapa que indexar literalmente exigiría resolver tipos (verificado
 * en VAR-4: BadgeInfo.tsx, SelectorNivel.tsx, Boton.tsx). Solo cuenta el
 * token pegado (sin espacio previo): una interpolación separada por espacio
 * (`estadoViabilidad ${viabilidad.estado}`) aporta la clase COMPLETA, no una
 * familia — esa vía ya la resuelven las variables/switch. Nunca marca clases
 * fuera de la familia ni exime el reporte de un token exacto.*/
/* [318A-7V18] Escáner balanceado de templates/interpolaciones: el regex
 * `\$\{[^}]*\}` y el `[^`]+` plano se rompen con templates ANIDADOS
 * (interpolación cuyo cuerpo contiene otro template: SelectorNivel.tsx:39,
 * ModalExperimentos.tsx) — se cortan en el `}`/backtick INTERIOR y el resto
 * queda sin tokenizar (clases literales y familias perdidas). Estos
 * escáneres recorren char a char respetando escapes, strings, llaves
 * anidadas, comentarios de código y templates anidados dentro de ${...}. */
function finExpresion(source: string, indiceLlave: number): number {
    let i = indiceLlave + 1;
    let quote = '';
    let profundidad = 1;
    while (i < source.length) {
        const c = source[i];
        if (quote) {
            if (c === '\\') {i += 2; continue;}
            if (c === quote) {quote = '';}
            i++;
            continue;
        }
        if (c === '"' || c === "'") {quote = c; i++; continue;}
        if (c === '`') {
            const cierre = finTemplateLiteral(source, i);
            if (cierre < 0) {return -1;}
            i = cierre + 1;
            continue;
        }
        if (c === '/') {
            const siguiente = source[i + 1];
            if (siguiente === '/') {while (i < source.length && source[i] !== '\n') {i++;} continue;}
            if (siguiente === '*') {
                const fin = source.indexOf('*/', i + 2);
                i = fin < 0 ? source.length : fin + 2;
                continue;
            }
        }
        if (c === '{') {profundidad++;}
        else if (c === '}') {
            profundidad--;
            if (profundidad === 0) {return i;}
        }
        i++;
    }
    return -1;
}

function finTemplateLiteral(source: string, indiceApertura: number): number {
    let i = indiceApertura + 1;
    while (i < source.length) {
        const c = source[i];
        if (c === '\\') {i += 2; continue;}
        if (c === '`') {return i;}
        if (c === '$' && source[i + 1] === '{') {
            const cierre = finExpresion(source, i + 1);
            if (cierre < 0) {return -1;}
            i = cierre + 1;
            continue;
        }
        i++;
    }
    return -1;
}

/* Separa el contenido de un template (sin backticks) en segmentos estáticos
 * y cuerpos de interpolación BALANCEADOS (nested templates incluidos). */
function descomponerTemplate(valor: string): { segmentos: string[]; expresiones: string[] } {
    const segmentos: string[] = [];
    const expresiones: string[] = [];
    let inicio = 0;
    let i = 0;
    while (i < valor.length) {
        if (valor[i] === '$' && valor[i + 1] === '{') {
            segmentos.push(valor.slice(inicio, i));
            const cierre = finExpresion(valor, i + 1);
            if (cierre < 0) {
                segmentos.push(valor.slice(i));
                return { segmentos, expresiones };
            }
            expresiones.push(valor.slice(i + 2, cierre));
            i = cierre + 1;
            inicio = i;
        } else {
            i++;
        }
    }
    segmentos.push(valor.slice(inicio));
    return { segmentos, expresiones };
}

/* [318A-7V14] Prefijo de familia de template literal. Un token estático
 * PEGADO a una interpolación (`badgeInfo--${variante}`, `selectorNivelBoton${sufijo}`,
 * `boton--${variante}`) marca como EN-USO toda la familia de clases cuyo
 * nombre empiece por ese prefijo: el sufijo se emite en runtime desde una
 * unión/mapa que indexar literalmente exigiría resolver tipos (verificado
 * en VAR-4: BadgeInfo.tsx, SelectorNivel.tsx, Boton.tsx). Solo cuenta el
 * token pegado (sin espacio previo): una interpolación separada por espacio
 * (`estadoViabilidad ${viabilidad.estado}`) aporta la clase COMPLETA, no una
 * familia — esa vía ya la resuelven las variables/switch. Nunca marca clases
 * fuera de la familia ni exime el reporte de un token exacto.
 * [318A-7V18] contextoAttr: dentro de un atributo className/class/*clase el
 * contenido del template ES una cadena de clases por construcción, así que
 * el guard de prosa (V17) solo aplica a declaraciones/cadenas fuera de
 * atributos (` archivo${...}`, `recordatorio${...}` de TareaBadges). Un
 * prefijo pegado en minúsculas dentro de un atributo (`item-${x}`) es una
 * familia real. */
function registrarPrefijosFamilia(value: string, familyPrefixes: Set<string>, contextoAttr = false): void {
    if (!value.includes('${')) {
        return;
    }
    const { segmentos } = descomponerTemplate(value);
    /* Cada segmento salvo el último termina donde arranca la interpolación. */
    for (let i = 0; i < segmentos.length - 1; i++) {
        const segmento = segmentos[i];
        /* [318A-7V17] La familia es el token PEGADO al `${`, no el segmento
         * completo: `badgeInfo badgeInfo--${variante}` (BadgeInfo.tsx:34)
         * comparte segmento con otra clase literal y seguiría siendo una
         * familia válida `badgeInfo--`. Tomar el último run sin whitespace. */
        const ultimoRun = segmento.match(/([A-Za-z_][\w-]*)$/);
        if (!ultimoRun) {
            continue;
        }
        const ultimo = ultimoRun[1];
        if (ultimo.length <= 2) {
            continue;
        }
        /* Guard de prosa (fuera de atributos): `recordatorio${n > 1 ? 's' : ''}`,
         * ` archivo${...}`/` adjunto${...}` (TareaBadges.tsx:143,
         * usePanelRecordatorios.ts:141) interpolan PALABRAS en minúscula sin
         * guion; solo tokens con forma de clase (BEM `--` o CamelCase/dígito)
         * son familias. Verificado: `adjunto` absorbía
         * `adjuntosAreaCarga--bloqueado` (huérfana real sin consumidor). */
        if (!contextoAttr && !ultimo.endsWith('--') && !/[A-Z0-9]/.test(ultimo)) {
            continue;
        }
        familyPrefixes.add(ultimo);
    }
}

function addClassTokens(value: string, tokens: Set<string>, familyPrefixes?: Set<string>, contextoAttr = false): void {
    if (familyPrefixes) {
        registrarPrefijosFamilia(value, familyPrefixes, contextoAttr);
    }
    /* [318A-7V18] descomponerTemplate en lugar de replace con `\$\{[^}]*\}`:
     * el regex se cortaba en el `}` INTERIOR de un template anidado y dejaba
     * basura en los segmentos estáticos (SelectorNivel.tsx:39). */
    const { segmentos, expresiones } = descomponerTemplate(value);
    for (const segmento of segmentos) {
        for (const clase of segmento.split(/\s+/)) {
            if (clase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(clase)) {
                tokens.add(clase);
            }
        }
    }

    /* Conserva clases literales dentro de ternarios/template expressions:
     * `campo ${error ? 'campoError' : ''}`. Nunca agrega identificadores.
     * Los cuerpos balanceados pueden contener templates anidados; sus
     * literales (comillas/backticks) se extraen recursivamente aquí. */
    for (const body of expresiones) {
        for (const literal of extraerLiterales(body)) {
            addClassTokens(literal, tokens, familyPrefixes, contextoAttr);
        }
    }
}

/* [J-8] Recopila declaraciones cuyo valor es un literal de clases: string,
 * template, ternario con literales o array de literales. Permite resolver
 * className={ident}, classList.add(ident) y createElement(tag, ident) por
 * indirección de variable (const x = 'a b'; ...; className={x}). Solo
 * literales: una llamada a función (helper('clase')) NO resuelve, manteniendo
 * el contrato del test 'unusedPanel'. */
const REGEX_SWITCH_SUBJECT = /\bswitch\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/g;
const REGEX_SWITCH_CASE = /\bcase\s*['"]([A-Za-z_][\w-]*)['"]\s*:/g;
/* [318A-7V3] Resuelve interpolaciones de template className={\`... ${x.y} ...\`}:
 * 1) identificador puro → mapa de declaraciones (VistaResizeHandle de PT);
 * 2) cadenas con punto que también son sujeto de un switch en el MISMO
 * archivo → los literales de sus case son los valores que en runtime se
 * interpolan como clases (CabeceraArbitraje: switch (viabilidad.estado) +
 * className={\`estadoViabilidad ${viabilidad.estado}\`}).
 * La parte 2 se resuelve en extraerTokensDeTexto, que tiene el source. */
function addTemplateClassTokens(value: string, variables: Map<string, Set<string>>, tokens: Set<string>, familyPrefixes?: Set<string>, contextoAttr = false): void {
    if (familyPrefixes) {
        registrarPrefijosFamilia(value, familyPrefixes, contextoAttr);
    }
    const { segmentos, expresiones } = descomponerTemplate(value);
    for (const segmento of segmentos) {
        for (const clase of segmento.split(/\s+/)) {
            if (clase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(clase)) {
                tokens.add(clase);
            }
        }
    }

    for (const body of expresiones) {
        const trimmed = body.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
            const resuelto = variables.get(trimmed);
            if (resuelto) {
                for (const token of resuelto) {
                    tokens.add(token);
                }
            }
        }
        /* [318A-7V22][M1] Subíndice sobre un mapa de clases dentro de un
         * atributo de clase: `CLASES_FUENTE[config.tamanoFuente]`
         * (PanelRecordatorios.tsx:91). Todas las claves del Record son
         * alcanzables en runtime (la variable es el mapa completo), así que
         * el subíndice resuelve el set de la variable igual que un ident. */
        const subindice = /^([A-Za-z_$][\w$]*)\s*\[[^\]]+\]$/.exec(trimmed);
        if (subindice) {
            const resueltoMapa = variables.get(subindice[1]);
            if (resueltoMapa) {
                for (const token of resueltoMapa) {
                    tokens.add(token);
                }
            }
        }
        for (const literal of extraerLiterales(body)) {
            addClassTokens(literal, tokens, familyPrefixes, contextoAttr);
        }
    }
}

/* [318A-7V3] Si una cadena con punto interpolada en un className template
 * coincide exactamente con el sujeto de un switch del mismo archivo, los
 * literales de sus case son las clases aplicadas en runtime. */
function resolverSwitchTemplate(template: string, source: string, tokens: Set<string>): void {
    const { expresiones } = descomponerTemplate(template);
    const cadenas = new Set<string>();
    for (const body of expresiones) {
        const trimmed = body.trim();
        if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(trimmed)) {
            cadenas.add(trimmed);
        }
    }
    if (cadenas.size === 0) {
        return;
    }
    REGEX_SWITCH_SUBJECT.lastIndex = 0;
    let subjectMatch: RegExpExecArray | null;
    while ((subjectMatch = REGEX_SWITCH_SUBJECT.exec(source)) !== null) {
        if (!isCodeMatch(source, subjectMatch.index) || !cadenas.has(subjectMatch[1])) {
            continue;
        }
        REGEX_SWITCH_CASE.lastIndex = 0;
        let caseMatch: RegExpExecArray | null;
        while ((caseMatch = REGEX_SWITCH_CASE.exec(source)) !== null) {
            if (caseMatch.index < subjectMatch.index) {
                continue;
            }
            tokens.add(caseMatch[1]);
        }
        break;
    }
}

function previousCodeCharacter(source: string, index: number): string {
    let cursor = index - 1;
    while (cursor >= 0 && /\s/.test(source[cursor])) {cursor--;}
    return cursor >= 0 ? source[cursor] : '';
}

function addQuotedClassTokens(value: string, tokens: Set<string>, familyPrefixes?: Set<string>): void {
    for (const literal of extraerLiterales(value)) {
        addClassTokens(literal, tokens, familyPrefixes);
    }
}

function addDeclarationClassTokens(value: string, tokens: Set<string>, familyPrefixes?: Set<string>): void {
    const trimmed = value.trim();
    if (/^(['"`])[\s\S]*\1$/.test(trimmed)) {
        addClassTokens(trimmed.slice(1, -1), tokens, familyPrefixes);
        addQuotedClassTokens(trimmed, tokens, familyPrefixes);
        return;
    }
    if (pareceTernarioDeLiterales(trimmed)) {
        addQuotedClassTokens(trimmed, tokens, familyPrefixes);
    }
}

/* [J-8] Recorta cadenas de métodos al final de un valor para reducir
 * `\`campo ${x}\`.trim()` o `['a','b'].join(' ')` a su literal base. */
function normalizarValorLiteral(value: string): string {
    let current = value.trim();
    for (;;) {
        const recortado = current.replace(/\s*\.\s*\w+\s*\([^)]*\)\s*$/, '');
        if (recortado === current) {
            break;
        }
        current = recortado;
    }
    return current;
}

/* [J-8] Recopila declaraciones cuyo valor es un literal de clases: string,
 * template, ternario con literales o array de literales. Permite resolver
 * className={ident}, classList.add(ident) y createElement(tag, ident) por
 * indirección de variable (const x = 'a b'; ...; className={x}). Solo
 * literales: una llamada a función (helper('clase')) NO resuelve, manteniendo
 * el contrato del test 'unusedPanel'. */
function recopilarDeclaraciones(source: string, familyPrefixes?: Set<string>): Map<string, Set<string>> {
    const variables = new Map<string, Set<string>>();

    for (const declaracion of escanearDeclaraciones(source)) {
        if (!isCodeMatch(source, declaracion.indice)) {
            continue;
        }
        const previous = previousCodeCharacter(source, declaracion.indice);
        if (previous && /[\w'"`]/.test(previous)) {
            continue;
        }
        const nombre = declaracion.nombre;
        /* className/contentClass se resuelven aparte (ver extraerTokensDeTexto). */
        if (nombre === 'className' || nombre === 'contentClass') {
            continue;
        }
        const valor = normalizarValorLiteral(declaracion.valor);
        const tokensVariable = new Set<string>();
        if (/^(['"`])[\s\S]*\1$/.test(valor)) {
            addClassTokens(valor.slice(1, -1), tokensVariable, familyPrefixes);
            addQuotedClassTokens(valor, tokensVariable, familyPrefixes);
        } else if (pareceTernarioDeLiterales(valor)) {
            addQuotedClassTokens(valor, tokensVariable, familyPrefixes);
        } else if (valor.startsWith('[')) {
            addQuotedClassTokens(valor, tokensVariable, familyPrefixes);
        } else if (valor.trim().startsWith('{')) {
            /* [318A-7V22][M1] Mapa/objeto literal de clases: una variable
             * tipada como Record<Tipo, string> cuyos valores son clases
             * (PanelRecordatorios.tsx:19 `CLASES_FUENTE:
             * Record<TamanoFuenteRecordatorio, string> = { pequeno:
             * 'recordatoriosTexto--pequeno', normal: '', grande:
             * 'recordatoriosTexto--grande' }` indexado en :91 por
             * `CLASES_FUENTE[config.tamanoFuente]`). Se registra la variable
             * con TODOS sus valores con forma de clase; el subíndice
             * M[clave] en un atributo de clase resuelve el set completo
             * (todas las claves del Record son alcanzables en runtime). Los
             * valores vacíos ('') se ignoran (no son clase). */
            for (const valorClase of extraerValoresDeMapaClase(valor)) {
                if (valorClase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(valorClase)) {
                    tokensVariable.add(valorClase);
                }
            }
        } else if (/^\s*\(\s*\(?\s*\)?\s*=>\s*\{/.test(valor)) {
            /* [318A-7V22][M3] IIFE flecha auto-invocada asignada a una
             * variable portadora (FilaSubHabito.tsx:51: `const claseUrgencia =
             * (() => { if (...) return 'barraRellenoCompletado'; ... })();`).
             * Sus `return <literal>` son las clases que el runtime aplica;
             * se registran en el set para la vía className={ident} /
             * interpolation. Solo flechas auto-invocadas (ver guard en el
             * helper): una flecha componente NO invocada no produce un
             * string de clases. */
            extraerReturnsDeIIFE(valor, tokensVariable, familyPrefixes);
        }
        /* [318A-7V22][M2] Templates que interpolan variables locales ya
         * declaradas: `const claseLeida = notif.leida ? \`${claseBase}--leida\`
         * : ''` con `const claseBase = 'itemNotificacion'`
         * (ItemNotificacion.tsx:77). El template compone literal + token en
         * runtime; se resuelve contra el set ya recopilado de la variable
         * interpolada (orden de declaración garantiza que la base precede a
         * su consumidora). Sin resolver, el set de claseLeida queda sin la
         * clase compuesta y `itemNotificacion--leida` se reporta huérfana. */
        resolverTemplatesDeVariables(valor, variables, tokensVariable);
        if (tokensVariable.size > 0) {
            variables.set(nombre, tokensVariable);
        }
    }
    /* [318A-7V20] RC-1: asignaciones compuestas (`clase += 'x'`) componen el
     * set de una variable ya declarada como portadora (SelectorFechaCalendario
     * .tsx:75: clase += ' ...--hoy'). escanearDeclaraciones solo lee `x =`,
     * así que el literal añadido jamás llegaba al índice; aquí se fusiona al
     * set para la vía de indirección className={clase}. */
    for (const compuesto of escanearAsignacionesCompuestas(source)) {
        if (!isCodeMatch(source, compuesto.indice)) {
            continue;
        }
        const conjunto = variables.get(compuesto.nombre);
        if (conjunto) {
            addQuotedClassTokens(compuesto.valor, conjunto, familyPrefixes);
        }
    }
    /* [318A-7V21] RC-4: los push sobre carriers fusionan sus literales al set
     * de la variable (misma vía que la asignación compuesta), para que la
     * indirección className={clases} / className: clases.join(' ') los vea. */
    for (const push of escanearPushs(source)) {
        if (!isCodeMatch(source, push.indice)) {
            continue;
        }
        const conjunto = variables.get(push.nombre);
        if (conjunto) {
            addQuotedClassTokens(push.valor, conjunto, familyPrefixes);
        }
    }
    return variables;
}

/* [318A-7V17] Un ternario real tiene el '?' PEGADO/SEGUIDO de un literal
 * (`cond ? 'a' : 'b'`, `${x ? 'a' : ''}`). El optional-chaining (`resto?.claseExt`)
 * también contiene '?' pero no es ternario de literales: un includes('?')
 * amplio hacía que el valor completo de un closure (React.forwardRef con
 * `resto?.claseExt`) se clasificara como ternario, extrayendo sus literales
 * y registrando familias falsas. */
/* [318A-7V20] RC-1: `clase += 'selectorFechaCalendario__dia--hoy'` — el
 * acumulador compone clases sobre una variable ya portadora. escanearDeclaraciones
 * solo lee `x =`; este barrido captura `x +=` con el mismo escaneo acotado. */
function escanearAsignacionesCompuestas(source: string): Array<{ nombre: string; valor: string; indice: number }> {
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
function escanearPushs(source: string): Array<{ nombre: string; valor: string; indice: number }> {
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
function escanearReturns(source: string): Array<{ valor: string; indice: number }> {
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
 * el call-site aportan (un ident/boolean nunca se indexa). Deliberadamente
 * mismo-archivo: un índice cross-file rompería el caché por hash de
 * loadConsumerTokens (la entrada de B dependería del contenido de A); los
 * carriers exportados usados cross-file (marcarCuerpo, icono, ponerIcono de
 * GH) quedan como residual documentado para V24. */
function nombreParametroBase(parametro: string): string | null {
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

function mencionaIdentificador(texto: string, nombre: string): boolean {
    return new RegExp('\\b' + nombre + '\\b').test(texto);
}

/* Textos de sink dentro de un cuerpo: argumentos que en runtime SON clases.
 * Se reutiliza dividirArgumentosLlamada para no tronchar args anidados. */
function textosSinkDeCuerpo(cuerpo: string): string[] {
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
        const args = dividirArgumentosLlamada(source, match.index + match[0].length - 1);
        if (args && args.length >= 2) {textos.push(args[1]);}
    }
    /* Contenido de class="..." en templates del cuerpo (iconoHtml:
     * `<svg class="${cls}">`): el local interpolado resuelve a un hop. */
    const reAttrHtml = /\bclass\s*=\s*(["'])([\s\S]*?)\1/g;
    while ((match = reAttrHtml.exec(source)) !== null) {textos.push(match[2]);}
    return textos;
}

function escanearDefinicionesFunciones(source: string): Array<{ nombre: string; params: Array<string | null>; cuerpo: string }> {
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

function detectarCarriersMismoArchivo(source: string): Map<string, Set<number>> {
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

/* [318A-7V23] Divide los argumentos top-level de una llamada a partir del
 * índice de su '(' de apertura. Respeta strings/templates con escape y
 * anidado de paréntesis/corchetes/llaves, así que soporta llamadas
 * multilínea (`el('div', 'conv' + (x ? ' archivada' : ''))`) y args con
 * paréntesis internos, donde el regex plano `([^)]*)` [J-8] se troncha.
 * Devuelve null sin cierre balanceado; las comas a profundidad 1 separan. */
function dividirArgumentosLlamada(source: string, apertura: number): string[] | null {
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
function cuerpoDeFuncionEn(source: string, nombre: string): string | null {
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

function resolverLlamadaMapper(body: string, source: string, tokens: Set<string>): void {
    const llamada = body.trim().match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (!llamada) {
        return;
    }
    const cuerpo = cuerpoDeFuncionEn(source, llamada[1]);
    if (!cuerpo) {
        return;
    }
    /* Cada `return <literal>` del mapper aporta la(s) clase(s) reales. Se
     * avanza hasta el ';' del return para no releer returns posteriores. */
    const reReturn = /\breturn\b/g;
    let match: RegExpExecArray | null;
    while ((match = reReturn.exec(cuerpo)) !== null) {
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
}

function pareceTernarioDeLiterales(valor: string): boolean {
    return /\?\s*['"`]/.test(valor);
}

/* [J-8] Resuelve un identificador puro (className={clases}) contra el mapa de
 * declaraciones; si no es un identificador, extrae los literales embebidos
 * (ternarios, templates). */
function resolverExpresionClase(body: string, variables: Map<string, Set<string>>, tokens: Set<string>, familyPrefixes?: Set<string>): void {
    const trimmed = body.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
        const resuelto = variables.get(trimmed);
        if (resuelto) {
            for (const token of resuelto) {
                tokens.add(token);
            }
        }
        return;
    }
    /* [318A-7V23] Template literal en posición de clase (el('li', `tarea
     * ${CLASES[tarea.estado]}`) en tareasMeta.ts:62 de GH): los segmentos
     * estáticos son clases y cada ${} se resuelve por indirección (ident),
     * subíndice sobre mapa (M1) o literales embebidos. contextoAttr=true: el
     * valor en esta posición ES una cadena de clases por construcción. Un
     * template sin cierre balanceado cae al camino de literales de abajo. */
    if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2) {
        addTemplateClassTokens(trimmed.slice(1, -1), variables, tokens, familyPrefixes, true);
        return;
    }
    addQuotedClassTokens(trimmed, tokens, familyPrefixes);
}

function removeComments(texto: string): string {
    let result = '';
    let quote = '';
    let escaped = false;
    let comment = '';
    let regex = false;
    let inClass = false;
    let prevSig = '';
    /* [318A-7V22][M5] Un regex literal puede contener comillas o backticks
     * (`/[&<>"]/g`, `/`([^`]+)`/g` en useScratchpad.ts de PT): sin estado
     * regex, removeComments trataba esa comilla como apertura de string y
     * TODO el texto posterior del archivo quedaba "dentro de string" →
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
             * `/`([^`]+)`/g`) corrompía TODO el texto posterior del archivo
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
         * tragaba el resto del archivo (medición PT 156→419). NUNCA es regex
         * tras cierre de string/comilla (`"foo" / 2` = división), `) ] }`,
         * identificador, número, `<` (cierre etiqueta JSX) ni `>`. */
        if (current === '/' && /[=(,:;!?&|[+*%~^{]/.test(prevSig)) {
            /* Se consume hasta el cierre sin abrir strings por comillas
             * internas; las comillas/backticks del interior se neutralizan en
             * la salida (emitidas como espacio, misma longitud) para que los
             * escáneres posteriores tampoco las vean como apertura
             * (`isInsideString`/`escanearAsignacionesCompuestas` no conocen el
             * estado regex: `/[&<>"]/g` y `/`([^`]+)`/g` corrompían TODO el
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

function isInsideString(source: string, index: number): boolean {
    let quote = '';
    let escaped = false;
    for (let cursor = 0; cursor < index; cursor++) {
        const current = source[cursor];
        if (quote) {
            if (escaped) {escaped = false;}
            else if (current === '\\\\') {escaped = true;}
            else if (current === quote) {quote = '';}
        } else if (current === '"' || current === "'" || current === '`') {
            quote = current;
        }
    }
    return Boolean(quote);
}

function isCodeMatch(source: string, matchIndex: number): boolean {
    return !isInsideString(source, matchIndex);
}

function extraerTokensDeTexto(texto: string, tokens: Set<string>, familyPrefixes?: Set<string>): void {
    const source = removeComments(texto);
    let match: RegExpExecArray | null;
    /* [J-8] La indirección requiere conocer las declaraciones antes de
     * resolver los usos (className={ident}). Se recopila una vez por archivo. */
    const variables = recopilarDeclaraciones(source, familyPrefixes);

    REGEX_CLASS_ATTR.lastIndex = 0;
    while ((match = REGEX_CLASS_ATTR.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        for (const clase of match[1].split(/\s+/)) {
            if (clase.length > 1) {
                tokens.add(clase);
            }
        }
    }

    REGEX_CLASS_TEMPLATE_INICIO.lastIndex = 0;
    while ((match = REGEX_CLASS_TEMPLATE_INICIO.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        /* [318A-7V18] El match termina en el backtick de apertura; el cierre
         * se halla con el escáner balanceado (soporta templates anidados y
         * post-procesado como `.trim()` tras el backtick de cierre). */
        const apertura = match.index + match[0].length - 1;
        const cierre = finTemplateLiteral(source, apertura);
        if (cierre < 0) {continue;}
        const valor = source.slice(apertura + 1, cierre);
        /* contextoAttr=true: el contenido de un template en atributo de clase
         * ES una cadena de clases por construcción (regla V18). */
        addTemplateClassTokens(valor, variables, tokens, familyPrefixes, true);
        resolverSwitchTemplate(valor, source, tokens);
        /* [318A-7V20] RC-3: mapper llamado dentro del template de clase
         * (`etiqueta ${obtenerClasePrioridad(p)}` en ListaProyectos.tsx). */
        for (const exp of descomponerTemplate(valor).expresiones) {
            resolverLlamadaMapper(exp, source, tokens);
        }
    }

    /* [J-8] className={cond ? 'a' : 'b'} y className={'a b'}: expresiones
     * JSX con literales o identificadores indirectos. */
    REGEX_CLASS_JSX_EXPR.lastIndex = 0;
    while ((match = REGEX_CLASS_JSX_EXPR.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        resolverExpresionClase(match[1], variables, tokens, familyPrefixes);
        resolverLlamadaMapper(match[1], source, tokens);
    }

    REGEX_CLASS_OBJECT.lastIndex = 0;
    while ((match = REGEX_CLASS_OBJECT.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous !== '{' && previous !== ',') {continue;}
        /* Las props *clase en objetos ({ claseAdicional: x }) son portadoras
         * de clase: contextoAttr true (regla V18). */
        addClassTokens(match[1] ?? match[2] ?? '', tokens, familyPrefixes, true);
    }

    /* [318A-7V21] RC-4: `className: clases.join(' ')` (vanilla DOM factory)
     * resuelve el identificador por indirección; los push del carrier ya
     * quedaron fusionados al set en recopilarDeclaraciones. */
    REGEX_CLASS_OBJECT_VAR.lastIndex = 0;
    while ((match = REGEX_CLASS_OBJECT_VAR.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous !== '{' && previous !== ',') {continue;}
        resolverExpresionClase(match[1], variables, tokens, familyPrefixes);
    }

    REGEX_CLASS_FACTORY.lastIndex = 0;
    while ((match = REGEX_CLASS_FACTORY.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous && !/[=(,:]/.test(previous)) {continue;}
        addClassTokens(match[1], tokens);
    }

    /* [J-8] createElement(tag, 'clase') posicional: el segundo argumento es
     * la clase (o un ternario de literales / identificador indirecto). */
    REGEX_CREATE_ELEMENT_CLASS.lastIndex = 0;
    while ((match = REGEX_CREATE_ELEMENT_CLASS.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        resolverExpresionClase(match[1], variables, tokens, familyPrefixes);
        resolverLlamadaMapper(match[1], source, tokens);
    }

    /* [318A-7V23] el(tag, cls) posicional (ver REGEX_EL_FACTORY): el 2º
     * argumento porta la clase por el MISMO pipeline que createElement
     * (literales, ternarios/concat, templates con ${} e identificadores por
     * indirección). El divisor balanceado sustituye a `([^)]*)` para no
     * tronchar args multilínea o con paréntesis internos. */
    REGEX_EL_FACTORY.lastIndex = 0;
    while ((match = REGEX_EL_FACTORY.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previo = previousCodeCharacter(source, match.index);
        /* Solo `x.el(` (método) o `$el(` (otra función) se excluyen: el `\b`
         * del regex ya impide el pegado a identificador (`panel(` no casa),
         * pero previousCodeCharacter salta blancos y vería la 'n' de
         * `return el(` — un guard [\w] rechazaría TODAS las llamadas en
         * posición de sentencia/return. */
        if (previo === '.' || previo === '$') {continue;}
        const args = dividirArgumentosLlamada(source, match.index + match[0].length - 1);
        if (!args || args.length < 2) {continue;}
        /* 1er argumento tag literal ('div'): con tag dinámico u otra
         * semántica del mismo nombre, fuera por diseño (ver regex). */
        if (!/^\s*['"][A-Za-z][\w-]*['"]\s*$/.test(args[0])) {continue;}
        resolverExpresionClase(args[1], variables, tokens, familyPrefixes);
        resolverLlamadaMapper(args[1], source, tokens);
    }

    /* [318A-7V23] Call-sites de carriers del mismo archivo (ver
     * detectarCarriersMismoArchivo): los literales string en posiciones
     * portadoras son las clases que el runtime aplica
     * (`crearStat('+', n, 'git-adiciones')`). Solo literales (quoted o
     * template); un ident/boolean/número nunca se indexa. Las definiciones
     * casan el mismo patrón pero sus parámetros son idents y no aportan, así
     * que la regla es uniformemente segura sin distinguir def de llamada. */
    const carriers = detectarCarriersMismoArchivo(source);
    if (carriers.size > 0) {
        const reLlamadaCarrier = /\b([A-Za-z_$][\w$]*)\s*\(/g;
        while ((match = reLlamadaCarrier.exec(source)) !== null) {
            const posiciones = carriers.get(match[1]);
            if (!posiciones || !isCodeMatch(source, match.index)) {continue;}
            /* Igual que en el loop el(): solo '.' o '$' excluyen; un [\w]
             * rechazaría `return crearStat(...)` (previo 'n' tras el salto). */
            const previoLlamada = previousCodeCharacter(source, match.index);
            if (previoLlamada === '.' || previoLlamada === '$') {continue;}
            const argsLlamada = dividirArgumentosLlamada(source, match.index + match[0].length - 1);
            if (!argsLlamada) {continue;}
            for (const pos of posiciones) {
                const arg = (argsLlamada[pos] ?? '').trim();
                if (/^(['"])[\s\S]*\1$/.test(arg)) {
                    addClassTokens(arg.slice(1, -1), tokens, familyPrefixes, true);
                } else if (arg.startsWith('`') && arg.endsWith('`') && arg.length >= 2) {
                    addTemplateClassTokens(arg.slice(1, -1), variables, tokens, familyPrefixes, true);
                }
            }
        }
    }

    REGEX_EXTERNAL_LINK_CLASS.lastIndex = 0;
    while ((match = REGEX_EXTERNAL_LINK_CLASS.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous && !/[=(,:]/.test(previous)) {continue;}
        addClassTokens(match[1], tokens);
    }

    REGEX_CLASS_LIST.lastIndex = 0;
    while ((match = REGEX_CLASS_LIST.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index) || previousCodeCharacter(source, match.index) !== '.') {continue;}
        resolverExpresionClase(match[1], variables, tokens, familyPrefixes);
        resolverLlamadaMapper(match[1], source, tokens);
    }

    /* [318A-7V23] setAttribute('class', <expr>) directo: la vía de ATRIBUTO
     * (className=/class=) no casa con llamadas, y la vía carrier solo cubre
     * indirecciones. Mismo pipeline que classList (GH entradaContexto.ts:39:
     * `circuloFondo.setAttribute('class', 'ctx-pista')`; iconos.ts:93: la
     * concat `'ic' + (pequeno ? ' ic-xs' : '') + ...` aporta sus literales). */
    REGEX_SET_ATTRIBUTE_CLASS.lastIndex = 0;
    while ((match = REGEX_SET_ATTRIBUTE_CLASS.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        /* setAttribute es método (`x.setAttribute(`): el '.' previo es lo
         * normal y se admite; solo '$' ($setAttribute) excluye. El match
         * termina en la coma tras 'class', así que el '(' se busca hacia
         * adelante (no es match.index + len - 1 como en el(), cuyo match
         * termina en el paréntesis). */
        if (previousCodeCharacter(source, match.index) === '$') {continue;}
        const aperturaAttr = source.indexOf('(', match.index);
        if (aperturaAttr < 0) {continue;}
        const argsAttr = dividirArgumentosLlamada(source, aperturaAttr);
        if (!argsAttr || argsAttr.length < 2) {continue;}
        resolverExpresionClase(argsAttr[1], variables, tokens, familyPrefixes);
        resolverLlamadaMapper(argsAttr[1], source, tokens);
    }

    for (const declaracion of escanearDeclaraciones(source)) {
        const esCarrier = declaracion.nombre === 'className' || declaracion.nombre === 'contentClass'
            || /^[Cc]lase/.test(declaracion.nombre);
        if (!esCarrier) {
            continue;
        }
        if (!isCodeMatch(source, declaracion.indice)) {continue;}
        const previous = previousCodeCharacter(source, declaracion.indice);
        if (previous && /[\w'"`]/.test(previous)) {continue;}
        addDeclarationClassTokens(declaracion.valor, tokens, familyPrefixes);
    }
    /* [318A-7V20] RC-1: compuestos de carriers (*clase, className, contentClass)
     * emiten directo al archivo; recopilarDeclaraciones ya los fusionó al set
     * de la variable para la vía de indirección className={clase}. */
    for (const compuesto of escanearAsignacionesCompuestas(source)) {
        const esCarrierCompuesto = /^[Cc]lase/.test(compuesto.nombre)
            || compuesto.nombre === 'className' || compuesto.nombre === 'contentClass';
        if (!esCarrierCompuesto || !isCodeMatch(source, compuesto.indice)) {
            continue;
        }
        addQuotedClassTokens(compuesto.valor, tokens, familyPrefixes);
    }
    /* [318A-7V21] RC-4: `clases.push('...')` sobre un carrier emite directo
     * al archivo (misma regla que los compuestos); el set para indirección ya
     * se fusionó en recopilarDeclaraciones. */
    for (const push of escanearPushs(source)) {
        const esCarrierPush = /^[Cc]lase/.test(push.nombre)
            || push.nombre === 'className' || push.nombre === 'contentClass';
        if (!esCarrierPush || !isCodeMatch(source, push.indice)) {
            continue;
        }
        addQuotedClassTokens(push.valor, tokens, familyPrefixes);
    }

    /* [318A-7V22][M4] Construcción de HTML en runtime: templates que
     * ensamblan markup (`html += '<h${n} class="...">...'`, innerHTML,
     * createElement con html). El literal `class="..."` dentro de un template
     * ES una cadena de clases por construcción, aunque no sea un atributo de
     * componente React. Cubre (useScratchpad.ts:82/94 de PT):
     *   `<h${nivel} class="scratchpadVistaPreviaTitulo scratchpadVistaPreviaTitulo--h${nivel}">`
     *   `<li><span class="scratchpadVistaPreviaChecklist">${marcado}</span>`
     * El segmento estático se tokeniza entero (base + clase literal), y la
     * familia pegada a la interpolación (--h) la registra registrarPrefijosFamilia
     * con contextoAttr=true (forma de clase válida). El HTML se suele acumular
     * con `html +=` (asignación compuesta) o declararse en `const x =`; se
     * recorren ambas vías. */
    for (const declaracion of escanearDeclaraciones(source)) {
        if (!isCodeMatch(source, declaracion.indice)) {continue;}
        const previo = previousCodeCharacter(source, declaracion.indice);
        if (previo && /[\w'"`]/.test(previo)) {continue;}
        resolverConstruccionHtml(declaracion.valor, variables, tokens, familyPrefixes);
    }
    for (const compuesto of escanearAsignacionesCompuestas(source)) {
        if (!isCodeMatch(source, compuesto.indice)) {continue;}
        resolverConstruccionHtml(compuesto.valor, variables, tokens, familyPrefixes);
    }
    /* [318A-7V23] returns y push con HTML: `return \`<span
     * class="resumen">...\`` (mensajesUtil.ts:44/51-52 de GH) y
     * `cuerpo.push(\`<span class="${clase}">...\`)` (:40) ensamblan markup en
     * posiciones que ni declaraciones ni `+=` cubren; el literal `class="..."`
     * dentro del template ES cadena de clases por construcción (regla M4). */
    for (const retorno of escanearReturns(source)) {
        if (!isCodeMatch(source, retorno.indice)) {continue;}
        resolverConstruccionHtml(retorno.valor, variables, tokens, familyPrefixes);
    }
    for (const push of escanearPushs(source)) {
        if (!isCodeMatch(source, push.indice)) {continue;}
        resolverConstruccionHtml(push.valor, variables, tokens, familyPrefixes);
    }
}

/* [318A-7V22][M4] Extrae las clases de los atributos `class="..."` literales
 * dentro de un valor que construye HTML (template con `<tag` o asignación a
 * innerHTML/html). Solo procesa si el valor parece contener markup HTML; una
 * cadena de clases plana ya la cubre addDeclarationClassTokens (vía carriers).
 * [318A-7V23] El contenido interpolado (`class="${clase}"`) se resuelve contra
 * el mapa de declaraciones igual que un template de atributo (mensajesUtil.ts
 * de GH: cuerpo.push(`<span class="${clase}">`) con `clase` valiendo
 * ctx/add/del/elididas; iconoHtml: `<svg class="${cls}">` con cls={ic,ic-xs}).
 * Sin variables el ${} quedaba sin resolver y esas clases se reportaban. */
function resolverConstruccionHtml(valor: string, variables: Map<string, Set<string>>, tokens: Set<string>, familyPrefixes?: Set<string>): void {
    /* Guard rápido: sin '<' no hay construcción de HTML. */
    if (!valor.includes('<')) {
        return;
    }
    /* Atributos class="..." (o class='...') con contenido no vacío. */
    const reAttr = /\bclass\s*=\s*(["'])([\s\S]*?)\1/g;
    let match: RegExpExecArray | null;
    while ((match = reAttr.exec(valor)) !== null) {
        const contenido = match[2];
        if (!contenido.includes('${')) {
            /* Clase literal completa: tokenizar por espacios. */
            for (const clase of contenido.split(/\s+/)) {
                if (clase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(clase)) {
                    tokens.add(clase);
                }
            }
            continue;
        }
        /* Contenido con interpolación: descomponer el template para tokenizar
         * segmentos estáticos, resolver ${ident} por indirección y registrar
         * familias pegadas (ver addTemplateClassTokens). */
        addTemplateClassTokens(contenido, variables, tokens, familyPrefixes, true);
    }
}

function compilarPatronesExcluidos(patterns: string[]): RegExp[] {
    return patterns
        .filter(pattern => pattern.length > 0)
        .map(pattern => {
            try { return new RegExp(pattern); } catch { return null; }
        })
        .filter((regex): regex is RegExp => regex !== null);
}

/* [085A-2] Escanea clases huerfanas desde providers core, sin vscode.workspace.
 * Gotcha: los adaptadores deciden como abrir archivos; aqui solo se cruzan tokens y selectores. */
export class ClassIndexBuilder {
    private readonly cssFileCache = new Map<string, ClaseCssDefinida[]>();
    private readonly consumerFileCache = new Map<string, { tokens: Set<string>; familyPrefixes: Set<string> }>();

    constructor(
        private readonly fileProvider: WorkspaceFileProvider,
        private readonly documentProvider: DocumentProvider,
        private readonly documentCacheProvider?: DocumentCacheProvider,
        private readonly persistentStore?: PersistentIndexStore
    ) {}

    /* The file cache is caller-driven: watchers/adapters must call this before
     * rescanning a changed or deleted file. A scan does not stat/hash content. */
    public invalidateFile(fsPath: string): void {
        this.cssFileCache.delete(fsPath);
        this.consumerFileCache.delete(fsPath);
        this.documentCacheProvider?.invalidate(fsPath);
        /* [028A-8] La invalidación del caché en memoria también expulsa la
         * entrada persistente del índice entre ejecuciones. */
        this.persistentStore?.removeEntry(fsPath);
    }

    public clearCache(): void {
        this.cssFileCache.clear();
        this.consumerFileCache.clear();
        this.documentCacheProvider?.clear();
    }

    public async scan(
        options: ClassIndexScanOptions,
        onProgress?: ClassScanProgress
    ): Promise<ResultadoClasesHuerfanas> {
        throwIfCancelled(options.token);
        const inicio = Date.now();
        const cssPatterns = options.cssPatterns ?? DEFAULT_CSS_PATTERNS;
        const consumerPatterns = options.consumerPatterns ?? DEFAULT_CONSUMER_PATTERNS;
        const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;

        const { clasesMap, totalArchivos: archivosCss } = await this.scanCssDefinitions(
            cssPatterns,
            options.exclude,
            (actual, total) => onProgress?.('Escaneando CSS', actual, total),
            options.token
        );

        throwIfCancelled(options.token);
        onProgress?.('Extrayendo tokens de consumidores', 0, 1);
        const { filesTokens, filesFamilyPrefixes, totalArchivos: archivosConsumo } = await this.extractConsumerTokens(
            consumerPatterns,
            options.exclude,
            options.token
        );

        throwIfCancelled(options.token);
        const regexExcluidos = compilarPatronesExcluidos(options.excludedClassPatterns ?? []);
        const clasesHuerfanas: ClaseCssDefinida[] = [];
        const nombresUnicos = Array.from(clasesMap.keys());
        /* [318A-7V3] Con los CSS ahora en el barrido de consumo, cada clase
         * debe excluir su(s) archivo(s) de definición: un selector compuesto
         * en el mismo archivo (`.padre .hija` junto a la definición) no es
         * uso; en OTRO archivo sí lo es. */
        const archivosDefinicion = new Map<string, Set<string>>();
        for (const [nombre, definiciones] of clasesMap) {
            archivosDefinicion.set(nombre, new Set(definiciones.map(def => def.archivo)));
        }

        for (let index = 0; index < nombresUnicos.length; index++) {
            throwIfCancelled(options.token);
            const nombre = nombresUnicos[index];

            if (index % 100 === 0) {
                onProgress?.('Verificando uso', index, nombresUnicos.length);
            }

            if (nombre.length < minLength || regexExcluidos.some(regex => regex.test(nombre))) {
                continue;
            }

            const definicion = archivosDefinicion.get(nombre) ?? new Set<string>();
            /* [318A-7V14] Uso por familia: un prefijo de template literal
             * (badgeInfo-- / selectorNivelBoton / boton--) alcanza a toda la
             * familia de clases definidas, porque el sufijo se emite en
             * runtime desde el componente. No aplica al archivo de definición
             * (un selector compuesto en el mismo CSS no es uso). */
            let usado = false;
            for (const [fsPath, tokensArchivo] of filesTokens) {
                if (definicion.has(fsPath)) {
                    continue;
                }
                if (tokensArchivo.has(nombre)) {
                    usado = true;
                    break;
                }
                const prefijos = filesFamilyPrefixes.get(fsPath);
                if (prefijos) {
                    for (const prefijo of prefijos) {
                        if (nombre.startsWith(prefijo)) {
                            usado = true;
                            break;
                        }
                    }
                }
                if (usado) {
                    break;
                }
            }

            if (!usado) {
                const definiciones = clasesMap.get(nombre) ?? [];
                if (definiciones.length > 0) {
                    clasesHuerfanas.push(definiciones[0]);
                }
            }
        }

        clasesHuerfanas.sort((a, b) => {
            if (a.archivo !== b.archivo) {
                return a.archivo.localeCompare(b.archivo);
            }
            return a.linea - b.linea;
        });

        return {
            totalClasesDefinidas: nombresUnicos.length,
            totalClasesUsadas: nombresUnicos.length - clasesHuerfanas.length,
            totalClasesHuerfanas: clasesHuerfanas.length,
            clasesHuerfanas,
            archivosAnalizadosCss: archivosCss,
            archivosAnalizadosConsumo: archivosConsumo,
            tiempoMs: Date.now() - inicio
        };
    }

    private async scanCssDefinitions(
        patterns: string[],
        exclude: string[],
        onProgress?: (actual: number, total: number) => void,
        token?: CancellationToken
    ): Promise<{ clasesMap: Map<string, ClaseCssDefinida[]>; totalArchivos: number }> {
        const files = await this.fileProvider.findFiles(patterns, exclude);
        const clasesMap = new Map<string, ClaseCssDefinida[]>();
        const currentFiles = new Set(files.map(file => file.fsPath));
        for (const fsPath of this.cssFileCache.keys()) {
            if (!currentFiles.has(fsPath)) {
                this.cssFileCache.delete(fsPath);
                /* [028A-8] El archivo desapareció: la entrada persistente queda
                 * obsoleta y no debe reutilizarse en la siguiente ejecución. */
                this.persistentStore?.removeEntry(fsPath);
            }
        }

        for (let index = 0; index < files.length; index++) {
            throwIfCancelled(token);
            const file = files[index];
            try {
                let clases = this.cssFileCache.get(file.fsPath);
                if (!clases) {
                    clases = await this.loadCssDefinitions(file, token);
                }
                for (const clase of clases) {
                    const existentes = clasesMap.get(clase.nombre) ?? [];
                    const duplicado = existentes.some(item => item.archivo === clase.archivo && item.linea === clase.linea);
                    if (!duplicado) {
                        existentes.push(clase);
                        clasesMap.set(clase.nombre, existentes);
                    }
                }
            } catch (error) {
                if (error instanceof CancellationError) {
                    throw error;
                }
                /* Mantiene el comportamiento historico: archivos no abribles no bloquean el reporte. */
            }

            onProgress?.(index + 1, files.length);
        }

        return { clasesMap, totalArchivos: files.length };
    }

    private async extractConsumerTokens(
        patterns: string[],
        exclude: string[],
        token?: CancellationToken
    ): Promise<{ filesTokens: Map<string, Set<string>>; filesFamilyPrefixes: Map<string, Set<string>>; totalArchivos: number }> {
        const files = await this.findUniqueFiles(patterns, exclude, token);
        const filesTokens = new Map<string, Set<string>>();
        const filesFamilyPrefixes = new Map<string, Set<string>>();
        let totalTokens = 0;
        for (const fsPath of this.consumerFileCache.keys()) {
            if (!files.has(fsPath)) {
                this.consumerFileCache.delete(fsPath);
                /* [028A-8] Ídem: consumidor eliminado no puede reutilizar su
                 * entrada persistente. */
                this.persistentStore?.removeEntry(fsPath);
            }
        }

        for (const file of files.values()) {
            throwIfCancelled(token);
            if (totalTokens >= MAX_TOKENS) {
                break;
            }

            try {
                let cached = this.consumerFileCache.get(file.fsPath);
                if (!cached) {
                    cached = await this.loadConsumerTokens(file, token);
                }
                filesTokens.set(file.fsPath, cached.tokens);
                filesFamilyPrefixes.set(file.fsPath, cached.familyPrefixes);
                totalTokens += cached.tokens.size;
            } catch (error) {
                if (error instanceof CancellationError) {
                    throw error;
                }
                /* Mantiene el comportamiento historico: archivos no abribles no bloquean el reporte. */
            }
        }

        return { filesTokens, filesFamilyPrefixes, totalArchivos: files.size };
    }

    /* [028A-8] Carga las definiciones CSS de un archivo reutilizando el índice
     * persistente cuando el hash de contenido coincide. Store-first: el hash se
     * calcula del contenido real en disco antes de abrir/parsear el documento,
     * por lo que un archivo sin cambios nunca se vuelve a parsear. */
    private async loadCssDefinitions(file: WorkspaceFile, token?: CancellationToken): Promise<ClaseCssDefinida[]> {
        const hash = this.persistentStore ? await sha256File(file.fsPath) : null;
        const store = this.persistentStore;
        const stored = hash ? store?.getEntry(file.fsPath) : undefined;
        if (stored?.hash === hash && stored.classDefinitions) {
            if (store) {store.stats.reused++;}
            this.cssFileCache.set(file.fsPath, stored.classDefinitions);
            return stored.classDefinitions;
        }
        const document = await this.documentProvider.openTextDocument(file);
        throwIfCancelled(token);
        const texto = document.getText();
        const clases = extraerClasesDeTexto(texto, file.fsPath);
        this.cssFileCache.set(file.fsPath, clases);
        if (hash) {
            const previa = store?.getEntry(file.fsPath) ?? {};
            store?.setEntry(file.fsPath, {
                ...previa,
                hash,
                classDefinitions: clases,
                /* [028A-8 tramo 4] Los usos de variables se capturan junto a las
                 * definiciones de clase: ambos salen del mismo texto CSS y el
                 * hash ya validó el contenido. */
                variableUsages: extraerUsoVariablesDeTexto(texto),
            });
            if (store) {store.stats.reparsed++;}
        }
        return clases;
    }

    /* [028A-8] Ídem para tokens de consumo: store-first, reutiliza la entrada
     * persistente cuando el hash coincide y registra la nueva al cambiar. */
    private async loadConsumerTokens(file: WorkspaceFile, token?: CancellationToken): Promise<{ tokens: Set<string>; familyPrefixes: Set<string> }> {
        const hash = this.persistentStore ? await sha256File(file.fsPath) : null;
        const store = this.persistentStore;
        const stored = hash ? store?.getEntry(file.fsPath) : undefined;
        /* [318A-7V14] La familia se exige persistida: una entrada vieja (sin
         * consumerFamilyPrefixes) se re-parsea aunque el hash coincida. */
        if (stored?.hash === hash && stored.consumerTokens && stored.consumerFamilyPrefixes) {
            if (store) {store.stats.reused++;}
            const cached = {
                tokens: new Set<string>(stored.consumerTokens),
                familyPrefixes: new Set<string>(stored.consumerFamilyPrefixes),
            };
            this.consumerFileCache.set(file.fsPath, cached);
            return cached;
        }
        const document = await this.documentProvider.openTextDocument(file);
        throwIfCancelled(token);
        const fileTokens = new Set<string>();
        const fileFamilyPrefixes = new Set<string>();
        extraerTokensDeTexto(document.getText(), fileTokens, fileFamilyPrefixes);
        const cached = { tokens: fileTokens, familyPrefixes: fileFamilyPrefixes };
        this.consumerFileCache.set(file.fsPath, cached);
        if (hash) {
            const previa = store?.getEntry(file.fsPath) ?? {};
            store?.setEntry(file.fsPath, {
                ...previa,
                hash,
                consumerTokens: [...fileTokens],
                consumerFamilyPrefixes: [...fileFamilyPrefixes],
            });
            if (store) {store.stats.reparsed++;}
        }
        return cached;
    }

    private async findUniqueFiles(patterns: string[], exclude: string[], token?: CancellationToken): Promise<Map<string, WorkspaceFile>> {
        const files = new Map<string, { uri: string; fsPath: string }>();

        /* El provider recibe todos los patrones en una sola pasada. Hacer un
         * recorrido por patrón multiplica el coste de readdir/glob en cada
         * ejecución cold y no aporta deduplicación adicional: el Map ya la
         * garantiza para providers que devuelvan coincidencias repetidas. */
        throwIfCancelled(token);
        const matches = await this.fileProvider.findFiles(patterns, exclude);
        for (const file of matches) {
            throwIfCancelled(token);
            files.set(file.fsPath, file);
        }

        return files;
    }
}
