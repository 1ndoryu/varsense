import * as assert from 'assert';
import { createCoreDocument, createCoreRange, serializeCoreFindings, CoreFinding } from '../../core/types';
import { findingToDiagnostic } from '../../core/vscodeAdapter';
import { parsearDocumento } from '../../parsers/cssParser';
import { VariableIndexBuilder } from '../../core/variableIndexBuilder';
import { ClassIndexBuilder } from '../../core/classIndexBuilder';
import { DocumentProvider, WorkspaceFile, WorkspaceFileProvider } from '../../core/workspaceProviders';

class MemoryWorkspaceProvider implements WorkspaceFileProvider, DocumentProvider {
  constructor(
    private readonly files: Record<string, { languageId: string; content: string }>,
    private readonly onOpen?: (file: WorkspaceFile) => void
  ) {}

  async findFiles(patterns: string[]): Promise<WorkspaceFile[]> {
    const extensions = patterns.map(pattern => pattern.replace('**/*', ''));
    return Object.keys(this.files)
      .filter(filePath => extensions.some(extension => filePath.endsWith(extension)))
      .map(filePath => ({ uri: `file://${filePath}`, fsPath: filePath }));
  }

  async openTextDocument(file: WorkspaceFile) {
    this.onOpen?.(file);
    const entry = this.files[file.fsPath];
    if (!entry) {
      throw new Error(`Missing fixture ${file.fsPath}`);
    }

    return createCoreDocument({
      uri: file.uri,
      fileName: file.fsPath,
      languageId: entry.languageId,
      content: entry.content,
    });
  }
}

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

  test('parses CSS using core ranges without editor objects', () => {
    const document = createCoreDocument({
      uri: 'file:///workspace/src/styles.css',
      fileName: '/workspace/src/styles.css',
      languageId: 'css',
      content: ':root {\n  --colorPrincipal: #fff;\n}\n.boton { color: var(--colorPrincipal); }',
    });

    const result = parsearDocumento(document, {
      debeVerificarPropiedad: propiedad => propiedad === 'color',
      esValorPermitido: () => false,
      propiedadesProhibidas: { habilitado: false, propiedades: [] },
    });

    assert.strictEqual(result.variablesDefinidas[0].nombre, '--colorPrincipal');
    assert.strictEqual(result.usosVariables[0].rango.start.line, 3);
    assert.doesNotThrow(() => JSON.stringify(result.usosVariables[0].rango));
  });

  test('builds a variable index through core providers', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: ':root { --colorPrincipal: #fff; }',
      },
    });
    const builder = new VariableIndexBuilder(provider, provider);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });

    assert.ok(result.indice.variables.has('--colorPrincipal'));
    assert.deepStrictEqual(result.indice.archivosEscaneados, ['/workspace/src/styles.css']);
  });

  test('cancels a variable index while a document is being opened', async () => {
    const token = { isCancellationRequested: false };
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/first.css': { languageId: 'css', content: ':root { --first: #fff; }' },
      '/workspace/src/second.css': { languageId: 'css', content: ':root { --second: #000; }' },
    }, () => {
      token.isCancellationRequested = true;
    });
    const builder = new VariableIndexBuilder(provider, provider);

    await assert.rejects(
      builder.build({ patterns: ['**/*.css'], exclude: [], maxConcurrent: 1, token }),
      /Análisis cancelado/
    );
  });

  test('cancels a class scan while a CSS document is being opened', async () => {
    const token = { isCancellationRequested: false };
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/first.css': { languageId: 'css', content: '.firstClass { color: red; }' },
      '/workspace/src/second.css': { languageId: 'css', content: '.secondClass { color: blue; }' },
    }, () => {
      token.isCancellationRequested = true;
    });
    const builder = new ClassIndexBuilder(provider, provider);

    await assert.rejects(
      builder.scan({ exclude: [], token }),
      /Análisis cancelado/
    );
  });

  test('ignores ordinary consumer document errors', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': { languageId: 'css', content: '.unusedClass { color: red; }' },
      '/workspace/src/view.ts': { languageId: 'typescript', content: 'const view = true;' },
    }, file => {
      if (file.fsPath.endsWith('.ts')) {
        throw new Error('simulated read failure');
      }
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [] });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'unusedClass');
  });

  test('propagates cancellation during consumer scanning', async () => {
    const token = { isCancellationRequested: false };
    let opened = 0;
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': { languageId: 'css', content: '.unusedClass { color: red; }' },
      '/workspace/src/view.ts': { languageId: 'typescript', content: 'const view = true;' },
    }, () => {
      opened += 1;
      if (opened === 2) {
        token.isCancellationRequested = true;
      }
    });
    const builder = new ClassIndexBuilder(provider, provider);

    await assert.rejects(
      builder.scan({ exclude: [], token }),
      /Análisis cancelado/
    );
  });

  test('reuses class scan results until a file is invalidated', async () => {
    const files = {
      '/workspace/src/styles.css': { languageId: 'css', content: '.oldClass { color: red; }' },
      '/workspace/src/view.ts': { languageId: 'typescript', content: "const className = 'oldClass';" },
    };
    const opened: string[] = [];
    const provider = new MemoryWorkspaceProvider(files, file => {
      opened.push(file.fsPath);
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const first = await builder.scan({ exclude: [] });
    assert.strictEqual(first.totalClasesHuerfanas, 0);

    opened.length = 0;
    const second = await builder.scan({ exclude: [] });
    assert.deepStrictEqual(opened, []);

    files['/workspace/src/styles.css'].content = '.newClass { color: blue; }';
    builder.invalidateFile('/workspace/src/styles.css');
    opened.length = 0;
    const third = await builder.scan({ exclude: [] });

    assert.deepStrictEqual(opened, ['/workspace/src/styles.css']);
    assert.strictEqual(third.totalClasesHuerfanas, 1);
    assert.strictEqual(third.clasesHuerfanas[0].nombre, 'newClass');
  });

  test('clears class cache explicitly', async () => {
    const files = {
      '/workspace/src/styles.css': { languageId: 'css', content: '.cachedClass { color: red; }' },
      '/workspace/src/view.ts': { languageId: 'typescript', content: "const className = 'cachedClass';" },
    };
    const opened: string[] = [];
    const provider = new MemoryWorkspaceProvider(files, file => {
      opened.push(file.fsPath);
    });
    const builder = new ClassIndexBuilder(provider, provider);

    await builder.scan({ exclude: [] });
    opened.length = 0;
    builder.clearCache();
    await builder.scan({ exclude: [] });

    assert.deepStrictEqual(opened.sort(), ['/workspace/src/styles.css', '/workspace/src/view.ts']);
  });

  test('delegates file cache invalidation and clear', () => {
    const provider = new MemoryWorkspaceProvider({});
    const invalidated: string[] = [];
    let cleared = 0;
    const cacheProvider = {
      invalidate: (fsPath: string) => invalidated.push(fsPath),
      clear: () => { cleared += 1; },
    };
    const builder = new ClassIndexBuilder(provider, provider, cacheProvider);

    builder.invalidateFile('/workspace/src/styles.css');
    builder.clearCache();

    assert.deepStrictEqual(invalidated, ['/workspace/src/styles.css']);
    assert.strictEqual(cleared, 1);
  });

  test('detects orphan classes through core providers', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: '.botonPrimario { color: red; }\n.panelOculto { color: blue; }',
      },
      '/workspace/src/App.tsx': {
        languageId: 'typescriptreact',
        content: '<button className="botonPrimario" />',
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'panelOculto');
  });

  test('recognizes vanilla DOM class contracts without hiding orphan classes', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.factoryPanel { color: red; }',
          '.containerRow { color: red; }',
          '.externalLink { color: red; }',
          '.activeIcon { color: red; }',
          '.contentFullBleed { color: red; }',
          '.unusedPanel { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.ts': {
        languageId: 'typescript',
        content: [
          "const view = createEl('div', { className: 'factoryPanel' });",
          "const row = createContainer('containerRow');",
          "const link = createExternalLink(url, 'ver', 'externalLink');",
          "icon.classList.add('activeIcon');",
          "const contentClass = entry.layout === 'full-bleed' ? 'contentFullBleed' : 'other';",
          "const className = helper('unusedPanel');",
          "const contentClass = \"factoryPanel\";",
          "// createContainer('fakeComment');",
          "const text = \"className: 'fakeString'\";",
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'unusedPanel');
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'contentFullBleed'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'campoError'), false);
  });

  test('recognizes static classes inside template interpolations', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: '.campoError { color: red; }\n.unusedClass { color: blue; }',
      },
      '/workspace/src/view.ts': {
        languageId: 'typescript',
        content: "const className = `campo ${error ? 'campoError' : ''}`;",
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'unusedClass');
  });

  test('supports quoted object keys, templates and multiline consumers', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: '.quotedObject { color: red; }\n.templateClass { color: red; }\n.multilineRow { color: red; }\n.stillOrphan { color: blue; }',
      },
      '/workspace/src/view.ts': {
        languageId: 'typescript',
        content: [
          "const view = createEl('div', {\n  'className': `templateClass ${state}`\n});",
          "const row = createContainer(\n  'multilineRow'\n);",
          "const other = { 'className': 'quotedObject' };",
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'stillOrphan');
  });
});
