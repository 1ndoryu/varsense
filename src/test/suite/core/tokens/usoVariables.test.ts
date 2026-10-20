import * as assert from 'assert';
import { extraerUsoVariablesDeTexto } from '../../../../core/analisis/usoVariables';

/* [uso-js] Consumo de variables CSS desde JS: `getPropertyValue('--x')` cuenta como uso,
 * igual que `var(--x)`. La definicion en CSS no es uso (la cuenta cssParser).
 * Suite standalone (sin 'vscode'): se corre con `npx mocha --ui tdd dist/test/unit/suite/core/tokens/usoVariables.test.js`. */

suite('extraerUsoVariablesDeTexto', () => {
  test('reconoce getPropertyValue con comilla simple', () => {
    assert.deepStrictEqual(
      extraerUsoVariablesDeTexto("el.style.getPropertyValue('--col1-ancho')"),
      ['--col1-ancho'],
    );
  });

  test('reconoce getPropertyValue con comilla doble y backtick', () => {
    assert.deepStrictEqual(
      extraerUsoVariablesDeTexto('getPropertyValue("--a") + getPropertyValue(`--b`)'),
      ['--a', '--b'],
    );
  });

  test('sigue reconociendo var()', () => {
    assert.deepStrictEqual(extraerUsoVariablesDeTexto('color: var(--x);'), ['--x']);
  });

  test('una definicion CSS no cuenta como uso', () => {
    assert.deepStrictEqual(extraerUsoVariablesDeTexto('  --col1-ancho: 10px;'), []);
  });

  test('reconoce el shorthand bg-(--x) por defecto', () => {
    assert.deepStrictEqual(extraerUsoVariablesDeTexto('<p class="bg-(--x)">'), ['--x']);
  });

  test('con shorthandTailwind: false ignora bg-(--x) pero sigue con var()', () => {
    assert.deepStrictEqual(extraerUsoVariablesDeTexto('<p class="bg-(--x)">', { shorthandTailwind: false }), []);
    assert.deepStrictEqual(extraerUsoVariablesDeTexto('color: var(--y);', { shorthandTailwind: false }), ['--y']);
  });
});
