import * as assert from 'assert';
import { CssVariable } from '../../../../types';
import { buildAnalysisConfig, validateVarsenseConfig } from '../../../../core/configuracion/config';
import { analyzeTokenRules } from '../../../../core/analisis/tokenRules';
import { createCoreDocument } from '../../../../core/types';

/* [MN-token] Suite standalone (sin 'vscode'): cubre las dos reglas de tokens.
 * token-unused reconoce utilidades Tailwind v4 generadas por `@theme` y respeta
 * `tokenDetection.unused.excludeTokens`; token-duplicate respeta
 * `tokenDetection.duplicate.excludeTokens` (alias deliberados del design system).
 * Se corre con `npx mocha --ui tdd dist/test/unit/suite/core/tokens/tokenRules.test.js`. */

function variable(nombre: string, archivo = 'index.css', valor = 'red'): CssVariable {
  return { nombre, valor, archivo, linea: 1, columna: 1 } as CssVariable;
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

  test('el shorthand bg-(--x) de Tailwind v4 en TSX cuenta como uso', () => {
    const tsx = '<div className="bg-(--color-bg) p-2"></div>';
    assert.deepStrictEqual(tokensSinUso(['--color-bg'], tsx), []);
  });

  test('excludeTokens exime el token, con o sin prefijo "--"', () => {
    const css = '@theme inline {\n  --color-puente: red;\n  --radius-puente: 1px;\n}';
    assert.deepStrictEqual(tokensSinUso(['--color-puente', '--radius-puente'], css, ['color-puente', '--radius-puente']), []);
  });
});

/* [AG-1] Los namespaces de tema son configurables; los defaults siguen siendo los de Tailwind v4. */
suite('VarSense themeNamespaces configurable', () => {
  const css = '@theme inline {\n  --brand-x: red;\n}\n<p class="text-x"></p>';

  function sinUsoCon(themeNamespaces: unknown) {
    const config = buildAnalysisConfig({ tokenDetection: { themeNamespaces } } as never);
    const variables = new Map([['index.css', [variable('--brand-x')]]]);
    return analyzeTokenRules(variables, [documento(css)], config).filter(f => f.ruleId === 'token-unused').length;
  }

  test('sin configurar, --brand- no es namespace de tema y el token sigue sin uso', () => {
    assert.strictEqual(sinUsoCon(undefined), 1);
  });

  test('un namespace configurado reconoce sus utilidades', () => {
    assert.strictEqual(sinUsoCon([{ namespace: '--brand-', utilities: ['text'] }]), 0);
  });

  test('themeNamespaces con forma inválida se rechaza al cargar', () => {
    assert.throws(
      () => validateVarsenseConfig({ tokenDetection: { themeNamespaces: [{ namespace: 'brand', utilities: ['text'] }] } }),
      /debe tener la forma '--prefijo-'/
    );
    assert.throws(
      () => validateVarsenseConfig({ tokenDetection: { themeNamespaces: [{ namespace: '--brand-', utilities: [] }] } }),
      /lista no vacía/
    );
  });
});

/* [AG-1] `bg-(--x)` (shorthand Tailwind v4) cuenta como uso salvo `tailwindShorthand: false`. */
suite('VarSense tailwindShorthand configurable', () => {
  const tsx = '<p class="bg-(--brand-x)"></p>';

  function sinUsoCon(tailwindShorthand: unknown) {
    const config = buildAnalysisConfig({ tokenDetection: { tailwindShorthand } } as never);
    const variables = new Map([['index.css', [variable('--brand-x')]]]);
    return analyzeTokenRules(variables, [documento(tsx)], config).filter(f => f.ruleId === 'token-unused').length;
  }

  test('por defecto el shorthand cuenta como uso', () => {
    assert.strictEqual(sinUsoCon(undefined), 0);
  });

  test('con tailwindShorthand: false el token queda sin uso', () => {
    assert.strictEqual(sinUsoCon(false), 1);
  });

  test('tailwindShorthand con tipo no booleano se rechaza al cargar', () => {
    assert.throws(
      () => validateVarsenseConfig({ tokenDetection: { tailwindShorthand: 'no' } }),
      /'tokenDetection.tailwindShorthand' debe ser boolean/
    );
  });
});

/* [321A-1] token-duplicate: un tema tipo shadcn declara varios roles sobre el
 * mismo valor a proposito (--card y --popover valen lo mismo que --background)
 * para poder re-tematizar cada rol por separado: repetir el valor ES la
 * estructura. La regla no puede adivinarlo, asi que lo declara el proyecto en
 * `tokenDetection.duplicate.excludeTokens`. El par testigo (--sueltoUno /
 * --sueltoDos) comprueba que la regla sigue viva con la exclusion puesta. */

function duplicadosMarcados(
  pares: Array<[nombre: string, valor: string]>,
  excludeTokens?: string[],
): string[] {
  const config = buildAnalysisConfig({ tokenDetection: { duplicate: { excludeTokens } } });
  const variables = new Map([['index.css', pares.map(([nombre, valor]) => variable(nombre, 'index.css', valor))]]);
  return analyzeTokenRules(variables, [], config)
    .filter(f => f.ruleId === 'token-duplicate')
    .map(f => f.message);
}

suite('VarSense token-duplicate con alias declarados', () => {
  const SHADCN: Array<[string, string]> = [
    ['--background', 'oklch(1 0 0)'],
    ['--card', 'oklch(1 0 0)'],
    ['--sueltoUno', '#123456'],
    ['--sueltoDos', '#123456'],
  ];

  test('sin excludeTokens marca el alias y el testigo', () => {
    assert.strictEqual(duplicadosMarcados(SHADCN).length, 2);
  });

  test('con excludeTokens calla el alias y deja vivo el testigo', () => {
    const marcados = duplicadosMarcados(SHADCN, ['--card']);
    assert.strictEqual(marcados.length, 1);
    assert.ok(marcados[0].includes('--sueltoDos'));
  });

  test('el token excluido no agrupa ni como canonico ni como duplicado', () => {
    const par: Array<[string, string]> = [['--card', '#abcdef'], ['--popover', '#abcdef']];
    assert.strictEqual(duplicadosMarcados(par).length, 1);
    assert.strictEqual(duplicadosMarcados(par, ['--card']).length, 0);
  });

  test('excludeTokens acepta el nombre con o sin prefijo "--"', () => {
    const par: Array<[string, string]> = [['--card', '#abcdef'], ['--popover', '#abcdef']];
    assert.strictEqual(duplicadosMarcados(par, ['card']).length, 0);
  });
});
