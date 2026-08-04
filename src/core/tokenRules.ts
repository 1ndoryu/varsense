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
        const byValue = new Map<string, IndexedVariable[]>();
        for (const entry of variables) {
            const key = normalizedValue(entry.variable.valor);
            if (!key) {
                continue;
            }
            const group = byValue.get(key) ?? [];
            group.push(entry);
            byValue.set(key, group);
        }
        for (const group of byValue.values()) {
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
