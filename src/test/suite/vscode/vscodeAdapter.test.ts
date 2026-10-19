import * as assert from 'assert';
import { createCoreRange } from '../../../core/types';
import { findingToDiagnostic } from '../../../vscode/vscodeAdapter';

/* El adaptador es la única frontera con VS Code: aquí se prueba el mapeo de
 * hallazgos del core a Diagnostic. Importa 'vscode', por eso corre en npm test
 * y no en test:unit (el runner lo omite automáticamente). */
suite('VS Code adapter: mapeo de hallazgos del core a Diagnostic', () => {
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
