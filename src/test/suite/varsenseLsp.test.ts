import * as assert from 'assert';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { createCoreRange } from '../../core/types';
import { coreSeverityToLspSeverity, findingToLspDiagnostic } from '../../lsp/diagnostics';

suite('VarSense LSP diagnostics', () => {
    test('mapea severidades core a severidades LSP', () => {
        assert.strictEqual(coreSeverityToLspSeverity('error'), DiagnosticSeverity.Error);
        assert.strictEqual(coreSeverityToLspSeverity('warning'), DiagnosticSeverity.Warning);
        assert.strictEqual(coreSeverityToLspSeverity('information'), DiagnosticSeverity.Information);
        assert.strictEqual(coreSeverityToLspSeverity('hint'), DiagnosticSeverity.Hint);
    });

    test('convierte CoreFinding a Diagnostic LSP serializable', () => {
        const diagnostic = findingToLspDiagnostic({
            ruleId: 'variableNoDefinida',
            message: 'Variable no definida',
            severity: 'error',
            source: 'VarSense',
            range: createCoreRange(2, 4, 2, 22),
            metadata: { variable: '--colorMissing' },
        });

        assert.strictEqual(diagnostic.code, 'variableNoDefinida');
        assert.strictEqual(diagnostic.severity, DiagnosticSeverity.Error);
        assert.strictEqual(diagnostic.range.start.line, 2);
        assert.deepStrictEqual(diagnostic.data, { variable: '--colorMissing' });
        assert.doesNotThrow(() => JSON.stringify(diagnostic));
    });
});
