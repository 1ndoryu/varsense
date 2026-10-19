import { DiagnosticType, VariableIndex } from '@/types';
import { CoreFinding, CoreSeverity, CoreTextDocument, createCoreRange, positionAtOffset } from '../types';
import type { ParserVarsense } from '../puertoParsers';
import { enmascararComentarios } from './enmascararComentarios';
import { analyzeEstiloBotonEspecifico, VarsenseEstiloBotonConfig } from './reglasBotonCss';

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
        duplicate: { habilitado: boolean; severidad: CoreSeverity; excluirTokens?: string[] };
        unused: { habilitado: boolean; severidad: CoreSeverity; excluirTokens?: string[] };
        crossFile: { habilitado: boolean; severidad: CoreSeverity };
    };
    estiloBoton: VarsenseEstiloBotonConfig;
}

const REACT_LANGUAGE_IDS = new Set(['typescriptreact', 'javascriptreact']);
const SCRIPT_LANGUAGE_IDS = new Set(['typescript', 'javascript']);
const CSS_LANGUAGE_IDS = new Set(['css', 'scss', 'sass', 'less', 'vue', 'html']);
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
    config: VarsenseDocumentAnalysisConfig,
    parsers: ParserVarsense
): CoreFinding[] {
    const parseResult = parsers.parsearDocumento(document, {
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

/* Expresion que es solo el identificador `style` (reenvio de prop). */
function esReenvioDePropStyle(expresion: string): boolean {
    return /^\s*style\s*$/.test(expresion);
}

function analyzeReactInlineStyles(
    document: CoreTextDocument,
    config: VarsenseDocumentAnalysisConfig,
    parsers: ParserVarsense
): CoreFinding[] {
    const estilo = parsers.estilo;
    if (!config.inline.habilitado) {
        return [];
    }

    /* [17AA-3] Se busca sobre el texto con los comentarios enmascarados: un
     * `style={}` escrito en un comentario no es CSS inline. Misma longitud, asi
     * que los offsets y las lineas siguen valiendo sobre el original. */
    const text = enmascararComentarios(document.getText());
    const findings: CoreFinding[] = [];
    let match: RegExpExecArray | null;

    /* [15A-25] Un solo recorrido del atributo. Antes eran dos regexes
     * complementarios (`style={{` y `style={algo}`), y el ternario
     * `style={cond ? { '--top': v } : undefined}` no casaba con ninguno de los
     * dos: caia en la rama generica y sus claves no llegaban al indice. Aqui el
     * atributo se delimita balanceando llaves y se miran TODOS los objetos
     * literales de la expresion. */
    estilo.regexAtributo.lastIndex = 0;
    while ((match = estilo.regexAtributo.exec(text)) !== null) {
        const inicioLlave = match.index + match[0].length - 1;
        const fin = estilo.finExpresion(text, inicioLlave);

        /* Objeto solo con custom properties = definicion runtime de tokens
         * (mismo patron eximido que setProperty): no es inline. */
        if (estilo.esSoloDefinicionTokens(estilo.clavesDeExpresion(text, inicioLlave, fin))) {
            continue;
        }

        /* `style={style}` reenvia al hijo la prop `style` que recibio el componente:
         * no es CSS inline escrito aqui, asi que no se marca. */
        if (esReenvioDePropStyle(text.slice(inicioLlave + 1, fin - 1))) {
            continue;
        }

        findings.push(finding(
            DiagnosticType.CssInlineReact,
            'CSS inline detectado - usa clases CSS con variables en vez de style={{}}',
            config.inline.severidad,
            {
                start: positionAtOffset(document, match.index),
                end: positionAtOffset(document, fin),
            }
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

    /* [17AA-3] Mismo enmascarado que la ruta React: `.style.x =` dentro de un
     * comentario tampoco es CSS inline. */
    const text = enmascararComentarios(document.getText());
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
 *
 * [15A-27] Exportado para que la ruta de claseHuerfana (indice de clases, en
 * el CLI) aplique los MISMOS marcadores. Ese analisis no pasa por
 * analyzeVarsenseDocument, asi que un marcador sobre la definicion de una
 * clase no callaba nada: el marcador existia y mentia.
 */
export function parsearLineasSuprimidas(texto: string): Set<number> {
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

/* El parser llega por parametro (puerto): el core no conoce la implementacion. */
export function analyzeVarsenseDocument(
    document: CoreTextDocument,
    variableIndex: VariableIndex,
    config: VarsenseDocumentAnalysisConfig,
    parsers: ParserVarsense
): CoreFinding[] {
    const lineasSuprimidas = parsearLineasSuprimidas(document.getText());
    const filtrar = (hallazgos: CoreFinding[]): CoreFinding[] =>
        lineasSuprimidas.size > 0
            ? hallazgos.filter(hallazgo => !lineasSuprimidas.has(hallazgo.range.start.line))
            : hallazgos;

    if (CSS_LANGUAGE_IDS.has(document.languageId)) {
        return filtrar([
            ...analyzeCssDocument(document, variableIndex, config, parsers),
            ...analyzeEstiloBotonEspecifico(document, config.estiloBoton),
        ]);
    }

    if (REACT_LANGUAGE_IDS.has(document.languageId)) {
        return filtrar(analyzeReactInlineStyles(document, config, parsers));
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
