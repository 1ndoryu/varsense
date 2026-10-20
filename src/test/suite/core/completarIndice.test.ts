/* [318A-7V24] completarIndice añade definiciones runtime y CSS con scope fuera de variableFiles; CLI y LSP usan el mismo método. */

import * as assert from 'assert';
import { VariableIndexBuilder } from '../../../core/indices/variableIndexBuilder';
import { parserCssVarsense } from '../../../parsers';
import { MemoryWorkspaceProvider } from '../helpers/memoriaWorkspace';

const ARCHIVOS = {
    '/workspace/src/vars.css': { languageId: 'css', content: ':root { --raiz: #fff; }' },
    '/workspace/src/card.css': { languageId: 'css', content: ':host { --local: 2px; }' },
    '/workspace/src/app.ts': { languageId: 'typescript', content: "el.style.setProperty('--runtime', '1px');" },
};

function archivo(fsPath: string) {
    return { uri: `file://${fsPath}`, fsPath };
}

suite('completarIndice', () => {
    test('añade setProperty y CSS con scope que variableFiles no cubre', async () => {
        const provider = new MemoryWorkspaceProvider(ARCHIVOS);
        const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);
        const resultado = await builder.build({ patterns: ['**/vars.css'], exclude: [] });
        assert.ok(!resultado.indice.variables.has('--runtime'));
        assert.ok(!resultado.indice.variables.has('--local'));

        await builder.completarIndice(
            resultado,
            [archivo('/workspace/src/app.ts'), archivo('/workspace/src/card.css')],
            ['.css']
        );

        assert.ok(resultado.indice.variables.has('--raiz'));
        assert.ok(resultado.indice.variables.has('--runtime'));
        assert.ok(resultado.indice.variables.has('--local'));
    });

    test('no vuelve a leer un CSS que ya está en variablesPorArchivo', async () => {
        const provider = new MemoryWorkspaceProvider(ARCHIVOS);
        const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);
        const resultado = await builder.build({ patterns: ['**/vars.css'], exclude: [] });
        const antes = resultado.variablesPorArchivo.get('/workspace/src/vars.css');

        await builder.completarIndice(resultado, [archivo('/workspace/src/vars.css')], ['.css']);

        assert.strictEqual(resultado.variablesPorArchivo.get('/workspace/src/vars.css'), antes);
    });
});
