/* [018A-5] Reglas de tokens compartidas por CLI/LSP/VS Code. El análisis usa
 * el snapshot ya construido y no vuelve a leer el workspace. */

import { CssVariable } from '@/types';
import { VarsenseDocumentAnalysisConfig } from './analyzeDocument';
import { CoreFinding, CoreTextDocument, createCoreRange } from './types';

interface IndexedVariable { variable: CssVariable; file: string }

function tokenFinding(
    ruleId: string,
    message: string,
    severity: CoreFinding['severity'],
    variable: CssVariable,
    metadata: Record<string, unknown>,
): CoreFinding {
    return {
        ruleId,
        message,
        severity,
        source: 'VarSense',
        range: createCoreRange(variable.linea, variable.columna, variable.linea, variable.columna + variable.nombre.length),
        metadata,
    };
}

function normalizedValue(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/* [149A-1 F3.15] Distancia Levenshtein iterativa (O(n*m) acotado por la
 * longitud de nombres de token, típicamente < 40). */
function levenshtein(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    if (a.length === 0) {
        return b.length;
    }
    if (b.length === 0) {
        return a.length;
    }
    let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const actual = [i];
        for (let j = 1; j <= b.length; j++) {
            actual[j] = Math.min(
                previa[j] + 1,
                actual[j - 1] + 1,
                previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        previa = actual;
    }
    return previa[b.length];
}

function similitudNombres(a: string, b: string): number {
    const normalizados = [a, b].map(nombre => nombre.replace(/^--/, '').toLowerCase());
    const maximo = Math.max(normalizados[0].length, normalizados[1].length);
    if (maximo === 0) {
        return 0;
    }
    return 1 - levenshtein(normalizados[0], normalizados[1]) / maximo;
}

/* [149A-1 F3.15] duplicado-cross-crate: mismo valor en archivos DISTINTOS
 * con nombres similares (>= 0.75). Regla separada info→warning con rutas y
 * similitud en el mensaje; token-duplicate (same-file, 318A-7V8) intacto.
 * Guardas 0 FP: mismo nombre en varios archivos = override de cascada
 * (no marca); coincidencia de valor con nombres disimiles = dominios
 * independientes (no marca, caso auditoria --radioMinimo/--ptr-translateY).
 * Tope determinista de hallazgos para acotar ruido en repos grandes. */
const UMBRAL_SIMILITUD_CROSS_FILE = 0.75;
const MAX_HALLAZGOS_CROSS_FILE = 25;

export function analyzeCrossFileDuplicates(
    variablesPorArchivo: Map<string, CssVariable[]>,
    config: VarsenseDocumentAnalysisConfig,
): CoreFinding[] {
    if (!config.tokens.crossFile.habilitado) {
        return [];
    }

    const porValor = new Map<string, IndexedVariable[]>();
    for (const [file, definitions] of variablesPorArchivo) {
        for (const variable of definitions) {
            const clave = normalizedValue(variable.valor);
            if (!clave) {
                continue;
            }
            const grupo = porValor.get(clave) ?? [];
            grupo.push({ variable, file });
            porValor.set(clave, grupo);
        }
    }

    const hallazgos: CoreFinding[] = [];
    for (const grupo of porValor.values()) {
        const ordenado = [...grupo].sort((x, y) =>
            x.file === y.file
                ? x.variable.nombre.localeCompare(y.variable.nombre)
                : x.file.localeCompare(y.file)
        );
        for (let i = 0; i < ordenado.length && hallazgos.length < MAX_HALLAZGOS_CROSS_FILE; i++) {
            for (let j = i + 1; j < ordenado.length && hallazgos.length < MAX_HALLAZGOS_CROSS_FILE; j++) {
                const a = ordenado[i];
                const b = ordenado[j];
                if (a.file === b.file || a.variable.nombre === b.variable.nombre) {
                    continue;
                }
                const similitud = similitudNombres(a.variable.nombre, b.variable.nombre);
                if (similitud < UMBRAL_SIMILITUD_CROSS_FILE) {
                    continue;
                }
                hallazgos.push(tokenFinding(
                    'token-duplicado-cross-archivo',
                    `Token '${b.variable.nombre}' (${b.file}) repite el valor de '${a.variable.nombre}' (${a.file}) con nombre similar (similitud ${similitud.toFixed(2)}).`,
                    config.tokens.crossFile.severidad,
                    b.variable,
                    {
                        canonical: a.variable.nombre,
                        file: b.file,
                        otherFile: a.file,
                        value: b.variable.valor,
                        similarity: Number(similitud.toFixed(2)),
                    },
                ));
            }
        }
        if (hallazgos.length >= MAX_HALLAZGOS_CROSS_FILE) {
            break;
        }
    }
    return hallazgos;
}

export function analyzeTokenRules(
    variablesPorArchivo: Map<string, CssVariable[]>,
    documents: Array<{ file: string; document: CoreTextDocument }>,
    config: VarsenseDocumentAnalysisConfig,
    /* [028A-8 tramo 4] Índice inverso variable → consumidores del snapshot
     * persistente. Cuando está presente, token-unused consulta el índice en
     * lugar de escanear el texto completo de todos los documentos por variable
     * (O(vars × texto) → O(vars + usos)); sin el índice se conserva el
     * comportamiento previo para LSP/editor. */
    variableUsageIndex?: Map<string, string[]>,
): CoreFinding[] {
    const variables: IndexedVariable[] = [];
    for (const [file, definitions] of variablesPorArchivo) {
        for (const variable of definitions) {
            variables.push({ variable, file });
        }
    }

    const findings: CoreFinding[] = [];
    if (config.tokens.duplicate.habilitado) {
        /* [318A-7V8] Un duplicado real repite el valor dentro del MISMO archivo
         * (mismo dominio semántico del design system, p.ej. dos tokens del
         * :root de variables.css). La coincidencia de valor entre archivos
         * distintos (p.ej. `--ptr-translateY` [offset runtime de
         * pull-to-refresh, = '0'] vs `--dashboard-radioMinimo` [radio, = '0'])
         * es una coincidencia entre dominios independientes: colapsarla
         * acoplaría archivos y semánticas ajenas. La clave agrupa por
         * archivo+valor para que canonical y duplicados vivan en el mismo
         * archivo; sin esto se perdían los pares intra-archivo cuando el
         * canonical caía en otro archivo. Auditoría FN en PT (186→181):
         * 5 hallazgos eliminados, todos cross-file verificados a mano
         * (--space-xs/--scrollbarAncho, --space-sm/--espacioTactil,
         * --arbol-color/--pixel-editor-iconoActivo,
         * --panelHeaderBorde/--pixel-editor-iconoBorde,
         * --radioMinimo/--ptr-translateY), 0 pares reales perdidos. */
        const byFileValue = new Map<string, IndexedVariable[]>();
        for (const entry of variables) {
            const key = normalizedValue(entry.variable.valor);
            if (!key) {
                continue;
            }
            const groupKey = `${entry.file}\u0000${key}`;
            const group = byFileValue.get(groupKey) ?? [];
            group.push(entry);
            byFileValue.set(groupKey, group);
        }
        for (const group of byFileValue.values()) {
            const names = new Set(group.map(entry => entry.variable.nombre));
            if (group.length < 2 || names.size < 2) {
                continue;
            }
            const canonical = group[0];
            for (const duplicate of group.slice(1)) {
                findings.push(tokenFinding(
                    'token-duplicate',
                    `Token '${duplicate.variable.nombre}' repite el valor de '${canonical.variable.nombre}'.`,
                    config.tokens.duplicate.severidad,
                    duplicate.variable,
                    { canonical: canonical.variable.nombre, value: duplicate.variable.valor, file: duplicate.file },
                ));
            }
        }
    }

    if (config.tokens.unused.habilitado) {
        const allText = variableUsageIndex ? null : documents.map(item => item.document.getText()).join('\n');
        let usedNames: Set<string> | undefined;
        for (const entry of variables) {
            let used = false;
            if (variableUsageIndex) {
                used = (variableUsageIndex.get(entry.variable.nombre) ?? []).length > 0;
            } else {
                /* Fallback sin índice: extrae los nombres usados una sola vez
                 * con la misma semántica que extraerUsoVariablesDeTexto
                 * (var(\s*--name), tolera espacios). O(texto) total, no por
                 * variable; evita regex dinámica (escapado frágil). */
                if (!usedNames) {
                    usedNames = new Set<string>();
                    const regexVar = /var\(\s*(--[\w-]+)/g;
                    let match: RegExpExecArray | null;
                    while ((match = regexVar.exec(allText!)) !== null) {
                        usedNames.add(match[1]);
                    }
                }
                used = usedNames.has(entry.variable.nombre);
            }
            if (used) {
                continue;
            }
            findings.push(tokenFinding(
                'token-unused',
                `Token '${entry.variable.nombre}' está definido pero no se usa en el snapshot.`,
                config.tokens.unused.severidad,
                entry.variable,
                { variable: entry.variable.nombre, file: entry.file },
            ));
        }
    }
    return findings;
}
