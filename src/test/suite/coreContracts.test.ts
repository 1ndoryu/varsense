import * as assert from 'assert';
import { createCoreDocument, createCoreRange, serializeCoreFindings, CoreFinding } from '../../core/types';
import { findingToDiagnostic } from '../../core/vscodeAdapter';
import { parsearDocumento } from '../../parsers/cssParser';
import { VariableIndexBuilder } from '../../core/variableIndexBuilder';
import { ClassIndexBuilder } from '../../core/classIndexBuilder';
import { DocumentProvider, WorkspaceFile, WorkspaceFileProvider } from '../../core/workspaceProviders';

class MemoryWorkspaceProvider implements WorkspaceFileProvider, DocumentProvider {
  constructor(private readonly files: Record<string, { languageId: string; content: string }>) {}

  async findFiles(patterns: string[]): Promise<WorkspaceFile[]> {
    const extensions = patterns.map(pattern => pattern.replace('**/*', ''));
    return Object.keys(this.files)
      .filter(filePath => extensions.some(extension => filePath.endsWith(extension)))
      .map(filePath => ({ uri: `file://${filePath}`, fsPath: filePath }));
  }

  async openTextDocument(file: WorkspaceFile) {
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
