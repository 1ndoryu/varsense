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

export interface VarsenseDocumentAnalysisConfig {
    hardcoded: VarsenseHardcodedConfig;
    inline: VarsenseInlineConfig;
    bannedProperties: VarsenseBannedPropertyConfig;
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
 * [289A-1] todo-prosa-sin-marcador RETIRADA de VarSense: una regla, un dueño.
 * La regla vive ahora en Sentinel Core (`todo-prosa-sin-marcador`, 0.7.15)
 * con paridad total verificada. `todoProseDetection` sigue aceptada en
 * `varsense.config.json` (compat: se ignora) hasta la proxima major.
 */

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
        return filtrar(analyzeCssDocument(document, variableIndex, config));
    }

    if (REACT_LANGUAGE_IDS.has(document.languageId)) {
        return filtrar(analyzeReactInlineStyles(document, config));
    }

    if (SCRIPT_LANGUAGE_IDS.has(document.languageId)) {
        return filtrar(analyzeScriptInlineStyles(document, config));
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
