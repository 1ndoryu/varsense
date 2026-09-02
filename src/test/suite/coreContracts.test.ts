import * as assert from 'assert';
import { createCoreDocument, createCoreRange, serializeCoreFindings, CoreFinding } from '../../core/types';
import { findingToDiagnostic } from '../../core/vscodeAdapter';
import { parsearDocumento } from '../../parsers/cssParser';
import { analyzeVarsenseDocument } from '../../core/analyzeDocument';
import { buildAnalysisConfig } from '../../core/config';
import { analyzeTokenRules } from '../../core/tokenRules';
import { VariableIndexBuilder } from '../../core/variableIndexBuilder';
import { ClassIndexBuilder } from '../../core/classIndexBuilder';
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

  /* [318A-7V3] Ternario asignado a variable y consumido por interpolación de
   * template: `className={\`base ${claseTipo} ...\`}`. addClassTokens borra
   * la interpolación; los identificadores puros deben resolverse contra el
   * mapa de declaraciones igual que en className={ident}. Patrón real:
   * VistaResizeHandle.tsx de PT. */
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

  /* [318A-7V8] Auditoría FN: si el canonical de un valor cae en otro archivo
   * y el par real esta en un tercer archivo, el par intra-archivo NO debe
   * perderse (el agrupado por archivo+valor garantiza canonical por archivo). */
  test('token-duplicate conserva pares intra-archivo aunque otro archivo tenga el mismo valor', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/a.css': {
        languageId: 'css',
        content: ':root { --valorA: #fff; }',
      },
      '/workspace/src/b.css': {
        languageId: 'css',
        content: ':root { --valorB1: #fff; --valorB2: #fff; }',
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
    assert.ok(String(duplicados[0].message).includes('--valorB2'));
  });
});
