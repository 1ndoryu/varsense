import * as assert from 'assert';
import { createCoreDocument, createCoreRange, serializeCoreFindings, CoreFinding } from '../../core/types';
import { findingToDiagnostic } from '../../core/vscodeAdapter';

suite('VarSense editor-agnostic core contracts', () => {
  test('creates a document with stable line helpers', () => {
    const document = createCoreDocument({
      uri: 'file:///workspace/src/styles.css',
      fileName: '/workspace/src/styles.css',
      languageId: 'css',
      content: ':root {\n  --colorPrincipal: #fff;\n}',
    });

    assert.strictEqual(document.lineCount, 3);
    assert.strictEqual(document.lineAt(1).text, '  --colorPrincipal: #fff;');
    assert.strictEqual(document.getText().includes('--colorPrincipal'), true);
  });

  test('serializes findings without editor-specific objects', () => {
    const finding: CoreFinding = {
      ruleId: 'valorHardcoded',
      message: 'Valor hardcodeado detectado',
      severity: 'warning',
      source: 'VarSense',
      range: createCoreRange(4, 2, 4, 14),
      suggestion: 'Usar una variable CSS',
    };

    const parsed = JSON.parse(serializeCoreFindings([finding])) as CoreFinding[];

    assert.strictEqual(parsed[0].ruleId, finding.ruleId);
    assert.strictEqual(parsed[0].range.start.character, 2);
    assert.strictEqual(parsed[0].severity, 'warning');
  });

  test('maps core findings to VS Code diagnostics at the boundary', () => {
    const diagnostic = findingToDiagnostic({
      ruleId: 'variableNoDefinida',
      message: 'Variable no definida',
      severity: 'error',
      source: 'VarSense',
      range: createCoreRange(1, 8, 1, 24),
    });

    assert.strictEqual(diagnostic.code, 'variableNoDefinida');
    assert.strictEqual(diagnostic.source, 'VarSense');
    assert.strictEqual(diagnostic.range.start.line, 1);
    assert.strictEqual(diagnostic.range.end.character, 24);
  });
});
