import * as assert from 'assert';
import { createCoreDocument, createCoreRange, serializeCoreFindings, CoreFinding } from '../../core/types';
import { findingToDiagnostic } from '../../core/vscodeAdapter';
import { parsearDocumento } from '../../parsers/cssParser';
import { parsearDefinicionesRuntime } from '../../parsers/cssParser';
import { analyzeVarsenseDocument } from '../../core/analyzeDocument';
import { buildAnalysisConfig } from '../../core/config';
import { analyzeCrossFileDuplicates, analyzeTokenRules } from '../../core/tokenRules';
import { VariableIndexBuilder } from '../../core/variableIndexBuilder';
import { ClassIndexBuilder } from '../../core/classIndexBuilder';
import { detectarCarriersMismoArchivo, extraerMapasExportados, extraerNombresImportadosRelativos, esNombrePortadorClase } from '../../core/classIndexBuilder';
import { NodeWorkspaceFileProvider } from '../../core/nodeProviders';
import { DocumentProvider, WorkspaceFile, WorkspaceFileProvider } from '../../core/workspaceProviders';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

class MemoryWorkspaceProvider implements WorkspaceFileProvider, DocumentProvider {
  constructor(
    private readonly files: Record<string, { languageId: string; content: string }>,
    private readonly onOpen?: (file: WorkspaceFile) => void,
    private readonly onFind?: (patterns: string[]) => void
  ) {}

  async findFiles(patterns: string[]): Promise<WorkspaceFile[]> {
    this.onFind?.(patterns);
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

  test('discovers consumer files in one provider pass', async () => {
    const findCalls: string[][] = [];
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': { languageId: 'css', content: '.unusedClass { color: red; }' },
      '/workspace/src/view.ts': { languageId: 'typescript', content: "const className = 'unusedClass';" },
    }, undefined, patterns => findCalls.push(patterns));
    const builder = new ClassIndexBuilder(provider, provider);

    await builder.scan({ exclude: [] });

    assert.strictEqual(findCalls.length, 2, 'CSS y consumidores deben descubrirse en dos recorridos');
    assert.deepStrictEqual(findCalls[1], [
      '**/*.tsx', '**/*.jsx', '**/*.ts', '**/*.js', '**/*.php', '**/*.html',
      /* [318A-7V3] Los CSS también consumen clases: un selector compuesto en
       * otro CSS (.dashboardGrid en movilBase.css refiriendo base.css) es uso
       * real; el propio scan() excluye el archivo de definición de cada clase. */
      '**/*.css',
    ]);
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

    /* [318A-7V3] El CSS inválidado se reabre en ambos recorridos: el de
     * definiciones y el de consumo (los CSS son consumidores desde 318A-7V3),
     * por lo que aparece dos veces. */
    assert.deepStrictEqual(opened, ['/workspace/src/styles.css', '/workspace/src/styles.css']);
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

    /* [318A-7V3] Ídem: con clearCache el CSS se reabre en ambos recorridos
     * (definiciones + consumo), por eso aparece dos veces en la lista. */
    assert.deepStrictEqual(opened.sort(), [
      '/workspace/src/styles.css',
      '/workspace/src/styles.css',
      '/workspace/src/view.ts',
    ]);
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

  /* [318A-7V14] Familia dinámica por template literal con prefijo pegado:
   * `badgeInfo--${variante}` (BadgeInfo.tsx) emite en runtime cualquier
   * miembro de la familia badgeInfo--*, porque el sufijo sale de una unión
   * de valores. El prefijo estático pegado a la interpolación marca TODA la
   * familia como en-uso; una clase fuera de la familia sigue reportada. */
  test('template literal glued prefix marks the whole class family as used', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.badgeInfo--exito { color: red; }',
          '.badgeInfo--peligro { color: red; }',
          '.badgeInfo--muerto { color: blue; }',
          '.otraClaseMuerta { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: 'const view = <span className={`badgeInfo--${variante}`} />;',
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'otraClaseMuerta');
    assert.equal(result.clasesHuerfanas.some(item => item.nombre.startsWith('badgeInfo--')), false);
  });

  /* [318A-7V14] Prefijo camelCase sin separador: `selectorNivelBoton${sufijo}`
   * (SelectorNivel.tsx) cubre selectorNivelBotonUrgente/Activo/etc. Igual
   * que el caso BEM, el prefijo pegado marca la familia completa. */
  test('camelCase glued prefix covers suffix-map families', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.selectorNivelBotonActivo { color: red; }',
          '.selectorNivelBotonUrgente { color: red; }',
          '.selectorNivelBotonLegacyMuerto { color: blue; }',
          '.selectorOtroVivo { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: 'const view = <button className={`selectorNivelBoton${claseSufijo}`} />;',
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'selectorOtroVivo');
  });

  /* [318A-7V14] Límite de la semántica: una interpolación separada por ESPACIO
   * (`estadoViabilidad ${estado}`) aporta la clase completa, no una familia;
   * CSS con prefijo parecido (estadoViabilidadMuerto) NO se exime. Las clases
   * completas dinámicas las resuelven variables/switch, no el prefijo. */
  test('space-separated interpolation does not mark families', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.estadoViabilidad { color: red; }',
          '.estadoViabilidadMuerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: 'const view = <span className={`estadoViabilidad ${estado}`} />;',
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'estadoViabilidadMuerto');
  });

  /* [318A-7V17] Prosa con template interpolado (titulo={...}, mostrarExito(`...`))
   * NO es una familia: `${n} archivo${...} adjunto${...}` tiene segmentos con
   * whitespace previo (" adjunto") que el fix anterior registraba como
   * prefijo espurio "adjunto"/"archivo", absorbiendo huérfanas reales como
   * `adjuntosAreaCarga--bloqueado` (sin consumidor, TareaBadges.tsx:143,
   * usePanelRecordatorios.ts:141). Solo un token pegado sin whitespace
   * alrededor (badgeInfo--${x}) es familia. */
  test('prose template literals never register spurious families', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.adjuntosAreaCarga { color: red; }',
          '.adjuntosAreaCarga--subiendo { color: red; }',
          '.adjuntosAreaCarga--bloqueado { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: [
          'const n = 2;',
          'const view = <div className={`adjuntosAreaCarga ${subiendo ? \'adjuntosAreaCarga--subiendo\' : \'\'}`}>',
          '  <Badge titulo={`${n} archivo${n > 1 ? \'s\' : \'\'} adjunto${n > 1 ? \'s\' : \'\'}`} />',
          '</div>;',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    /* La familia espuria "adjunto" NO debe eximir adjuntosAreaCarga--bloqueado;
     * la clase usada literalmente (adjuntosAreaCarga) sí está en uso. El único
     * reporte es la muerta real. */
    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'adjuntosAreaCarga--bloqueado');
  });

  /* [318A-7V17] Un segmento puede compartir espacio con otra clase literal:
   * `badgeInfo badgeInfo--${variante}` (BadgeInfo.tsx:34). La familia es el
   * token PEGADO al `${` (badgeInfo--), no el segmento completo; el guard de
   * prosa rechaza palabras minúsculas sin guion (adjunto/archivo/recordatorio)
   * pero NO debe perder familias BEM multi-clase. */
  test('multi-class template segments register the glued BEM family prefix', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.badgeInfo--exito { color: green; }',
          '.badgeInfo--advertencia { color: orange; }',
          '.badgeInfoMuerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/BadgeInfo.tsx': {
        languageId: 'typescriptreact',
        content: [
          'export function BadgeInfo({ variante }: { variante: string }) {',
          '  const clases = `badgeInfo badgeInfo--${variante}`.trim();',
          '  return <span className={clases} />;',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    /* La familia `badgeInfo--` (token pegado) exime ambas variantes; la clase
     * muerta sin prefijo sigue reportándose: 0 FN, 0 FP. */
    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'badgeInfoMuerto');
  });

  /* [318A-7V18] Contexto de ATRIBUTO de clase: cuando la interpolación vive
   * dentro de className/claseAdicional={...}, el contenido ES una cadena de
   * clases por construcción. `detallePlan ${usuario.suscripcion.plan}`
   * (DetalleUsuario.tsx:79) registra el segmento estático `detallePlan`
   * como clase real aunque termine en espacio — el guard de prosa (V17)
   * solo aplica a declaraciones/cadenas fuera de atributos. El estado
   * interpolado (premium/free/trial) NO se exime: es zona gris que el
   * detector reporta con fundamento. */
  test('attribute-context templates register static bases as used classes', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.detallePlan { color: red; }',
          '.detallePlan.premium { color: gold; }',
          '.detallePlanMuerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/DetalleUsuario.tsx': {
        languageId: 'typescriptreact',
        content: [
          'export function DetalleUsuario({ usuario }: any) {',
          '  return (',
          '    <div className={`detallePlan ${usuario.suscripcion.plan}`}>',
          '      <p>{usuario.nombre}</p>',
          '    </div>',
          '  );',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    /* `detallePlan` en uso (clase base); `premium` (estado runtime, zona
     * gris documentada) y la muerta real se reportan con fundamento. */
    assert.strictEqual(result.totalClasesHuerfanas, 2);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'detallePlan'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'detallePlanMuerto'), true);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'premium'), true);
  });

  /* [318A-7V18] Template ANIDADO en atributo de clase:
   * claseAdicional={`selectorNivelBoton ${activo ? `selectorNivelBotonActivo
   * selectorNivelBoton${claseSufijo}` : ''}`} (SelectorNivel.tsx:39). El
   * regex plano se cortaba en el backtick/`}` INTERIOR y perdía el template
   * entero (clases literales + familia); el escáner balanceado recupera
   * segmento estático, literal anidado y familia `selectorNivelBoton`. */
  test('nested template literals inside class attributes are fully indexed', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.selectorNivelBoton { color: red; }',
          '.selectorNivelBotonActivo { color: red; }',
          '.selectorNivelBotonUrgente { color: red; }',
          '.nivelMuerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/SelectorNivel.tsx': {
        languageId: 'typescriptreact',
        content: [
          'export function SelectorNivel({ activo, claseSufijo }: any) {',
          '  return (',
          '    <Boton type="button" variante="ghost"',
          '      claseAdicional={`selectorNivelBoton ${activo ? `selectorNivelBotonActivo selectorNivelBoton${claseSufijo}` : \'\'}`}>',
          '      nivel',
          '    </Boton>',
          '  );',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    /* La familia `selectorNivelBoton` (token pegado) exime las variantes;
     * la muerta sin prefijo sigue reportada: 0 FN, 0 FP. */
    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'nivelMuerto');
  });

  /* [318A-7V14] El prefijo pegado también aplica en la forma object factory
   * (createEl('div', { className: `panel--${x}` }) de Glory-Laminal) y en
   * declaraciones de variables con template interpolado. */
  test('glued template prefix works in object factories and variable declarations', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.panel--oscuro { color: red; }',
          '.panel--claro { color: red; }',
          '.capaOverlay--abierta { color: red; }',
          '.panelMuertoReal { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.ts': {
        languageId: 'typescript',
        content: [
          "const el = createEl('div', { className: `panel--${tema}` });",
          "const capas = `capaOverlay--${estado} oculta`;",
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'panelMuertoReal');
    assert.equal(result.clasesHuerfanas.some(item => item.nombre.startsWith('panel--')), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre.startsWith('capaOverlay--')), false);
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

  /* [318A-7V2] Props *clase del design system (claseAdicional, claseExtra,
   * claseContenido, claseOverlay, claseContenedor) son portadoras de clase:
   * los tres formularios de valor (attr string, template, expr JSX) deben
   * registrar sus tokens igual que className. */
  test('reconoce props *clase (claseAdicional/claseExtra) en attr, template y expr', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.panelExtra { color: red; }',
          '.panelContenido { color: red; }',
          '.panelCondicional { color: red; }',
          '.panelDirecto { color: red; }',
          '.panelMuerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: [
          "const Contenido = ({estaActivo}: {estaActivo: boolean}) => (",
          "  <div>",
          "    <div claseExtra='panelExtra'>x</div>",
          "    <div claseContenido={`panelContenido ${estaActivo ? 'panelCondicional' : ''}`}>y</div>",
          "    <div claseAdicional={estaActivo ? 'panelDirecto' : ''}>z</div>",
          "  </div>",
          ");",
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'panelMuerto');
  });

  /* [318A-7V2] Templates largos (>240 chars) en declaraciones de variables:
   * el cap anterior truncaba el valor y perdía las clases del final. */
  test('declaraciones con template largo (>240 chars) resuelven por indirección', async () => {
    const contenidoLargo = [
      'const clasesContenedor = `',
      'dashboardContenedor ${esMovil && auth.user ? \'dashboardContenedor--conNavegacionInferior\' : \'\'} ', 
      '${tipoLayout === \'sidebar\' && !esMovil ? \'dashboardContenedor--sidebar\' : \'\'} ', 
      '${tipoLayout === \'vistas\' && !esMovil ? \'dashboardContenedor--vistas\' : \'\'}`;',
      'const vista = <div className={clasesContenedor} />;',
    ].join('\n');
    assert.ok(contenidoLargo.length > 240, 'fixture debe superar el cap anterior');
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.dashboardContenedor { color: red; }',
          '.dashboardContenedor--conNavegacionInferior { color: red; }',
          '.dashboardContenedor--sidebar { color: red; }',
          '.dashboardContenedor--vistas { color: red; }',
          '.dashboardContenedor--muerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: contenidoLargo,
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'dashboardContenedor--muerto');
  });

  /* [318A-7V17] Componentes con closure (React.forwardRef): el regex no-greedy
   * anterior cortaba en el primer ';' (el de la declaración INTERNA
   * `const clases = [...]`) y se tragaba el literal, dejando la familia
   * `boton--` como FP huérfana (Boton.tsx de PT, 20 hallazgos). El escaneo
   * balanceado debe indexar la familia del template dentro del closure. */
  test('indexa familias de clases declaradas dentro del closure de un forwardRef', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.boton { color: red; }',
          '.boton--primario { color: red; }',
          '.boton--secundario { color: red; }',
          /* Fuera de la familia (no comparte el prefijo `boton--`): sigue
           * siendo huérfana aunque la familia esté viva — la semántica V14
           * cubre solo clases con el prefijo. */
          '.botonIcono { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/ui/Boton.tsx': {
        languageId: 'typescriptreact',
        content: [
          "import React from 'react';",
          'const Boton = React.forwardRef<HTMLButtonElement, BotonProps>(({ variante = \'primario\', resto }, ref) => {',
          "  const clases = ['boton', `boton--${variante}`, resto?.claseExt].join(' ');",
          '  return <button ref={ref} className={clases} />;',
          '});',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'botonIcono');
    /* La familia boton-- se marca EN-USO completa (el sufijo se emite en
     * runtime); ningún miembro de la familia debe reportarse huérfano. */
    assert.equal(result.clasesHuerfanas.some(item => item.nombre.startsWith('boton--')), false);
  });

  /* [318A-7V17] El walker no debe descender a repos anidados (submódulos/worktrees:
   * su `.git` es un ARCHIVO, p. ej. glory-rs en los consumidores) ni a internals
   * de git (`.git/modules/...`). El código de otro repo se arregla en su propio
   * repo; analizarlo desde el consumidor duplica hallazgos (8 claseHuerfana de
   * glory-rs en PT). El `.git` directorio raíz también se salta. */
  test('walker excluye submódulos (.git archivo) y directorios .git', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'varsense-submodulo-'));
    try {
      const escribir = (relativa: string, contenido: string): void => {
        const completo = path.join(root, relativa);
        fs.mkdirSync(path.dirname(completo), { recursive: true });
        fs.writeFileSync(completo, contenido);
      };
      escribir('src/estilos.css', '.huerfanaRaiz { color: red; }');
      escribir('glory-rs/frontend/otro.css', '.huerfanaSubmodulo { color: blue; }');
      escribir('.git/modules/glory-rs/config', 'dummy');
      escribir('.git/modules/glory-rs/refs/heads/main', 'dummy');
      /* Marcador git de submódulo: .git es archivo (no directorio). */
      fs.writeFileSync(path.join(root, 'glory-rs', '.git'), 'gitdir: ../.git/modules/glory-rs\n');

      const provider = new NodeWorkspaceFileProvider(root);
      const archivos = await provider.findFiles(['**/*.css'], []);
      const rutas = archivos.map(archivo => path.relative(root, archivo.fsPath).replace(/\\/g, '/')).sort();

      assert.deepStrictEqual(rutas, ['src/estilos.css']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  /* [318A-7V21] Un consumidor puede tener el submódulo clonado COMPLETO
   * (glory-rs en AGAPE: `.git` es DIRECTORIO, no archivo). El filtro V17
   * solo cubría la forma archivo y los hallazgos del submódulo se atribuían
   * al consumidor (12 claseHuerfana de AGAPE vivían en glory-rs/tools).
   * Ambas formas de `.git` marcan un repo anidado y se excluyen. */
  test('walker excluye repos anidados con .git directorio (clon completo)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'varsense-repoanidado-'));
    try {
      const escribir = (relativa: string, contenido: string): void => {
        const completo = path.join(root, relativa);
        fs.mkdirSync(path.dirname(completo), { recursive: true });
        fs.writeFileSync(completo, contenido);
      };
      escribir('src/estilos.css', '.huerfanaRaiz { color: red; }');
      escribir('glory-rs/frontend/otro.css', '.huerfanaSubmodulo { color: blue; }');
      escribir('tools/varsense/core/x.css', '.huerfanaHerramienta { color: green; }');
      /* Clon completo: .git es directorio real (con internals). */
      escribir('glory-rs/.git/HEAD', 'ref: refs/heads/main\n');
      escribir('glory-rs/.git/config', '[core]\n\trepositoryformatversion = 0\n');
      escribir('tools/varsense/.git/HEAD', 'ref: refs/heads/main\n');

      const provider = new NodeWorkspaceFileProvider(root);
      const archivos = await provider.findFiles(['**/*.css'], []);
      const rutas = archivos.map(archivo => path.relative(root, archivo.fsPath).replace(/\\/g, '/')).sort();

      assert.deepStrictEqual(rutas, ['src/estilos.css']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('interpolacion de template con identificador resuelve por indirección', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.panelResize--derecha { color: red; }',
          '.panelResize--abajo { color: red; }',
          '.panelResize--arrastrando { color: red; }',
          '.panelResize--muerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: [
          "const claseTipo = tipo === 'derecha' ? 'panelResize--derecha' : 'panelResize--abajo';",
          'const vista = (',
          '  <div',
          '    className={`panelResize ${claseTipo} ${arrastrando ? \'panelResize--arrastrando\' : \'\'}`}',
          '  />',
          ');',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'panelResize--muerto');
  });

  /* [318A-7V3] Array de clases con ternarios, join() y className={ident}:
   * patrón real de VistaCelda.tsx en PT. */
  test('array de clases con join() y ternarios resuelve por indirección', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.panelCelda { color: red; }',
          '.panelCelda--eligiendo { color: red; }',
          '.panelCelda--origenMover { color: red; }',
          '.panelCelda--muerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: [
          'const clases = [',
          "  'panelCelda'",
          "  , estaEligiendo ? 'panelCelda--eligiendo' : ''",
          "  , estaOrigenMover ? 'panelCelda--origenMover' : ''",
          '].filter(Boolean).join(\' \');',
          'const vista = <div className={clases} />;',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'panelCelda--muerto');
  });

  /* [318A-7V3] Objetos que devuelven la prop portadora en forma de clave:
   * return { clase: 'badgePremium' } — el consumidor concatena el valor al
   * className. Patrón real: FilaUsuario/ResumenAdmin/EncabezadoEstado de PT. */
  test('clave objeto clase/*clase registra su valor como clase usada', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.badgePremium { color: gold; }',
          '.estadoActiva { color: green; }',
          '.tarjetaTotal { color: blue; }',
          '.badgeMuerto { color: gray; }',
        ].join('\n'),
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: [
          'const badgeUsuario = () => ({ clase: \'badgePremium\', texto: \'PREMIUM\' });',
          'const estadoUsuario = () => ({ clase: \'estadoActiva\', texto: \'Activa\' });',
          'const tarjetas = [{ clase: \'tarjetaTotal\', valor: 4 }];',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'badgeMuerto');
  });

  /* [318A-7V2] Ternario encadenado asignado a variable y consumido por prop
   * *clase: resolución por indirección + prop portadora. */
  test('ternario encadenado via claseAdicional={ident} resuelve por indirección', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.panelExpVida--alta { color: green; }',
          '.panelExpVida--media { color: orange; }',
          '.panelExpVida--baja { color: red; }',
          '.panelExpVida--muerta { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: [
          'const vidaClase = vida >= 60 ? \'panelExpVida--alta\' : vida >= 30 ? \'panelExpVida--media\' : \'panelExpVida--baja\';',
          'const vista = <Panel claseAdicional={vidaClase} />;',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'panelExpVida--muerta');
  });

  /* [318A-7V4] El core del CLI debe honrar los comentarios de supresion igual
   * que el provider (paridad de conteo entre el editor y el CLI). El codigo de
   * PT ya declara excepciones con `sentinel-disable inline-style-prohibido`
   * inline en la misma linea del style={{}} — el CLI no debe contarlas. */
  test('sentinel-disable inline suprime cssInlineReact en la misma linea', async () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/View.tsx',
      fileName: '/workspace/src/View.tsx',
      languageId: 'typescriptreact',
      content: [
        'const Vista = () => (',
        '  <div style={{ /* sentinel-disable inline-style-prohibido */ background: color }} />',
        ');',
      ].join('\n'),
    });
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}));
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}));

    assert.strictEqual(hallazgos.length, 0);
  });

  test('sentinel-disable suprime la linea siguiente (convencion CSS/reglas)', async () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/View.tsx',
      fileName: '/workspace/src/View.tsx',
      languageId: 'typescriptreact',
      content: [
        'const Vista = () => (',
        '  /* sentinel-disable inline-style-prohibido */',
        '  <div style={{ background: color }} />',
        ');',
      ].join('\n'),
    });
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}));
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}));

    assert.strictEqual(hallazgos.length, 0);
  });

  test('varsense-disable-line suprime la misma linea y next-line la siguiente', async () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/View.tsx',
      fileName: '/workspace/src/View.tsx',
      languageId: 'typescriptreact',
      content: [
        'const A = () => <div style={{ /* varsense-disable-line */ width: 10 }} />;',
        '/* varsense-disable-next-line */',
        'const B = () => <div style={{ width: 11 }} />;',
      ].join('\n'),
    });
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}));
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}));

    assert.strictEqual(hallazgos.length, 0);
  });

  test('bloque varsense-disable/varsense-enable suprime lineas internas', async () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/View.tsx',
      fileName: '/workspace/src/View.tsx',
      languageId: 'typescriptreact',
      content: [
        '/* varsense-disable */',
        'const A = () => <div style={{ width: 10 }} />;',
        '/* varsense-enable */',
        'const B = () => <div style={{ width: 11 }} />;',
      ].join('\n'),
    });
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}));
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}));

    assert.strictEqual(hallazgos.length, 1);
    assert.strictEqual(hallazgos[0].ruleId, 'cssInlineReact');
    assert.strictEqual(hallazgos[0].range.start.line, 3);
  });

  /* [318A-7V8] token-duplicate: un duplicado real repite el valor dentro del
   * MISMO archivo (mismo dominio semantico del design system). La
   * coincidencia de valor entre archivos distintos (p.ej. un offset runtime
   * de pull-to-refresh = '0' vs un radio de dashboard = '0') es una
   * coincidencia entre dominios independientes y NO debe reportarse.
   * Caso real de PT: --ptr-translateY (pullToRefresh.css) marcado como
   * duplicado de --dashboard-radioMinimo (variables.css). */
  test('token-duplicate no cruza archivos: coincidencia de valor entre dominios distintos', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/variables.css': {
        languageId: 'css',
        content: ':root { --dashboard-radioMinimo: 0; }',
      },
      '/workspace/src/pullToRefresh.css': {
        languageId: 'css',
        content: ':root { --ptr-translateY: 0; }',
      },
    });
    const builder = new VariableIndexBuilder(provider, provider);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const objetos = Array.from(result.variablesPorArchivo.entries()).map(([file, variables]) => ({
      file,
      document: createCoreDocument({ uri: `file://${file}`, fileName: file, languageId: 'css', content: '' }),
    }));
    const hallazgos = analyzeTokenRules(result.variablesPorArchivo, objetos, buildAnalysisConfig({}));
    const duplicados = hallazgos.filter(hallazgo => hallazgo.ruleId === 'token-duplicate');

    assert.strictEqual(duplicados.length, 0);
  });

  test('token-duplicate detecta duplicados reales dentro del mismo archivo', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/variables.css': {
        languageId: 'css',
        content: ':root { --dashboard-fondoPrincipal: #000000; --dashboard-fondoSecundario: #000000; }',
      },
    });
    const builder = new VariableIndexBuilder(provider, provider);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const objetos = Array.from(result.variablesPorArchivo.entries()).map(([file, variables]) => ({
      file,
      document: createCoreDocument({ uri: `file://${file}`, fileName: file, languageId: 'css', content: '' }),
    }));
    const hallazgos = analyzeTokenRules(result.variablesPorArchivo, objetos, buildAnalysisConfig({}));
    const duplicados = hallazgos.filter(hallazgo => hallazgo.ruleId === 'token-duplicate');

    assert.strictEqual(duplicados.length, 1);
    assert.ok(String(duplicados[0].message).includes('--dashboard-fondoSecundario'));
  });

  /* [229A-1] token-duplicate: el mismo valor en ambitos de cascada distintos
   * es shadowing intencional, no alias. Caso real coolify-manager-rs:
   * --vpsColorTexto12 = rgba(25,25,24,0.12) en .vpsPortal y en
   * html:has(.vpsPortal). */
  test('[229A-1] token-duplicate no colapsa shadowing entre ambitos distintos', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/portal.css': {
        languageId: 'css',
        content: [
          '.vpsPortal { --vpsColorTexto12: rgba(25, 25, 24, 0.12); }',
          'html:has(.vpsPortal) { --vpsColorTexto12: rgba(25, 25, 24, 0.12); }',
        ].join('\n'),
      },
    });
    const builder = new VariableIndexBuilder(provider, provider);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const objetos = Array.from(result.variablesPorArchivo.entries()).map(([file, variables]) => ({
      file,
      document: createCoreDocument({ uri: `file://${file}`, fileName: file, languageId: 'css', content: '' }),
    }));
    const hallazgos = analyzeTokenRules(result.variablesPorArchivo, objetos, buildAnalysisConfig({}));
    const duplicados = hallazgos.filter(hallazgo => hallazgo.ruleId === 'token-duplicate');

    assert.strictEqual(duplicados.length, 0);
  });

  /* [229A-1] token-duplicate: mismo valor y MISMO ambito sigue marcando
   * (el ambito no ciega duplicados reales intra-bloque). */
  test('[229A-1] token-duplicate marca mismo valor en el mismo ambito', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/variables.css': {
        languageId: 'css',
        content: ':root { --aliasUno: #ffffff; --aliasDos: #ffffff; }',
      },
    });
    const builder = new VariableIndexBuilder(provider, provider);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const objetos = Array.from(result.variablesPorArchivo.entries()).map(([file, variables]) => ({
      file,
      document: createCoreDocument({ uri: `file://${file}`, fileName: file, languageId: 'css', content: '' }),
    }));
    const hallazgos = analyzeTokenRules(result.variablesPorArchivo, objetos, buildAnalysisConfig({}));
    const duplicados = hallazgos.filter(hallazgo => hallazgo.ruleId === 'token-duplicate');

    assert.strictEqual(duplicados.length, 1);
    assert.ok(String(duplicados[0].message).includes('--aliasDos'));
  });

  /* [229A-1] token-duplicate: repetir el default neutro 0/0px entre tokens
   * de posicion no es alias evitable. Caso real coolify-manager-rs:
   * --menuPosTop/--menuPosLeft = 0px en ContextMenu.css. */
  test('[229A-1] token-duplicate exime defaults triviales 0 y 0px', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/menu.css': {
        languageId: 'css',
        content: '.menu { --menuPosTop: 0px; --menuPosLeft: 0px; --menuAncho: 0; --menuAlto: 0; }',
      },
    });
    const builder = new VariableIndexBuilder(provider, provider);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const objetos = Array.from(result.variablesPorArchivo.entries()).map(([file, variables]) => ({
      file,
      document: createCoreDocument({ uri: `file://${file}`, fileName: file, languageId: 'css', content: '' }),
    }));
    const hallazgos = analyzeTokenRules(result.variablesPorArchivo, objetos, buildAnalysisConfig({}));
    const duplicados = hallazgos.filter(hallazgo => hallazgo.ruleId === 'token-duplicate');

    assert.strictEqual(duplicados.length, 0);
  });

  /* [229A-1] cssInlineReact: style={{}} cuyas claves son TODAS custom
   * properties (--*) es definicion runtime de tokens (mismo patron eximido
   * que setProperty), no estilo inline. Caso real coolify-manager-rs:
   * MenuContextual.tsx style={{ "--menuPosTop": ..., "--menuPosLeft": ... }}.
   * El caso mixto (una prop real) sigue marcando. */
  test('[229A-1] cssInlineReact exime objeto style solo con custom properties', async () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/Menu.tsx',
      fileName: '/workspace/src/Menu.tsx',
      languageId: 'typescriptreact',
      content: [
        'const A = () => <div style={{ "--menuPosTop": `${top}px`, "--menuPosLeft": `${left}px` }} />;',
        'const B = () => <div style={{ "--soloToken": valor }} />;',
        'const C = () => <div style={{ "--token": valor, color: tema }} />;',
      ].join('\n'),
    });
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}));
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}));
    const inline = hallazgos.filter(hallazgo => hallazgo.ruleId === 'cssInlineReact');

    assert.strictEqual(inline.length, 1);
    assert.strictEqual(inline[0].range.start.line, 2);
  });

  /* [149A-1 F3.11] orphan-plantilla-resuelta: concatenacion con
   * identificador declarado ('botonPrimario' + variante) resuelve la clase
   * exacta antes de marcar; antes solo quedaba el token parcial y la clase
   * se reportaba huerfana (FP). */
  test('[149A-1] resuelve concatenacion con identificador declarado', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: '.botonPrimarioActivo { color: red; }\n.otraMuerta { color: blue; }',
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: [
          "const variante = 'Activo';",
          "const cls = 'botonPrimario' + variante;",
          'const Vista = () => <div className={cls} />;',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'otraMuerta');
  });

  /* [149A-1 F3.11] Concatenacion directa en JSX: className={'ico-' + nombre}. */
  test('[149A-1] resuelve concatenacion directa en expresion JSX', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: '.icoLupa { color: red; }\n.icoMuerto { color: blue; }',
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: [
          "const nombre = 'Lupa';",
          "const Vista = () => <div className={'ico' + nombre} />;",
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'icoMuerto');
  });

  /* [149A-1 F3.11] Ternario compuesto: ambas ramas resuelven exacto
   * (cond ? 'panel-' + modo : 'panelBase'). */
  test('[149A-1] resuelve ternario compuesto con concatenacion en rama', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: '.panelCompacto { color: red; }\n.panelBase { color: red; }\n.panelMuerto { color: blue; }',
      },
      '/workspace/src/view.ts': {
        languageId: 'typescript',
        content: [
          "const modo = 'Compacto';",
          "const t = modo === 'X' ? 'panel' + modo : 'panelBase';",
          'el.classList.add(t);',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'panelMuerto');
  });

  /* [149A-1 F3.11] Fail-closed: identificador desconocido o llamada no
   * resuelven y el comportamiento previo se conserva (huerfana real sigue
   * reportada, sin crash). */
  test('[149A-1] no resuelve identificadores desconocidos ni llamadas', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: '.yReal { color: red; }\n.zReal { color: blue; }',
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: [
          'const Vista = () => <div className={\'y-\' + desconocido} />;',
          'otro.classList.add(\'z-\' + helper(\'x\'));',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 2);
  });

  /* [149A-1 F3.11] Template con var const en atributo sigue en uso y la
   * expansion exacta no introduce reportes nuevos. */
  test('[149A-1] template con variable const resuelve exacto sin reportes nuevos', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: '.prefOk { color: red; }\n.prefMuerta { color: blue; }',
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: [
          "const v = 'Ok';",
          'const Vista = () => <span className={`pref${v}`} />;',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'prefOk'), false);
  });

  /* [149A-1 F3.12] hardcodedDetection mantiene warning por defecto (089A-3):
   * la opcion solo cambia la severidad cuando el proyecto la fija. */
  test('[149A-1] hardcodedDetection mantiene warning por defecto', () => {
    const config = buildAnalysisConfig({});

    assert.strictEqual(config.hardcoded.severidad, 'warning');
  });

  /* [149A-1 F3.12] hardcodedDetection.severity error llega al core (solo UI:
   * el provider VS Code ya la aplica via SEVERITY_MAP; aqui se verifica el
   * camino core -> finding). */
  test('[149A-1] hardcodedDetection.severity error se propaga al finding', async () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/styles.css',
      fileName: '/workspace/src/styles.css',
      languageId: 'css',
      content: '.boton { color: #ff0000; }',
    });
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}));
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const porDefecto = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}));
    const enError = analyzeVarsenseDocument(
      documento, indice, buildAnalysisConfig({ hardcodedDetection: { severity: 'error' } })
    );
    const hardcodedDefecto = porDefecto.filter(hallazgo => hallazgo.ruleId === 'valorHardcoded');
    const hardcodedError = enError.filter(hallazgo => hallazgo.ruleId === 'valorHardcoded');

    assert.strictEqual(hardcodedDefecto.length, 1);
    assert.strictEqual(hardcodedDefecto[0].severity, 'warning');
    assert.strictEqual(hardcodedError.length, 1);
    assert.strictEqual(hardcodedError[0].severity, 'error');
  });

  /* [149A-1] Testigo de no-regresion: inline-styles-react ya existe como
   * cssInlineReact (style={{}} + style={ident}); F3.13 real es
   * todo-prosa-sin-marcador (tests siguientes). */
  test('[149A-1] cssInlineReact cubre style={{}} y style={ident} sin duplicar', async () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/View.tsx',
      fileName: '/workspace/src/View.tsx',
      languageId: 'typescriptreact',
      content: [
        'const estilos = { color: tema };',
        'const A = () => <div style={{ color: tema }} />;',
        'const B = () => <div style={estilos} />;',
      ].join('\n'),
    });
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}));
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}));

    assert.strictEqual(hallazgos.length, 2);
    assert.ok(hallazgos.every(hallazgo => hallazgo.ruleId === 'cssInlineReact'));
  });

  /* [289A-1] todo-prosa-sin-marcador RETIRADA a Sentinel Core (0.7.15):
   * VarSense ya no la reporta; `todoProseDetection` se acepta pero se ignora
   * (compat con `varsense.config.json` existentes). Casos que antes marcaban
   * ahora dan 0 hallazgos en VarSense (los cubre Sentinel). */
  test('[289A-1] todoProseDetection aceptada pero ignorada: ex-menciones no marcan', async () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/util.ts',
      fileName: '/workspace/src/util.ts',
      languageId: 'typescript',
      content: [
        '// todo refactor pendiente',
        '// TODO pendiente sin dos puntos',
        '// TODO',
        'export const x = 1;',
      ].join('\n'),
    });
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}));
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const porDefecto = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}));
    const explicita = analyzeVarsenseDocument(
      documento, indice, buildAnalysisConfig({ todoProseDetection: { enabled: false } })
    );

    assert.strictEqual(porDefecto.length, 0);
    assert.strictEqual(explicita.length, 0);
    assert.ok(!porDefecto.some(hallazgo => hallazgo.ruleId === 'todoProsaSinMarcador'));
  });

  /* [149A-1 F3.15] duplicado-cross-crate: mismo valor en archivos distintos
   * con nombres similares marca info con ambas rutas y similitud. */
  test('[149A-1] cross-file con nombres similares marca info con rutas', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/a.css': {
        languageId: 'css',
        content: ':root { --color-borde: #e5e5e5; }',
      },
      '/workspace/src/b.css': {
        languageId: 'css',
        content: ':root { --color-bordes: #e5e5e5; }',
      },
    });
    const builder = new VariableIndexBuilder(provider, provider);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const hallazgos = analyzeCrossFileDuplicates(result.variablesPorArchivo, buildAnalysisConfig({}));

    assert.strictEqual(hallazgos.length, 1);
    assert.strictEqual(hallazgos[0].ruleId, 'token-duplicado-cross-archivo');
    assert.strictEqual(hallazgos[0].severity, 'information');
    assert.ok(String(hallazgos[0].message).includes('--color-bordes'));
    assert.ok(String(hallazgos[0].message).includes('/workspace/src/a.css'));
    assert.ok(String(hallazgos[0].message).includes('/workspace/src/b.css'));
  });

  /* [149A-1 F3.15] 0 FP: el caso de auditoria 318A-7V8 (mismo valor '0' en
   * dominios independientes) no marca por nombres disimiles. */
  test('[149A-1] cross-file no marca coincidencia de valor con nombres disimiles', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/pullToRefresh.css': {
        languageId: 'css',
        content: ':root { --ptr-translateY: 0; }',
      },
      '/workspace/src/dashboard.css': {
        languageId: 'css',
        content: ':root { --dashboard-radioMinimo: 0; }',
      },
    });
    const builder = new VariableIndexBuilder(provider, provider);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const hallazgos = analyzeCrossFileDuplicates(result.variablesPorArchivo, buildAnalysisConfig({}));

    assert.strictEqual(hallazgos.length, 0);
  });

  /* [149A-1 F3.15] 0 FP: mismo nombre y valor en varios archivos es override
   * de cascada, no duplicado. */
  test('[149A-1] cross-file no marca mismo nombre con mismo valor (override)', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/base.css': {
        languageId: 'css',
        content: ':root { --color-fondo: #fff; }',
      },
      '/workspace/src/tema.css': {
        languageId: 'css',
        content: ':root { --color-fondo: #fff; }',
      },
    });
    const builder = new VariableIndexBuilder(provider, provider);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const hallazgos = analyzeCrossFileDuplicates(result.variablesPorArchivo, buildAnalysisConfig({}));

    assert.strictEqual(hallazgos.length, 0);
  });

  /* [149A-1 F3.15] tokenDetection.crossFile.enabled=false desactiva la regla
   * y la severidad es configurable (escalera info→warning). */
  test('[149A-1] cross-file desactivable y con severidad configurable', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/a.css': {
        languageId: 'css',
        content: ':root { --color-borde: #e5e5e5; }',
      },
      '/workspace/src/b.css': {
        languageId: 'css',
        content: ':root { --color-bordes: #e5e5e5; }',
      },
    });
    const builder = new VariableIndexBuilder(provider, provider);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const apagado = analyzeCrossFileDuplicates(
      result.variablesPorArchivo, buildAnalysisConfig({ tokenDetection: { crossFile: { enabled: false } } })
    );
    const enWarning = analyzeCrossFileDuplicates(
      result.variablesPorArchivo, buildAnalysisConfig({ tokenDetection: { crossFile: { severity: 'warning' } } })
    );

    assert.strictEqual(apagado.length, 0);
    assert.strictEqual(enWarning.length, 1);
    assert.strictEqual(enWarning[0].severity, 'warning');
  });

  /* [318A-7V20] RC-1: asignaciones compuestas sobre un carrier de clase
   * (`clase += ' selectorFechaCalendario__dia--hoy'`, SelectorFechaCalendario
   * .tsx:75-76). escanearDeclaraciones solo lee `x =`; los literales añadidos
   * con `+=` jamás llegaban al índice y sus selectores se reportaban
   * huérfanos pese al uso real en className={clase}. */
  test('compound assignment on a class carrier appends its literals to the index', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.selectorFechaCalendario__dia { color: red; }',
          '.selectorFechaCalendario__dia--hoy { color: gold; }',
          '.selectorFechaCalendario__dia--otroMes { color: gray; }',
          '.selectorFechaCalendario__dia--muerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: [
          'export function Vista({ celdas }: any) {',
          '  return celdas.map((celda: any) => {',
          '    const esHoy = celda.fecha === hoy;',
          "    let clase = 'selectorFechaCalendario__dia';",
          "    if (celda.esOtroMes) clase += ' selectorFechaCalendario__dia--otroMes';",
          "    if (esHoy) clase += ' selectorFechaCalendario__dia--hoy';",
          '    return <Boton claseAdicional={clase}>{celda.dia}</Boton>;',
          '  });',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'selectorFechaCalendario__dia--muerto');
  });

  /* [318A-7V20] RC-2: carriers nombrados *clase declarados en un archivo cuyo
   * valor consume otro archivo (hook → componente): usePullToRefresh.ts:110
   * declara `const clasesContenedor = ...`.trim() y el className vive en
   * PullToRefresh.tsx. Sin la expansión de carriers el archivo del hook jamás
   * emitía sus tokens; ahora toda declaración *clase emite al índice. */
  test('clase*-named carrier declarations emit tokens even when consumed cross-file', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.pullToRefresh { color: red; }',
          '.pullToRefresh--refrescando { color: red; }',
          '.pullToRefresh--arrastrando { color: red; }',
          '.pullToRefreshMuerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/usePullToRefresh.ts': {
        languageId: 'typescript',
        content: [
          'export function usePullToRefresh() {',
          '  const refrescando = true;',
          '  const arrastre = 0;',
          '  const clasesContenedor = `pullToRefresh ${refrescando ? \'pullToRefresh--refrescando\' : \'\'} ${arrastre > 0 ? \'pullToRefresh--arrastrando\' : \'\'}`.trim();',
          '  return { clasesContenedor };',
          '}',
        ].join('\n'),
      },
      '/workspace/src/PullToRefresh.tsx': {
        languageId: 'typescriptreact',
        content: [
          "import { usePullToRefresh } from './usePullToRefresh';",
          'export function PullToRefresh() {',
          '  const { clasesContenedor } = usePullToRefresh();',
          '  return <div className={clasesContenedor} />;',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'pullToRefreshMuerto');
  });

  /* [318A-7V20] RC-3 (arrow con anotación de retorno): mapper del MISMO
   * archivo llamado dentro de un atributo de clase
   * (`claseAdicional={obtenerClase()}`, IndicadorPlan.tsx:54 con
   * `const obtenerClase = (): string => {` en :23). Sus literales de return
   * son las clases reales que el runtime aplica; sin la resolución se
   * reportaban huérfanas indicadorPlan--trial/premium/free. */
  test('same-file arrow mapper with return type resolves its class literals', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.indicadorPlan { color: red; }',
          '.indicadorPlan--trial { color: red; }',
          '.indicadorPlan--premium { color: red; }',
          '.indicadorPlan--free { color: red; }',
          '.indicadorPlanMuerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/IndicadorPlan.tsx': {
        languageId: 'typescriptreact',
        content: [
          'export function IndicadorPlan({ suscripcion }: any) {',
          '  const { plan, estado } = suscripcion;',
          '  const obtenerClase = (): string => {',
          "    if (plan === 'premium') {",
          "      if (estado === 'trial') {",
          "        return 'indicadorPlan indicadorPlan--trial';",
          '      }',
          "      return 'indicadorPlan indicadorPlan--premium';",
          '    }',
          "    return 'indicadorPlan indicadorPlan--free';",
          '  };',
          '  return <Boton claseAdicional={obtenerClase()}>plan</Boton>;',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'indicadorPlanMuerto');
  });

  /* [318A-7V20] RC-3 (function declarada con anotación de retorno): mapper
   * llamado dentro de un template de clase
   * (className={`etiquetaPrioridad ${obtenerClasePrioridad(p)}`},
   * ListaProyectos.tsx:163 con `function obtenerClasePrioridad(prioridad:
   * string): string` en :24). El switch de returns alimenta el índice. */
  test('same-file function mapper inside a class template resolves its return literals', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.etiquetaPrioridad { color: red; }',
          '.etiquetaMuyAlta { color: red; }',
          '.etiquetaAlta { color: red; }',
          '.etiquetaMedia { color: red; }',
          '.etiquetaBaja { color: red; }',
          '.etiquetaMuerta { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/ListaProyectos.tsx': {
        languageId: 'typescriptreact',
        content: [
          'function obtenerClasePrioridad(prioridad: string): string {',
          '  switch (prioridad) {',
          "    case 'muy_alta': return 'etiquetaMuyAlta';",
          "    case 'alta': return 'etiquetaAlta';",
          "    case 'media': return 'etiquetaMedia';",
          "    case 'baja': return 'etiquetaBaja';",
          "    default: return 'etiquetaMedia';",
          '  }',
          '}',
          'export function Lista({ proyectos }: any) {',
          '  return proyectos.map((p: any) => (',
          '    <span className={`etiquetaPrioridad ${obtenerClasePrioridad(p.prioridad)}`}>x</span>',
          '  ));',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'etiquetaMuerta');
  });

  /* [318A-7V21] RC-url: el nombre de archivo dentro de `url(...)` no es un
   * selector. `url('/logo-agape.png')` casaba con regexClase y producía la
   * clase fantasma 'png' (AgapeLanding.css:43-44 en AGAPE): el `.png` del
   * nombre se reportaba huérfana pese a ser solo un asset de imagen. */
  test('url() assets no generan clases fantasma desde el nombre de archivo', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          ".fotoPrincipal { background-image: url('/logo-agape.png'); color: red; }",
          ".fotoSecundaria { background: url(\"img/x.png\") no-repeat center; color: blue; }",
          '.tarjetaViva { color: green; }',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });
    const nombres = result.clasesHuerfanas.map(clase => clase.nombre);

    assert.ok(!nombres.includes('png'), 'png no debe existir como clase');
    assert.ok(nombres.includes('fotoPrincipal'));
    assert.ok(nombres.includes('fotoSecundaria'));
    assert.ok(nombres.includes('tarjetaViva'));
  });

  /* [318A-7V21] RC-clave: la regla de props *clase en objetos solo casaba
   * claves clase/clase-prefijo; un carrier camelCase terminado en Class
   * (imageClass) quedaba fuera y sus literales se reportaban huérfanos pese
   * a interpolarse en className (AGAPE AgapeLanding.tsx:20/27/34 + :125).
   * Las claves finales en Class son carriers por convención de nombre;
   * classification/classList no casan (no terminan en Class). */
  test('object keys ending in Class are class carriers (imageClass)', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.activity-image { color: red; }',
          '.activity-image-community { color: red; }',
          '.activity-image-support { color: red; }',
          '.activity-image-allies { color: red; }',
          '.activity-image-muerta { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/vista.tsx': {
        languageId: 'typescriptreact',
        content: [
          'const actividades = [',
          "  { imageClass: 'activity-image-community' },",
          "  { imageClass: 'activity-image-support' },",
          "  { imageClass: 'activity-image-allies' },",
          '];',
          'export function Lista() {',
          '  return actividades.map(a => (',
          '    <div className={`activity-image ${a.imageClass}`}>x</div>',
          '  ));',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'activity-image-muerta');
  });

  /* [318A-7V21] RC-4: `clases.push('...')` sobre un array portador + consumo
   * por propiedad objeto `className: clases.join(' ')` (WANDORIUS
   * notifications-popover.ts:80-83). El literal del push jamás llegaba al
   * índice y la vía objeto con VARIABLE no resolvía indirección; ambos
   * quedaban huérfanos pese al uso real. */
  test('array push on a class carrier + object className variable resolve both paths', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.notificacionesPopover__item { color: red; }',
          '.notificacionesPopover__item--leida { color: gray; }',
          '.notificacionesPopover__item--noLeida { color: gold; }',
          '.notificacionesPopover__item--muerta { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/popover.ts': {
        languageId: 'typescript',
        content: [
          "import { createEl } from './dom';",
          'export function renderItem(item: any) {',
          "  const clases = ['notificacionesPopover__item'];",
          "  if (item.read) clases.push('notificacionesPopover__item--leida');",
          "  else clases.push('notificacionesPopover__item--noLeida');",
          '  return createEl(\'div\', { className: clases.join(\' \') }, item.title);',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'notificacionesPopover__item--muerta');
  });

  /* [318A-7V22][M4] Construcción de HTML en runtime: template que ensambla
   * markup con atributos `class="..."` literales (useScratchpad.ts:82/94 de
   * PT: `html += \`<h${n} class="scratchpadVistaPreviaTitulo
   * scratchpadVistaPreviaTitulo--h${n}">...\`` y `<li><span
   * class="scratchpadVistaPreviaChecklist">`). El literal de clase dentro de
   * un template HTML ES una cadena de clases por construcción; una clase
   * realmente muerta sigue reportada. */
  test('runtime HTML construction registers class attributes as used', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.scratchpadVistaPreviaTitulo { color: red; }',
          '.scratchpadVistaPreviaTitulo--h1 { color: red; }',
          '.scratchpadVistaPreviaTitulo--h4 { color: red; }',
          '.scratchpadVistaPreviaChecklist { color: red; }',
          '.scratchpadVistaPreviaMuerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/useScratchpad.ts': {
        languageId: 'typescript',
        content: [
          'export function renderizar(texto: string) {',
          '  let html = \'\';',
          '  const m = /^(#{1,6})\\s+(.*)/.exec(texto);',
          '  if (m) {',
          '    const nivel = m[1].length;',
          '    html += `<h${nivel} class="scratchpadVistaPreviaTitulo scratchpadVistaPreviaTitulo--h${nivel}">${m[2]}</h${nivel}>`;',
          '  } else {',
          '    html += `<li><span class="scratchpadVistaPreviaChecklist">${marcado}</span> x</li>`;',
          '  }',
          '  return html;',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    /* `scratchpadVistaPreviaTitulo` (segmento estático), la familia
     * `--h` (h1/h4) y `scratchpadVistaPreviaChecklist` en uso; la muerta
     * real se reporta. */
    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'scratchpadVistaPreviaMuerto');
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'scratchpadVistaPreviaTitulo'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre.startsWith('scratchpadVistaPreviaTitulo--h')), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'scratchpadVistaPreviaChecklist'), false);
  });

  /* [318A-7V22][M1] Mapa/objeto literal Record<Tipo, string> cuyos valores son
   * clases, indexado por subíndice dentro de un atributo de clase
   * (PanelRecordatorios.tsx:19-21/91: `CLASES_FUENTE: Record<..., string> = {
   * pequeno: 'recordatoriosTexto--pequeno', normal: '', grande:
   * 'recordatoriosTexto--grande' }` usado como
   * `className={\`recordatoriosTexto ${CLASES_FUENTE[config.tamanoFuente]}\`}`).
   * Los valores del Record son todos alcanzables en runtime por la clave
   * tipada; una clase realmente muerta sigue reportada. */
  test('record map values indexed by subscript in a class attribute are used', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.recordatoriosTexto { color: red; }',
          '.recordatoriosTexto--pequeno { color: red; }',
          '.recordatoriosTexto--grande { color: red; }',
          '.recordatoriosTextoMuerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/PanelRecordatorios.tsx': {
        languageId: 'typescriptreact',
        content: [
          "type TamanoFuenteRecordatorio = 'pequeno' | 'normal' | 'grande';",
          'const CLASES_FUENTE: Record<TamanoFuenteRecordatorio, string> = {',
          "  pequeno: 'recordatoriosTexto--pequeno',",
          "  normal: '',",
          "  grande: 'recordatoriosTexto--grande'",
          '};',
          'export function Panel({ config }: any) {',
          '  return (',
          '    <div className={`recordatoriosTexto ${CLASES_FUENTE[config.tamanoFuente]}`}>x</div>',
          '  );',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'recordatoriosTextoMuerto');
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'recordatoriosTexto--pequeno'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'recordatoriosTexto--grande'), false);
  });

  /* [318A-7V22][M2] Template ternario que interpola una variable local ya
   * declarada con valor de clase (ItemNotificacion.tsx:77): `const claseBase =
   * 'itemNotificacion'; const claseLeida = notificacion.leida ? \`${claseBase}
   * --leida\` : '';` consumido en un className. La clase compuesta
   * `itemNotificacion--leida` es real en runtime y no debe reportarse;
   * una clase realmente muerta sí. */
  test('template interpolating a local class variable in a declaration is composed', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.itemNotificacion { color: red; }',
          '.itemNotificacion--leida { color: gray; }',
          '.itemNotificacion--muerta { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/ItemNotificacion.tsx': {
        languageId: 'typescriptreact',
        content: [
          'export function Item({ notificacion }: any) {',
          "  const claseBase = 'itemNotificacion';",
          "  const claseLeida = notificacion.leida ? `${claseBase}--leida` : '';",
          '  return (',
          '    <div className={`${claseBase} ${claseLeida}`}>x</div>',
          '  );',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'itemNotificacion--muerta');
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'itemNotificacion--leida'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'itemNotificacion'), false);
  });

  /* [318A-7V22][M3] Flecha auto-invocada (IIFE) con returns literales
   * asignada a una variable portadora que luego se interpola en un className
   * (FilaSubHabito.tsx:51-55/187): los sufijos
   * `barraRellenoCompletado/UrgenteCritico/Urgente/Advertencia` son clases
   * reales del runtime y no deben reportarse; una clase realmente muerta sí.
   * Una flecha componente NO auto-invocada NO debe resolver sus returns JSX
   * (guard anti-FN del helper). */
  test('iife arrow returns of class literals assigned to a carrier variable are used', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.barraRellenoNueva { color: red; }',
          '.barraRellenoCompletado { color: green; }',
          '.barraRellenoUrgenteCritico { color: orange; }',
          '.barraRellenoUrgente { color: yellow; }',
          '.barraRellenoAdvertencia { color: pink; }',
          '.barraRellenoMuerta { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/FilaSubHabito.tsx': {
        languageId: 'typescriptreact',
        content: [
          'export function Fila({ completadoHoy, porcentajeUrgencia, esUrgente }: any) {',
          '  const claseUrgencia = (() => {',
          "    if (completadoHoy) return 'barraRellenoCompletado';",
          "    if (porcentajeUrgencia >= 80) return 'barraRellenoUrgenteCritico';",
          "    if (esUrgente) return 'barraRellenoUrgente';",
          "    if (porcentajeUrgencia >= 40) return 'barraRellenoAdvertencia';",
          "    return '';",
          '  })();',
          '  return (',
          '    <div className={`barraRellenoNueva ${claseUrgencia}`}>x</div>',
          '  );',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'barraRellenoMuerta');
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'barraRellenoCompletado'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'barraRellenoUrgenteCritico'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'barraRellenoUrgente'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'barraRellenoAdvertencia'), false);
  });

  /* [318A-7V22][M5] Un regex literal con comillas o backticks
   * (`/[&<>"]/g`, `/`([^`]+)`/g`) NO debe corromper el estado de strings:
   * removeComments sin estado regex trataba la comilla interna como apertura
   * y todo el texto posterior quedaba "dentro de string", haciendo que los
   * `html +=` con clases reales se saltaran por isCodeMatch
   * (useScratchpad.ts:28/41 en PT, scratchpadVistaPrevia* seguían huérfanas).
   * Aquí el archivo tiene helpers con regex de comillas ANTES de la
   * construcción HTML; la clase runtime debe resolverse igual. */
  test('regex literals containing quotes do not corrupt string state (html += after)', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: [
          '.scratchpadVistaPreviaTitulo { color: red; }',
          '.scratchpadVistaPreviaTitulo--h4 { color: green; }',
          '.scratchpadVistaPreviaTitulo--h5 { color: blue; }',
          '.scratchpadVistaPreviaChecklist { color: orange; }',
          '.scratchpadVistaPreviaMuerto { color: purple; }',
        ].join('\n'),
      },
      '/workspace/src/renderizar.ts': {
        languageId: 'typescript',
        content: [
          'const escaparHtml = (s: string) => s.replace(/[&<>"]/g, (c: string) => c);',
          "const formatear = (s: string) => s.replace(/`([^`]+)`/g, '<code>$1</code>');",
          'const renderizar = (texto: string): string => {',
          '  const lineas = texto.split(\'\\n\');',
          '  let html = \'\';',
          '  lineas.forEach((linea) => {',
          '    const m = /^(#{1,6})\\s+(.*)/.exec(linea);',
          '    if (m) {',
          '      const nivel = m[1].length;',
          '      const contenido = formatear(escaparHtml(m[2] || \'\'));',
          '      html += `<h${nivel} class="scratchpadVistaPreviaTitulo scratchpadVistaPreviaTitulo--h${nivel}">${contenido}</h${nivel}>`;',
          '      return;',
          '    }',
          '    const c = /^-\\s\\[( |x|X)\\]\\s+(.*)/.exec(linea);',
          '    if (c) {',
          '      const marcado = c[1].toLowerCase() === \'x\' ? \'[x]\' : \'[ ]\';',
          '      const contenido = formatear(escaparHtml(c[2] || \'\'));',
          '      html += `<li><span class="scratchpadVistaPreviaChecklist">${marcado}</span> ${contenido}</li>`;',
          '    }',
          '  });',
          '  return html;',
          '};',
          'export default renderizar;',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'scratchpadVistaPreviaMuerto');
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'scratchpadVistaPreviaTitulo'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'scratchpadVistaPreviaTitulo--h4'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'scratchpadVistaPreviaTitulo--h5'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'scratchpadVistaPreviaChecklist'), false);
  });

  /* [318A-7V23][T1] Factoría el(tag, cls): el 2º argumento string cuenta
   * como uso aunque el archivo NUNCA mencione el nombre suelto: literal,
   * ternario, template con lookup de mapa y llamada multilínea tras return. */
  test('el factory second argument counts as usage (literal, ternary, map, multiline)', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: [
          '.elEtiquetaViva { color: red; }',
          '.elTernVivaA { color: green; }',
          '.elTernVivaB { color: blue; }',
          '.elMapaVivaX { color: orange; }',
          '.elMultViva { color: teal; }',
          '.elMuerta { color: purple; }',
        ].join('\n'),
      },
      '/workspace/src/fabrica.ts': {
        languageId: 'typescript',
        content: [
          'declare function el(tag: string, cls?: string): unknown;',
          'const MAPA: Record<string, string> = { a: \'elMapaVivaX\' };',
          'declare const cond: boolean;',
          'declare const clave: string;',
          'el(\'div\', \'elEtiquetaViva\');',
          'el(\'span\', cond ? \'elTernVivaA\' : \'elTernVivaB\');',
          'el(\'li\', `item ${MAPA[clave]}`);',
          'function construir(): unknown {',
          '  return el(\'div\',',
          '    \'elMultViva\');',
          '}',
          'export { construir };',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'elMuerta');
  });

  /* [318A-7V23][T2] HTML construido en return/push con class="...": el
   * escaneo de returns y push cubre templates estáticos; la clase sin
   * retorno ni push se sigue reportando. */
  test('class attributes in return and push templates count as usage', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: [
          '.retVivaA { color: red; }',
          '.retVivaB { color: green; }',
          '.retPushViva { color: blue; }',
          '.retMuerta { color: purple; }',
        ].join('\n'),
      },
      '/workspace/src/vista.ts': {
        languageId: 'typescript',
        content: [
          'declare const w: string;',
          'function render(): string {',
          '  if (w) {',
          '    return `<span class="retVivaA">x</span>`;',
          '  }',
          '  return `<div class="retVivaB">y</div>`;',
          '}',
          'const partes: string[] = [];',
          'partes.push(`<b class="retPushViva">z</b>`);',
          'export { render, partes };',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'retMuerta');
  });

  /* [318A-7V23][T3] Carriers mismo-archivo: el parámetro que llega al 2º
   * arg de el() propaga el literal del call-site, incluido el reenvío
   * de un helper a otro (envolver → crear). */
  test('same-file parameter carriers propagate call-site literals (incl. forward)', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: [
          '.carDirecta { color: red; }',
          '.carReenvio { color: green; }',
          '.carMuerta { color: purple; }',
        ].join('\n'),
      },
      '/workspace/src/ayudas.ts': {
        languageId: 'typescript',
        content: [
          'declare function el(tag: string, cls?: string): unknown;',
          'function crear(color: string, clase: string): unknown {',
          '  return el(\'span\', clase);',
          '}',
          'crear(\'red\', \'carDirecta\');',
          'function envolver(extra: string): unknown {',
          '  return crear(\'blue\', extra);',
          '}',
          'envolver(\'carReenvio\');',
          'export { crear, envolver };',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'carMuerta');
  });

  /* [318A-7V23][T4] setAttribute('class', ...) directo: el 2º argumento
   * cuenta como uso (literal y ternario). */
  test('setAttribute class second argument counts as usage', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: [
          '.attrVivaA { color: red; }',
          '.attrVivaB { color: green; }',
          '.attrVivaC { color: blue; }',
          '.attrMuerta { color: purple; }',
        ].join('\n'),
      },
      '/workspace/src/nodo.ts': {
        languageId: 'typescript',
        content: [
          'declare const nodo: { setAttribute(n: string, v: string): void };',
          'declare const cond: boolean;',
          'nodo.setAttribute(\'class\', \'attrVivaA\');',
          'nodo.setAttribute(\'class\', cond ? \'attrVivaB\' : \'attrVivaC\');',
          'export { nodo };',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'attrMuerta');
  });

  /* [318A-7V23][T5] classList.contains/chequeos: contains también indexa
   * su argumento (antes solo add/toggle/remove). */
  test('classList.contains argument counts as usage', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: [
          '.lstViva { color: red; }',
          '.lstMuerta { color: purple; }',
        ].join('\n'),
      },
      '/workspace/src/lista.ts': {
        languageId: 'typescript',
        content: [
          'declare const d: { classList: { contains(c: string): boolean } };',
          'export function tiene(): boolean {',
          '  return d.classList.contains(\'lstViva\');',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'lstMuerta');
  });

  /* [318A-7V24][T8] setProperty con literal '--x' define la variable en
   * runtime (GH: panelDerechoAncho.ts, barraLateral.ts...). Comilla simple
   * y doble valen; nombre dinámico se ignora. */
  test('parsearDefinicionesRuntime indexa setProperty con nombre literal', () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/panel.ts',
      fileName: '/workspace/src/panel.ts',
      languageId: 'typescript',
      content: [
        'el.style.setProperty(\'--alto-runtime\', px);',
        'otro.style.setProperty("--ancho-runtime", "10px");',
        'tercero.style.setProperty(`--fondo-runtime`, c);',
        'cuarto.style.setProperty(prefijo + sufijo, v);',
        'quinto.setPropiedad(\'--no-es-setproperty\', v);',
      ].join('\n'),
    });

    const definidas = parsearDefinicionesRuntime(documento).map(variable => variable.nombre);

    assert.deepStrictEqual(definidas, ['--alto-runtime', '--ancho-runtime', '--fondo-runtime']);
  });

  /* [318A-7V24][T9] El builder agrega definiciones runtime al índice: un
   * var(--x) cuyo único origen es setProperty no es variableNoDefinida. */
  test('agregarDefinicionesRuntime elimina variableNoDefinida de origen setProperty', async () => {
    const archivos = {
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: '.panel { height: var(--alto-runtime); }',
      },
      '/workspace/src/panel.ts': {
        languageId: 'typescript',
        content: 'export function ajustar(px: string): void { document.body.style.setProperty(\'--alto-runtime\', px); }',
      },
    };
    const provider = new MemoryWorkspaceProvider(archivos);
    const builder = new VariableIndexBuilder(provider, provider);
    const construido = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    await builder.agregarDefinicionesRuntime(
      [{ uri: 'file:///workspace/src/panel.ts', fsPath: '/workspace/src/panel.ts' }],
      construido.indice.variables,
      construido.variablesPorArchivo
    );

    assert.strictEqual(construido.indice.variables.has('--alto-runtime'), true);
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/estilos.css',
      fileName: '/workspace/src/estilos.css',
      languageId: 'css',
      content: archivos['/workspace/src/estilos.css'].content,
    });
    const hallazgos = analyzeVarsenseDocument(documento, construido.indice, buildAnalysisConfig({}));

    assert.deepStrictEqual(hallazgos.filter(hallazgo => hallazgo.ruleId === 'variableNoDefinida'), []);
  });

  /* [318A-7V24][T6] Carrier cross-file vía setAttribute (patrón icono de GH:
   * definido en iconos.ts, llamado desde otro módulo). Regresión del divisor
   * que partía desde la ',' y nunca detectaba el sink. */
  test('cross-file carrier via setAttribute marks call-site literal as used', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: [
          '.iconoExtra { color: red; }',
          '.iconoMuerta { color: purple; }',
        ].join('\n'),
      },
      '/workspace/src/iconos.ts': {
        languageId: 'typescript',
        content: [
          'export function icono(nombre: string, pequeno = false, extraClase = \'\'): string {',
          '  const svg = document.createElementNS(\'svg\', \'svg\');',
          '  svg.setAttribute(\'class\', \'ic\' + (extraClase ? \' \' + extraClase : \'\'));',
          '  return svg.outerHTML;',
          '}',
        ].join('\n'),
      },
      '/workspace/src/uso.ts': {
        languageId: 'typescript',
        content: 'import { icono } from \'./iconos\';\nexport const html = icono(\'flujo\', true, \'iconoExtra\');',
      },
    });

    const fuente = [
      'export function icono(nombre: string, pequeno = false, extraClase = \'\'): string {',
      '  svg.setAttribute(\'class\', \'ic\' + extraClase);',
      '}',
    ].join('\n');
    assert.deepStrictEqual(
      [...detectarCarriersMismoArchivo(fuente)].map(([fn, poss]) => [fn, [...poss]]),
      [['icono', [2]]]
    );

    const builder = new ClassIndexBuilder(provider, provider);
    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'iconoMuerta');
  });

  /* [318A-7V24][T7] Carrier cross-file vía el(): la unión global cubre sinks
   * distintos de setAttribute (definición en un módulo, llamada en otro). */
  test('cross-file carrier via el factory marks call-site literal as used', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: [
          '.tarjetaViva { color: red; }',
          '.tarjetaMuerta { color: purple; }',
        ].join('\n'),
      },
      '/workspace/src/fabrica.ts': {
        languageId: 'typescript',
        content: [
          'declare function el(tag: string, cls?: string): unknown;',
          'export function tarjeta(extra: string): unknown {',
          '  return el(\'div\', extra);',
          '}',
        ].join('\n'),
      },
      '/workspace/src/vista.ts': {
        languageId: 'typescript',
        content: 'import { tarjeta } from \'./fabrica\';\nexport const nodo = tarjeta(\'tarjetaViva\');',
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'tarjetaMuerta');
  });

  /* [299A-13 F1] Comilla escapada dentro de string (Let\'s en
   * SolucionHostingIsland.tsx:131): el escape muerto cerraba el string antes
   * de tiempo y la comilla de cierre REAL abría un string fantasma que se
   * tragaba la declaración y el uso posteriores (sondaEscapeViva huérfana FP).
   * Con el escape vivo, el estado de comillas sobrevive y el uso resuelve. */
  test('escaped quote inside string does not swallow later class usage', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: '.sondaEscapeViva { color: red; }\n.sondaEscapeMuerta { color: blue; }',
      },
      '/workspace/src/vista.tsx': {
        languageId: 'typescriptreact',
        content: [
          'const mensaje = \'Todo listo y verificado\\\' + resto\';',
          'const clase = \'sondaEscapeViva\';',
          'const vista = <span className={clase} />;',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'sondaEscapeMuerta');
  });

  /* [299A-13 F2] Props que TERMINAN en ClassName (panelClassName en
   * ChatBell.tsx:90 / NotificationBell.tsx:71 de NAKOMI: reenvío tal cual al
   * className del dropdown). Los tres formularios de valor las cubren igual
   * que className. */
  test('suffix *ClassName props (panelClassName) register their tokens', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: '.menuDesplegableVivo { color: red; }\n.menuDesplegableMuerto { color: blue; }',
      },
      '/workspace/src/Campana.tsx': {
        languageId: 'typescriptreact',
        content: [
          'export function Campana() {',
          '  return <BotonDesplegable panelClassName="menuDesplegableVivo" />;',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'menuDesplegableMuerto');
  });

  /* [299A-13 F5] Declaración portadora fuera de atributo
   * (`const claseVariante = `boton${...}`` en Button.tsx:19 de NAKOMI):
   * registra su familia con contexto de clase aunque el template no viva en
   * un atributo; sin esto el guard de prosa rechazaba `boton` y
   * botonPrimario se reportaba huérfana (FP). La muerta vive FUERA de la
   * familia (la familia exime a todos sus miembros por diseño). */
  test('carrier-named template declaration registers its class family', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: [
          '.botonBase { color: red; }',
          '.botonPrimario { color: red; }',
          '.panelMuerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/Boton.tsx': {
        languageId: 'typescriptreact',
        content: [
          'export function Boton({ variante = \'primario\' }: any) {',
          '  const claseVariante = `boton${variante.charAt(0).toUpperCase() + variante.slice(1)}`;',
          '  return <button className={`botonBase ${claseVariante}`} />;',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'panelMuerto');
  });

  /* [299A-13 F5] La convención de nombre portador en un solo punto: las tres
   * vías de emisión (declaraciones, compuestos, push) la comparten. */
  test('esNombrePortadorClase cubre className/contentClass y prefijos clase/Clase', () => {
    assert.strictEqual(esNombrePortadorClase('className'), true);
    assert.strictEqual(esNombrePortadorClase('contentClass'), true);
    assert.strictEqual(esNombrePortadorClase('claseVariante'), true);
    assert.strictEqual(esNombrePortadorClase('claseTamano'), true);
    assert.strictEqual(esNombrePortadorClase('clases'), true);
    assert.strictEqual(esNombrePortadorClase('ClaseExtra'), true);
    assert.strictEqual(esNombrePortadorClase('titulo'), false);
    assert.strictEqual(esNombrePortadorClase('variante'), false);
    assert.strictEqual(esNombrePortadorClase('onClick'), false);
    assert.strictEqual(esNombrePortadorClase('myclass'), false);
  });

  /* [299A-13 F4] Helper rest+join (`function combinarClases(...clases) {
   * return clases.filter(Boolean).join(' ')}` en Modal.tsx:12 de NAKOMI): el
   * `return <expr con .join(`> es texto de sink, la función es carrier y el
   * literal del call-site (`modalPruebaContenedor`) se consume cross-file. */
  test('rest+join helper is a carrier via its return statement', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: '.modalPruebaContenedor { color: red; }\n.modalPruebaMuerto { color: blue; }',
      },
      '/workspace/src/Modal.tsx': {
        languageId: 'typescriptreact',
        content: [
          'function combinarClases(...clases: Array<string | undefined>): string {',
          '  return clases.filter(Boolean).join(\' \');',
          '}',
          'export function abrirModal(className?: string): unknown {',
          '  return combinarClases(\'modalPruebaContenedor\', className);',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'modalPruebaMuerto');
  });

  /* [299A-13 F3b] Mapas exportados: solo `export const` con valores con forma
   * de clase; los locales y los valores no-clase se ignoran (la vía M1 ya
   * cubre los locales; la fase 2 une los exportados). */
  test('extraerMapasExportados solo registra mapas exportados con valores clase', () => {
    const mapas = extraerMapasExportados([
      'export const ESTADO: Record<Estado, string> = {',
      '  pendiente: \'clsUno\',',
      '  listo: \'clsDos\',',
      '};',
      'const LOCAL = { dentro: \'clsTres\' };',
      'export const VACIO: Record<string, string> = { n: 0, s: \'\' };',
      'export const OTRO = { a: \'clsCuatro\' };',
    ].join('\n'));

    assert.deepStrictEqual(mapas, { ESTADO: ['clsUno', 'clsDos'], OTRO: ['clsCuatro'] });
  });

  /* [299A-13 F3b] Imports relativos: default, nombrados con alias y namespace
   * de rutas '.'; librerías e `import type` fuera (sin valor runtime). */
  test('extraerNombresImportadosRelativos solo trae nombres de codigo propio', () => {
    const nombres = extraerNombresImportadosRelativos([
      'import { A, B as C } from \'../api/x\';',
      'import D from \'./y\';',
      'import * as N from \'./z\';',
      'import Dflt, { G as H } from \'./w\';',
      'import { E } from \'react\';',
      'import type { T } from \'./t\';',
    ].join('\n'));

    assert.deepStrictEqual([...nombres].sort(), ['A', 'C', 'D', 'Dflt', 'H', 'N']);
  });

  /* [299A-13 F3b] Mapa importado por subíndice (`className={
   * STATUS_CLASS[order.status]}` en UsuariosFila.tsx:80 de NAKOMI, exportado
   * por api/admin-users.ts:79): la referencia se une post-hoc con los valores
   * del archivo que lo exporta; la muerta real sigue reportada. */
  test('imported class map subscript resolves through the exporting file', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: [
          '.pagoPrueba--pendiente { color: red; }',
          '.pagoPrueba--listo { color: red; }',
          '.pagoPrueba--muerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/api.ts': {
        languageId: 'typescript',
        content: [
          'export type EstadoPrueba = \'pendiente\' | \'listo\';',
          'export const MAPA_PRUEBA: Record<EstadoPrueba, string> = {',
          '  pendiente: \'pagoPrueba--pendiente\',',
          '  listo: \'pagoPrueba--listo\',',
          '};',
        ].join('\n'),
      },
      '/workspace/src/Fila.tsx': {
        languageId: 'typescriptreact',
        content: [
          'import { MAPA_PRUEBA } from \'./api\';',
          'export function Fila({ estado }: any) {',
          '  return <span className={MAPA_PRUEBA[estado]} />;',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'pagoPrueba--muerto');
  });

  /* [299A-13 F3b-2] Subíndice con fallback literal (`MAPA[x] || ''` en
   * UsuariosFila.tsx:80 / HostingDetalle.tsx:155 de NAKOMI): el `|| ''`
   * rompía el match exacto y statusActivo/Baneado/Suspendido quedaban
   * huérfanas pese al import relativo. */
  test('imported class map subscript with literal fallback resolves', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: [
          '.estadoActivo { color: red; }',
          '.estadoInactivo { color: red; }',
          '.estadoMuerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/api.ts': {
        languageId: 'typescript',
        content: [
          'export const ESTADO: Record<string, string> = {',
          '  activo: \'estadoActivo\',',
          '  inactivo: \'estadoInactivo\',',
          '};',
        ].join('\n'),
      },
      '/workspace/src/Fila.tsx': {
        languageId: 'typescriptreact',
        content: [
          'import { ESTADO } from \'./api\';',
          'export function Fila({ e }: any) {',
          '  return <span className={`filaBadge ${ESTADO[e] || \'\'}`}>{e}</span>;',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'estadoMuerto');
  });

  /* [299A-13 F3b-2] Helper que envuelve un mapa importado (`return ...
   * PAYMENT_STATUS_CLASS[payment.status]` + `PAYMENT_STATUS_CLASS.released`
   * en paymentStatusClass de SeccionPagos.parts.tsx:15-16 de NAKOMI,
   * invocado como ${paymentStatusClass(payment)} en :76): el cuerpo no tiene
   * literales, así que el camino return-literal no veía nada y los 5
   * pagoEstado--* quedaban huérfanos. */
  test('helper wrapping an imported class map resolves through phase 2', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/estilos.css': {
        languageId: 'css',
        content: [
          '.pagoEnv--pendiente { color: red; }',
          '.pagoEnv--liberado { color: red; }',
          '.pagoEnv--muerto { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/api.ts': {
        languageId: 'typescript',
        content: [
          'export const PAGO: Record<string, string> = {',
          '  pendiente: \'pagoEnv--pendiente\',',
          '  liberado: \'pagoEnv--liberado\',',
          '};',
        ].join('\n'),
      },
      '/workspace/src/Fila.tsx': {
        languageId: 'typescriptreact',
        content: [
          'import { PAGO } from \'./api\';',
          'function clasePago(bypassed: boolean, estado: string): string {',
          '  return bypassed ? PAGO.liberado : PAGO[estado];',
          '}',
          'export function Fila({ estado }: any) {',
          '  return <span className={`pagoBadge ${clasePago(false, estado)}`}>{estado}</span>;',
          '}',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'pagoEnv--muerto');
  });
});
