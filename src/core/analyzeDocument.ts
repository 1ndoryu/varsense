import { DiagnosticType, VariableIndex } from '@/types';
import { parsearDocumento } from '@/parsers/cssParser';
import { CoreFinding, CoreSeverity, CoreTextDocument, createCoreRange, positionAtOffset } from './types';

export interface VarsenseHardcodedConfig {
    habilitado: boolean;
    severidad: CoreSeverity;
    propiedades: Record<string, boolean>;
    valoresPermitidos: string[];
}

export interface VarsenseInlineConfig {
    habilitado: boolean;
    severidad: CoreSeverity;
}

export interface VarsenseBannedPropertyConfig {
    habilitado: boolean;
    severidad: CoreSeverity;
    propiedades: string[];
}

export interface VarsenseTodoProseConfig {
    habilitado: boolean;
    severidad: CoreSeverity;
}

export interface VarsenseDocumentAnalysisConfig {
    hardcoded: VarsenseHardcodedConfig;
    inline: VarsenseInlineConfig;
    bannedProperties: VarsenseBannedPropertyConfig;
    todoProse: VarsenseTodoProseConfig;
    tokens: {
        duplicate: { habilitado: boolean; severidad: CoreSeverity };
        unused: { habilitado: boolean; severidad: CoreSeverity };
        crossFile: { habilitado: boolean; severidad: CoreSeverity };
    };
}

const REACT_LANGUAGE_IDS = new Set(['typescriptreact', 'javascriptreact']);
const SCRIPT_LANGUAGE_IDS = new Set(['typescript', 'javascript']);
const CSS_LANGUAGE_IDS = new Set(['css', 'scss', 'less']);
const REGEX_STYLE_OBJ = /style\s*=\s*\{\s*\{/g;
const REGEX_STYLE_VAR = /style\s*=\s*\{(?!\s*\{)([^}]+)\}/g;
const REGEX_SCRIPT_INLINE_STYLE = /(?:\.style\.[a-zA-Z][\w]*\s*=|\.style\.setProperty\s*\(|\.setAttribute\s*\(\s*['"]style['"])/g;

function shouldCheckProperty(config: VarsenseHardcodedConfig, property: string): boolean {
    if (!config.habilitado) {
        return false;
    }

    if (property in config.propiedades) {
        return config.propiedades[property];
    }

    const baseProperty = property.split('-')[0];
    return config.propiedades[baseProperty] ?? false;
}

function isAllowedValue(config: VarsenseHardcodedConfig, value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return config.valoresPermitidos.some(allowed => allowed.toLowerCase() === normalized);
}

function finding(
    ruleId: string,
    message: string,
    severity: CoreSeverity,
    range: CoreFinding['range'],
    metadata?: Record<string, unknown>
): CoreFinding {
    return {
        ruleId,
        message,
        severity,
        range,
        source: 'VarSense',
        metadata,
    };
}

function analyzeCssDocument(
    document: CoreTextDocument,
    variableIndex: VariableIndex,
    config: VarsenseDocumentAnalysisConfig
): CoreFinding[] {
    const parseResult = parsearDocumento(document, {
        debeVerificarPropiedad: property => shouldCheckProperty(config.hardcoded, property),
        esValorPermitido: value => isAllowedValue(config.hardcoded, value),
        propiedadesProhibidas: {
            habilitado: config.bannedProperties.habilitado,
            propiedades: config.bannedProperties.propiedades,
        },
    });

    const findings: CoreFinding[] = [];

    for (const usage of parseResult.usosVariables) {
        if (!variableIndex.variables.has(usage.nombreVariable)) {
            findings.push(finding(
                DiagnosticType.VariableNoDefinida,
                `Variable '${usage.nombreVariable}' no esta definida`,
                'error',
                usage.rango,
                { variable: usage.nombreVariable }
            ));
        }
    }

    for (const hardcoded of parseResult.valoresHardcoded) {
        findings.push(finding(
            DiagnosticType.ValorHardcoded,
            `Valor hardcodeado '${hardcoded.valor}' en '${hardcoded.propiedad}' - considera usar una variable CSS`,
            config.hardcoded.severidad,
            hardcoded.rango,
            { property: hardcoded.propiedad, value: hardcoded.valor }
        ));
    }

    for (const banned of parseResult.propiedadesProhibidas) {
        findings.push(finding(
            DiagnosticType.PropiedadProhibida,
            `Propiedad prohibida '${banned.propiedad}' - eliminar o reemplazar con alternativa permitida`,
            config.bannedProperties.severidad,
            banned.rango,
            { property: banned.propiedad, value: banned.valor }
        ));
    }

    return findings;
}

function findMatchingObjectEnd(text: string, startIndex: number): number {
    let depth = 2;
    let index = startIndex;

    while (index < text.length && depth > 0) {
        if (text[index] === '{') {
            depth++;
        } else if (text[index] === '}') {
            depth--;
        }
        index++;
    }

    return index;
}

/* Salta un literal '...' "..." `...` desde su comilla de apertura y devuelve
 * el offset posterior al cierre. Los templates `...${...}...` recorren la
 * expresion interpolada con balanceo para no confundir sus llaves, comas o
 * dos puntos con la estructura del objeto que los contiene. */
function saltarLiteralEstilo(texto: string, inicio: number): number {
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

/*
 * [229A-1] Extrae las claves de nivel superior de un objeto `style={{...}}`
 * de JSX. Es el mismo patron de definicion runtime de tokens que
 * `.style.setProperty('--x', ...)` (ya eximido en analyzeScriptInlineStyles):
 * un objeto cuyas claves son TODAS custom properties (`--*`) no aplica
 * estilo inline, solo define tokens que el CSS consume via var(). Solo se
 * inspecciona el primer nivel: `style={{ color: 'red' }}`, spreads o
 * shorthands siguen marcando.
 */
function extraerClavesObjetoEstilo(texto: string, inicioLlave: number): string[] {
    const claves: string[] = [];
    let profundidad = 0;
    let segmento = '';
    let claveExtraida = false;
    let i = inicioLlave;

    const volcarSegmento = (): void => {
        const recortado = segmento.trim();
        if (recortado.length > 0) {
            claves.push(recortado);
        }
        segmento = '';
    };

    while (i < texto.length) {
        const actual = texto[i];

        if (actual === "'" || actual === '"' || actual === '`') {
            const finLiteral = saltarLiteralEstilo(texto, i);
            /* [229A-1] Clave entrecomillada ('--x', "--x"): el literal ES la
             * clave en posicion de clave; acumular su contenido para que
             * esSoloDefinicionTokens la vea. En posicion de valor se ignora. */
            if (profundidad === 1 && !claveExtraida) {
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
            claveExtraida = false;
            i++;
            continue;
        }

        if (profundidad === 1) {
            segmento += actual;
        }
        i++;
    }

    return claves;
}

function esSoloDefinicionTokens(claves: string[]): boolean {
    if (claves.length === 0) {
        return false;
    }
    return claves.every(clave => clave.replace(/^['"]|['"]$/g, '').startsWith('--'));
}

function analyzeReactInlineStyles(
    document: CoreTextDocument,
    config: VarsenseDocumentAnalysisConfig
): CoreFinding[] {
    if (!config.inline.habilitado) {
        return [];
    }

    const text = document.getText();
    const findings: CoreFinding[] = [];
    let match: RegExpExecArray | null;

    REGEX_STYLE_OBJ.lastIndex = 0;
    while ((match = REGEX_STYLE_OBJ.exec(text)) !== null) {
        const endIndex = findMatchingObjectEnd(text, match.index + match[0].length);
        /* [229A-1] Objeto solo con custom properties = definicion runtime
         * de tokens (mismo patron eximido que setProperty): no es inline. */
        const inicioLlave = match.index + match[0].length - 1;
        if (esSoloDefinicionTokens(extraerClavesObjetoEstilo(text, inicioLlave))) {
            continue;
        }
        const start = positionAtOffset(document, match.index);
        const end = positionAtOffset(document, endIndex);

        findings.push(finding(
            DiagnosticType.CssInlineReact,
            'CSS inline detectado - usa clases CSS con variables en vez de style={{}}',
            config.inline.severidad,
            { start, end }
        ));
    }

    REGEX_STYLE_VAR.lastIndex = 0;
    while ((match = REGEX_STYLE_VAR.exec(text)) !== null) {
        const content = match[1].trim();
        if (content.startsWith('{')) {
            continue;
        }

        const start = positionAtOffset(document, match.index);
        const end = positionAtOffset(document, match.index + match[0].length);

        findings.push(finding(
            DiagnosticType.CssInlineReact,
            `CSS inline detectado (style={${content}}) - usa clases CSS con variables`,
            config.inline.severidad,
            { start, end }
        ));
    }

    return findings;
}

function analyzeScriptInlineStyles(
    document: CoreTextDocument,
    config: VarsenseDocumentAnalysisConfig
): CoreFinding[] {
    if (!config.inline.habilitado) {
        return [];
    }

    const text = document.getText();
    const findings: CoreFinding[] = [];
    let match: RegExpExecArray | null;
    REGEX_SCRIPT_INLINE_STYLE.lastIndex = 0;

    while ((match = REGEX_SCRIPT_INLINE_STYLE.exec(text)) !== null) {
        if (match[0].includes('.style.setProperty')) {
            const firstArgument = text.slice(match.index + match[0].length);
            if (/^\s*['"]--[\w-]+['"]/.test(firstArgument)) {
                continue;
            }
        }
        findings.push(finding(
            DiagnosticType.CssInlineScript,
            'CSS inline detectado en script - usa una clase CSS y variables del sistema',
            config.inline.severidad,
            {
                start: positionAtOffset(document, match.index),
                end: positionAtOffset(document, match.index + match[0].length),
            }
        ));
    }
    return findings;
}

/*
 * [149A-1 F3.13] Mencion de tarea sin marcador en comentarios: exige
 * marcador de tarea (TODO:/TODO(/FIXME/XXX).
 * Solo inspecciona regiones de comentario real: el barrido enmascara
 * literales '...' "..." `...` (templates opacos, sin ${} anidado) para no
 * marcar prosa dentro de strings. Guardas 0 FP:
 *   - formas con `:`/`(`/`[` → marcador valido, no marca;
 *   - prosa con articulo (el|la|los|las|lo) → no marca;
 *   - cuantificador en ultima posicion del comentario → en minusculas es
 *     prosa española, no marca; la forma mayuscula sola si marca porque
 *     se exige la forma con dos puntos;
 *   - compuestos con guion (tipo todo-list) → no marca;
 *   - `/todo` (URL/ruta dentro del comentario) → no marca.
 * FIXME/XXX nunca marcan (son marcadores validos por si mismos).
 */
const PATRON_TODO_PROSA = /\btodo\b/gi;
const ARTICULOS_PROSA = new Set(['el', 'la', 'los', 'las', 'lo']);

function extraerRegionesComentario(texto: string): Array<{ inicio: number; fin: number }> {
    const regiones: Array<{ inicio: number; fin: number }> = [];
    let i = 0;
    let literal: string | null = null;

    while (i < texto.length) {
        const actual = texto[i];
        const siguiente = i + 1 < texto.length ? texto[i + 1] : '';

        if (literal !== null) {
            if (actual === '\\') {
                i += 2;
                continue;
            }
            if (actual === literal) {
                literal = null;
            }
            i++;
            continue;
        }

        if (actual === "'" || actual === '"' || actual === '`') {
            literal = actual;
            i++;
            continue;
        }

        if (actual === '/' && siguiente === '/') {
            let fin = texto.indexOf('\n', i + 2);
            if (fin === -1) {
                fin = texto.length;
            }
            regiones.push({ inicio: i + 2, fin });
            i = fin;
            continue;
        }

        if (actual === '/' && siguiente === '*') {
            const cierre = texto.indexOf('*/', i + 2);
            const fin = cierre === -1 ? texto.length : cierre;
            regiones.push({ inicio: i + 2, fin });
            i = cierre === -1 ? texto.length : cierre + 2;
            continue;
        }

        i++;
    }

    return regiones;
}

function esTodoProsaSinMarcador(textoComentario: string, indice: number, forma: string): boolean {
    const anterior = indice > 0 ? textoComentario[indice - 1] : '';
    /* URL/ruta dentro del comentario (https://…/todo). */
    if (anterior === '/') {
        return false;
    }

    let j = indice + forma.length;
    while (j < textoComentario.length && /\s/.test(textoComentario[j])) {
        j++;
    }
    const siguiente = j < textoComentario.length ? textoComentario[j] : '';
    /* Marcador valido TODO:/TODO(/TODO[. */
    if (siguiente === ':' || siguiente === '(' || siguiente === '[') {
        return false;
    }
    /* Compuesto tipo todo-list: sustantivo, no tarea. */
    if (siguiente === '-') {
        return false;
    }

    /* Prosa española "todo el|la|los|las|lo …": no es una tarea. */
    let k = j;
    let palabra = '';
    while (k < textoComentario.length && /[A-Za-z]/.test(textoComentario[k])) {
        palabra += textoComentario[k];
        k++;
    }
    if (ARTICULOS_PROSA.has(palabra.toLowerCase())) {
        return false;
    }

    /* Ultima palabra del comentario ("re-parsear todo.", "todo, …"): en
     * minusculas es el cuantificador español ("todo" = "everything"), no
     * una tarea; en mayusculas (TODO) es la taquigrafia de tarea y marca
     * porque se exige TODO: con dos puntos. */
    const resto = textoComentario.slice(k);
    if (/^[\s.,;!?…)\]}]*$/.test(resto)) {
        return forma === 'TODO';
    }

    return true;
}

function analyzeTodoProse(
    document: CoreTextDocument,
    config: VarsenseDocumentAnalysisConfig
): CoreFinding[] {
    if (!config.todoProse.habilitado) {
        return [];
    }

    const texto = document.getText();
    const hallazgos: CoreFinding[] = [];

    for (const region of extraerRegionesComentario(texto)) {
        const comentario = texto.slice(region.inicio, region.fin);
        PATRON_TODO_PROSA.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = PATRON_TODO_PROSA.exec(comentario)) !== null) {
            if (!esTodoProsaSinMarcador(comentario, match.index, match[0])) {
                continue;
            }
            const offset = region.inicio + match.index;
            const inicio = positionAtOffset(document, offset);
            const fin = positionAtOffset(document, offset + match[0].length);
            hallazgos.push(finding(
                DiagnosticType.TodoProsaSinMarcador,
                `Mencion a 'todo' sin marcador de tarea - usa TODO:, TODO(...), FIXME o XXX`,
                config.todoProse.severidad,
                { start: inicio, end: fin }
            ));
        }
    }

    return hallazgos;
}

/*
 * Parsea comentarios de supresion y devuelve las lineas suprimidas.
 * Replica la semantica del provider (parsearSupresiones) para que el CLI y
 * el editor reporten el mismo conteo:
 *   varsense-disable-next-line        → suprime la linea siguiente
 *   varsense-enable                   → termina el bloque generico
 *   varsense-disable-line             → suprime esa misma linea
 *   varsense-disable                  → inicia bloque (suprime siguientes)
 *   sentinel-disable                  → convencion inline usada en JSX/CSS:
 *                                       suprime esa linea y la siguiente
 * El orden importa: las variantes mas especificas (next-line, line) se
 * evaluan antes que la generica para evitar coincidencias parciales.
 */
function parsearLineasSuprimidas(texto: string): Set<number> {
    const lineasSuprimidas = new Set<number>();
    const lineas = texto.split('\n');
    let enBloqueDeshabilitado = false;

    for (let i = 0; i < lineas.length; i++) {
        const textoLinea = lineas[i];

        if (textoLinea.includes('varsense-disable-next-line')) {
            lineasSuprimidas.add(i + 1);
            continue;
        }

        if (textoLinea.includes('varsense-enable')) {
            enBloqueDeshabilitado = false;
            continue;
        }

        if (textoLinea.includes('varsense-disable-line')) {
            lineasSuprimidas.add(i);
            continue;
        }

        if (textoLinea.includes('varsense-disable')) {
            enBloqueDeshabilitado = true;
            continue;
        }

        if (enBloqueDeshabilitado) {
            lineasSuprimidas.add(i);
        }

        if (textoLinea.includes('sentinel-disable')) {
            lineasSuprimidas.add(i);
            lineasSuprimidas.add(i + 1);
        }
    }

    return lineasSuprimidas;
}

export function analyzeVarsenseDocument(
    document: CoreTextDocument,
    variableIndex: VariableIndex,
    config: VarsenseDocumentAnalysisConfig
): CoreFinding[] {
    const lineasSuprimidas = parsearLineasSuprimidas(document.getText());
    const filtrar = (hallazgos: CoreFinding[]): CoreFinding[] =>
        lineasSuprimidas.size > 0
            ? hallazgos.filter(hallazgo => !lineasSuprimidas.has(hallazgo.range.start.line))
            : hallazgos;

    if (CSS_LANGUAGE_IDS.has(document.languageId)) {
        return filtrar([...analyzeTodoProse(document, config), ...analyzeCssDocument(document, variableIndex, config)]);
    }

    if (REACT_LANGUAGE_IDS.has(document.languageId)) {
        return filtrar([...analyzeTodoProse(document, config), ...analyzeReactInlineStyles(document, config)]);
    }

    if (SCRIPT_LANGUAGE_IDS.has(document.languageId)) {
        return filtrar([...analyzeTodoProse(document, config), ...analyzeScriptInlineStyles(document, config)]);
    }

    return [];
}

export function orphanClassToFinding(input: {
    nombre: string;
    archivo: string;
    linea: number;
    columna: number;
    selector: string;
}, severity: CoreSeverity = 'warning'): CoreFinding {
    return finding(
        DiagnosticType.ClaseHuerfana,
        `Clase CSS '${input.nombre}' definida pero no usada`,
        severity,
        createCoreRange(input.linea, input.columna, input.linea, input.columna + input.nombre.length),
        { selector: input.selector }
    );
}
