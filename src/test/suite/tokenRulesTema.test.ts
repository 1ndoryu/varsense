import * as assert from 'assert';
import { CssVariable } from '../../types';
import { buildAnalysisConfig } from '../../core/config';
import { analyzeTokenRules } from '../../core/tokenRules';
import { createCoreDocument } from '../../core/types';

/* [MN-token] Suite standalone (sin 'vscode'): token-unused reconoce utilidades
 * Tailwind v4 generadas por `@theme` y respeta `tokenDetection.unused.excludeTokens`.
 * Se corre con `npx mocha --ui tdd dist/test/suite/tokenRulesTema.test.js`. */

function variable(nombre: string, archivo = 'index.css'): CssVariable {
  return { nombre, valor: 'red', archivo, linea: 1, columna: 1 } as CssVariable;
}

function documento(content: string) {
  return { file: 'app.tsx', document: createCoreDocument({ uri: 'file:///app.tsx', fileName: 'app.tsx', languageId: 'typescriptreact', content }) };
}

function tokensSinUso(
  nombres: string[],
  contenido: string,
  excludeTokens?: string[],
): string[] {
  const config = buildAnalysisConfig({ tokenDetection: { unused: { excludeTokens } } });
  const variables = new Map([['index.css', nombres.map(n => variable(n))]]);
  return analyzeTokenRules(variables, [documento(contenido)], config)
    .filter(f => f.ruleId === 'token-unused')
    .map(f => String(f.metadata?.variable ?? f.message));
}

suite('VarSense token-unused con @theme de Tailwind v4', () => {
  test('una utilidad generada desde @theme cuenta como uso', () => {
    const css = '@theme inline {\n  --color-primary: red;\n}\n<div class="bg-primary text-sm"></div>';
    assert.deepStrictEqual(tokensSinUso(['--color-primary'], css), []);
  });

  test('radius y font se reconocen con su prefijo de utilidad', () => {
    const css = '@theme inline {\n  --radius-sm: 4px;\n  --font-soehne: x;\n}\n<p class="rounded-sm font-soehne"></p>';
    assert.deepStrictEqual(tokensSinUso(['--radius-sm', '--font-soehne'], css), []);
  });

  test('sin @theme la utilidad no cuenta: el token sin var() sigue sin uso', () => {
    assert.deepStrictEqual(tokensSinUso(['--color-primary'], '<div class="bg-primary"></div>'), ['--color-primary']);
  });

  test('un token sin uso alguno sigue marcándose', () => {
    const css = '@theme inline {\n  --color-sobra: red;\n}\n<div class="bg-primary"></div>';
    assert.deepStrictEqual(tokensSinUso(['--color-sobra'], css), ['--color-sobra']);
  });

  test('excludeTokens exime el token, con o sin prefijo "--"', () => {
    const css = '@theme inline {\n  --color-puente: red;\n  --radius-puente: 1px;\n}';
    assert.deepStrictEqual(tokensSinUso(['--color-puente', '--radius-puente'], css, ['color-puente', '--radius-puente']), []);
  });
});
