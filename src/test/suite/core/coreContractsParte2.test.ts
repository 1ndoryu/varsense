import * as assert from 'assert';
import { createCoreDocument } from '../../../core/types';
import { analyzeVarsenseDocument } from '../../../core/analisis/analyzeDocument';
import { buildAnalysisConfig } from '../../../core/configuracion/config';
import { ESTILO_BOTON_CONVENCION } from '../../../configuracion/convencionArea';
import { analyzeCrossFileDuplicates, analyzeTokenRules } from '../../../core/analisis/tokenRules';
import { VariableIndexBuilder } from '../../../core/indices/variableIndexBuilder';
import { ClassIndexBuilder } from '../../../core/indices/classIndexBuilder';
import { parserCssVarsense } from '../../../parsers';
import { MemoryWorkspaceProvider, PREFIJOS_AREA } from '../helpers/memoriaWorkspace';

suite('VarSense editor-agnostic core contracts (parte 2)', () => {
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
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}), parserCssVarsense);
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION), parserCssVarsense);

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
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}), parserCssVarsense);
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION), parserCssVarsense);

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
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}), parserCssVarsense);
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION), parserCssVarsense);

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
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const objetos = Array.from(result.variablesPorArchivo.entries()).map(([file, variables]) => ({
      file,
      document: createCoreDocument({ uri: `file://${file}`, fileName: file, languageId: 'css', content: '' }),
    }));
    const hallazgos = analyzeTokenRules(result.variablesPorArchivo, objetos, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION));
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
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const objetos = Array.from(result.variablesPorArchivo.entries()).map(([file, variables]) => ({
      file,
      document: createCoreDocument({ uri: `file://${file}`, fileName: file, languageId: 'css', content: '' }),
    }));
    const hallazgos = analyzeTokenRules(result.variablesPorArchivo, objetos, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION));
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
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const objetos = Array.from(result.variablesPorArchivo.entries()).map(([file, variables]) => ({
      file,
      document: createCoreDocument({ uri: `file://${file}`, fileName: file, languageId: 'css', content: '' }),
    }));
    const hallazgos = analyzeTokenRules(result.variablesPorArchivo, objetos, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION));
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
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const objetos = Array.from(result.variablesPorArchivo.entries()).map(([file, variables]) => ({
      file,
      document: createCoreDocument({ uri: `file://${file}`, fileName: file, languageId: 'css', content: '' }),
    }));
    const hallazgos = analyzeTokenRules(result.variablesPorArchivo, objetos, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION));
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
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const objetos = Array.from(result.variablesPorArchivo.entries()).map(([file, variables]) => ({
      file,
      document: createCoreDocument({ uri: `file://${file}`, fileName: file, languageId: 'css', content: '' }),
    }));
    const hallazgos = analyzeTokenRules(result.variablesPorArchivo, objetos, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION));
    const duplicados = hallazgos.filter(hallazgo => hallazgo.ruleId === 'token-duplicate');

    assert.strictEqual(duplicados.length, 0);
  });

  /* [GH-alias] Los alias var(--x) no cuentan como valor repetido; un literal
   * repetido en el mismo ámbito sigue marcando. */
  test('[GH-alias] token-duplicate exime alias var(--x) y marca literales repetidos', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/variables.css': {
        languageId: 'css',
        content: ':root { --texto: #000000; --borde: var(--texto); --foco: var(--texto); --aliasUno: #111111; --aliasDos: #111111; }',
      },
    });
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const objetos = Array.from(result.variablesPorArchivo.entries()).map(([file, variables]) => ({
      file,
      document: createCoreDocument({ uri: `file://${file}`, fileName: file, languageId: 'css', content: '' }),
    }));
    const hallazgos = analyzeTokenRules(result.variablesPorArchivo, objetos, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION));
    const duplicados = hallazgos.filter(hallazgo => hallazgo.ruleId === 'token-duplicate');

    assert.strictEqual(duplicados.length, 1);
    assert.ok(String(duplicados[0].message).includes('--aliasDos'));
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
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}), parserCssVarsense);
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION), parserCssVarsense);
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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'prefOk'), false);
  });

  /* [149A-1 F3.12] hardcodedDetection mantiene warning por defecto (089A-3):
   * la opcion solo cambia la severidad cuando el proyecto la fija. */
  test('[149A-1] hardcodedDetection mantiene warning por defecto', () => {
    const config = buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION);

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
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}), parserCssVarsense);
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const porDefecto = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION), parserCssVarsense);
    const enError = analyzeVarsenseDocument(
      documento, indice, buildAnalysisConfig({ hardcodedDetection: { severity: 'error' } }, ESTILO_BOTON_CONVENCION), parserCssVarsense
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
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}), parserCssVarsense);
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION), parserCssVarsense);

    assert.strictEqual(hallazgos.length, 2);
    assert.ok(hallazgos.every(hallazgo => hallazgo.ruleId === 'cssInlineReact'));
  });

  /* Reenvio de prop: `style={style}` pasa al hijo lo que recibio el componente,
   * no es CSS inline escrito aqui. Un objeto local sigue marcandose (149A-1). */
  test('[reenvio-style] style={style} reenviado como prop no se marca', async () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/Envoltorio.tsx',
      fileName: '/workspace/src/Envoltorio.tsx',
      languageId: 'typescriptreact',
      content: [
        'const Envoltorio = ({ style }: { style?: React.CSSProperties }) => <div style={style} />;',
        'const Otro = ({ estilo }: { estilo: React.CSSProperties }) => <div style={ { color: estilo.color } } />;',
      ].join('\n'),
    });
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}), parserCssVarsense);
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const hallazgos = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION), parserCssVarsense);

    assert.strictEqual(hallazgos.length, 1);
    assert.strictEqual(hallazgos[0].range.start.line, 1);
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
    const builder = new VariableIndexBuilder(new MemoryWorkspaceProvider({}), new MemoryWorkspaceProvider({}), parserCssVarsense);
    const indice = (await builder.build({ patterns: [], exclude: [] })).indice;

    const porDefecto = analyzeVarsenseDocument(documento, indice, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION), parserCssVarsense);
    const explicita = analyzeVarsenseDocument(
      documento, indice, buildAnalysisConfig({ todoProseDetection: { enabled: false } }, ESTILO_BOTON_CONVENCION), parserCssVarsense
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
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const hallazgos = analyzeCrossFileDuplicates(result.variablesPorArchivo, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION));

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
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const hallazgos = analyzeCrossFileDuplicates(result.variablesPorArchivo, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION));

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
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const hallazgos = analyzeCrossFileDuplicates(result.variablesPorArchivo, buildAnalysisConfig({}, ESTILO_BOTON_CONVENCION));

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
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);

    const result = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    const apagado = analyzeCrossFileDuplicates(
      result.variablesPorArchivo, buildAnalysisConfig({ tokenDetection: { crossFile: { enabled: false } } }, ESTILO_BOTON_CONVENCION)
    );
    const enWarning = analyzeCrossFileDuplicates(
      result.variablesPorArchivo, buildAnalysisConfig({ tokenDetection: { crossFile: { severity: 'warning' } } }, ESTILO_BOTON_CONVENCION)
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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });
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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'itemNotificacion--muerta');
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'itemNotificacion--leida'), false);
    assert.equal(result.clasesHuerfanas.some(item => item.nombre === 'itemNotificacion'), false);
  });
});
