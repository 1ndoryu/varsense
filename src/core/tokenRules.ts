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
        const allText = documents.map(item => item.document.getText()).join('\n');
        for (const entry of variables) {
            const escaped = entry.variable.nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const usageCount = (allText.match(new RegExp(`var\\(\\s*${escaped}(?:\\s*[,)]|\\b)`, 'g')) ?? []).length;
            if (usageCount > 0) {
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
