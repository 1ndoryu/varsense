import * as assert from 'assert';
import { createCoreDocument } from '../../core/types';
import { parsearDefinicionesRuntime } from '../../parsers/cssParser';
import { analyzeVarsenseDocument } from '../../core/analyzeDocument';
import { buildAnalysisConfig } from '../../core/config';
import { VariableIndexBuilder } from '../../core/variableIndexBuilder';
import { ClassIndexBuilder } from '../../core/classIndexBuilder';
import { detectarCarriersMismoArchivo, extraerMapasExportados, extraerNombresImportadosRelativos, esNombrePortadorClase } from '../../core/classIndexBuilder';
import { parserCssVarsense } from '../../parsers';
import { MemoryWorkspaceProvider, PREFIJOS_AREA, indiceVacio } from './helpers/memoriaWorkspace';

suite('VarSense editor-agnostic core contracts (parte 3)', () => {
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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'lstMuerta');
  });

  /* [15A-25][T4] Un array de fragmentos compone clases en runtime: los
   * elementos que son un subindice sobre un mapa local (o una variable local)
   * no son literales y quedaban fuera del set. Caso KAMPLES: `const clases =
   * ['badge', mapaVariante[variante], mapaTamano[tamano], ...]` en Badge.tsx,
   * Avatar.tsx, BotonBase.tsx, Modal.tsx y Notificacion.tsx (24 hallazgos). */
  test('array de fragmentos resuelve subindices sobre mapas locales', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/badge.css': {
        languageId: 'css',
        content: [
          '.badge { color: red; }',
          '.badgeNeutro { color: green; }',
          '.badgeXs { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/Badge.tsx': {
        languageId: 'typescriptreact',
        content: [
          'const mapaVariante = {',
          "  neutro: 'badgeNeutro',",
          '};',
          'const mapaTamano = {',
          "  xs: 'badgeXs',",
          '};',
          'export const Badge = ({ variante, tamano }) => {',
          "  const clases = ['badge', mapaVariante[variante], mapaTamano[tamano]].filter(Boolean).join(' ');",
          '  return <Tag className={clases} />;',
          '};',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

    assert.deepStrictEqual(result.clasesHuerfanas.map(clase => clase.nombre), []);
  });

  /* [15A-25][T3b] El array con un elemento ternario SIGUE siendo array.
   * `pareceTernarioDeLiterales` es un `?` seguido de comilla en cualquier
   * posicion del valor, asi que
   * `['badge', mapaVariante[variante], estilo === 'borde' ? 'badgeBorde' : '']`
   * se clasificaba como ternario y los subindices sobre mapas locales no se
   * resolvian: Badge.tsx, BotonBase.tsx, Modal.tsx, Avatar.tsx y
   * Notificacion.tsx producian 24 clases huerfanas falsas. */
  test('array con un elemento ternario no pierde sus subindices', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/badge.css': {
        languageId: 'css',
        content: [
          '.badge { color: red; }',
          '.badgeNeutro { color: green; }',
          '.badgeXs { color: blue; }',
          '.badgeBorde { border: 1px solid; }',
        ].join('\n'),
      },
      '/workspace/src/Badge.tsx': {
        languageId: 'typescriptreact',
        content: [
          'const mapaVariante = {',
          "  neutro: 'badgeNeutro',",
          '};',
          'const mapaTamano = {',
          "  xs: 'badgeXs',",
          '};',
          'export const Badge = ({ variante, tamano, estilo }) => {',
          "  const clases = ['badge', mapaVariante[variante], mapaTamano[tamano], estilo === 'borde' ? 'badgeBorde' : ''].filter(Boolean).join(' ');",
          '  return <Tag className={clases} />;',
          '};',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

    assert.deepStrictEqual(result.clasesHuerfanas.map(clase => clase.nombre), []);
  });

  /* [15A-25][T3c-control] El guardia de cierre `]` mantiene en la rama ternaria
   * un valor cuya CONDICION empieza por array: ahi los subindices no existen y
   * solo los literales del ternario son clases. */
  test('ternario cuya condicion empieza por array no aporta subindices', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/cond.css': {
        languageId: 'css',
        content: [
          '.condUno { color: red; }',
          '.condTernaria { color: green; }',
        ].join('\n'),
      },
      '/workspace/src/Cond.tsx': {
        languageId: 'typescriptreact',
        content: [
          'const mapaCond = {',
          "  a: 'condUno',",
          '};',
          'export const Cond = ({ x }) => {',
          "  const clases = [1, 2].includes(x) ? 'condTernaria' : '';",
          '  return <Tag className={clases} />;',
          '};',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

    assert.deepStrictEqual(
      result.clasesHuerfanas.map(clase => clase.nombre),
      ['condUno']
    );
  });

  /* [15A-25][T4-control] Un mapa que nadie indexa no aporta nada: sus valores
   * siguen siendo huerfanas (el subindice es lo que los hace alcanzables). */
  test('mapa de clases sin subindice no exime sus valores', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/suelto.css': {
        languageId: 'css',
        content: '.sueltoUno { color: red; }',
      },
      '/workspace/src/Suelto.tsx': {
        languageId: 'typescriptreact',
        content: [
          'const mapaSinUso = {',
          "  uno: 'sueltoUno',",
          '};',
          'export const Suelto = () => <div />;',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

    assert.deepStrictEqual(result.clasesHuerfanas.map(clase => clase.nombre), ['sueltoUno']);
  });

  /* [15A-25][T5] Plantilla anidada en una expresion de clase: el regex plano
   * se corta en la interpolacion y la familia no se registraba.
   * Caso KAMPLES: BadgesMetadata.tsx:109
   * `className={on ? `tarjetaMetaBadgeClickable${claseExtra}` : undefined}`. */
  test('familia de un template dentro de una expresion de clase', async () => {
    const provider = new MemoryWorkspaceProvider({
      '/workspace/src/meta.css': {
        languageId: 'css',
        content: [
          '.tarjetaMetaBadgeClickable { color: red; }',
          '.tarjetaMetaBadgeClickableSuave { color: blue; }',
        ].join('\n'),
      },
      '/workspace/src/BadgesMetadata.tsx': {
        languageId: 'typescriptreact',
        content: [
          'export const BadgesMetadata = ({ on, claseExtra }) => (',
          '  <span className={on ? `tarjetaMetaBadgeClickable${claseExtra}` : undefined} />',
          ');',
        ].join('\n'),
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

    assert.deepStrictEqual(result.clasesHuerfanas.map(clase => clase.nombre), []);
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
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);
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
    const hallazgos = analyzeVarsenseDocument(documento, construido.indice, buildAnalysisConfig({}), parserCssVarsense);

    assert.deepStrictEqual(hallazgos.filter(hallazgo => hallazgo.ruleId === 'variableNoDefinida'), []);
  });

  /* [15A-25][T1] Un `style={{ '--x': v }}` define el token en runtime. El
   * parser de CSS reconocia `setProperty` pero no el atributo `style`, asi que
   * todo `var(--x)` cuyo unico origen era el TSX salia como variableNoDefinida
   * (112 hallazgos en KAMPLES, todos de esta forma). */
  test('style={{ --x }} del TSX define la variable que consume la hoja', async () => {
    const archivos = {
      '/workspace/src/panel.css': {
        languageId: 'css',
        content: '.panel { height: var(--altoPanel); }',
      },
      '/workspace/src/Panel.tsx': {
        languageId: 'typescriptreact',
        content: [
          'export function Panel({ alto }: { alto: string }) {',
          '  return <div className="panel" style={{ \'--altoPanel\': alto }} />;',
          '}',
        ].join('\n'),
      },
    };
    const provider = new MemoryWorkspaceProvider(archivos);
    const builder = new VariableIndexBuilder(provider, provider, parserCssVarsense);
    const construido = await builder.build({ patterns: ['**/*.css'], exclude: [] });
    await builder.agregarDefinicionesRuntime(
      [{ uri: 'file:///workspace/src/Panel.tsx', fsPath: '/workspace/src/Panel.tsx' }],
      construido.indice.variables,
      construido.variablesPorArchivo
    );

    assert.strictEqual(construido.indice.variables.has('--altoPanel'), true);
    assert.strictEqual(
      construido.variablesPorArchivo.get('/workspace/src/Panel.tsx')?.[0].linea,
      1
    );
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/panel.css',
      fileName: '/workspace/src/panel.css',
      languageId: 'css',
      content: archivos['/workspace/src/panel.css'].content,
    });

    assert.deepStrictEqual(
      analyzeVarsenseDocument(documento, construido.indice, buildAnalysisConfig({}), parserCssVarsense)
        .filter(hallazgo => hallazgo.ruleId === 'variableNoDefinida'),
      []
    );
  });

  /* [15A-25][T2] El objeto envuelto en un ternario es definicion de tokens,
   * no estilo inline. El reconocedor anterior exigia `style={{` inmediato, asi
   * que el ternario caia en la rama generica y se reportaba cssInlineReact. */
  test('style={cond ? { --x } : undefined} no es estilo inline', () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/Barra.tsx',
      fileName: '/workspace/src/Barra.tsx',
      languageId: 'typescriptreact',
      content: [
        'export function Barra({ pct }: { pct: string }) {',
        '  return <div style={pct ? { \'--porcentaje\': pct } as CSSProperties : undefined} />;',
        '}',
      ].join('\n'),
    });

    const hallazgos = analyzeVarsenseDocument(documento, indiceVacio(), buildAnalysisConfig({}), parserCssVarsense);

    assert.deepStrictEqual(hallazgos.filter(hallazgo => hallazgo.ruleId === 'cssInlineReact'), []);
  });

  /* [15A-25][T2-control] El mismo reconocedor no exime un objeto que si
   * declara una propiedad CSS: ahi el style={{}} sigue siendo estilo inline. */
  test('style={{ color, --x }} mixto si es estilo inline', () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/Mezcla.tsx',
      fileName: '/workspace/src/Mezcla.tsx',
      languageId: 'typescriptreact',
      content: [
        'export function Mezcla({ v }: { v: string }) {',
        '  return <div style={{ color: \'red\', \'--x\': v }} />;',
        '}',
      ].join('\n'),
    });

    const hallazgos = analyzeVarsenseDocument(documento, indiceVacio(), buildAnalysisConfig({}), parserCssVarsense);

    assert.strictEqual(hallazgos.filter(hallazgo => hallazgo.ruleId === 'cssInlineReact').length, 1);
  });

  /* [15A-25][T3] El respaldo de un var() pasa por las MISMAS puertas que una
   * declaracion directa: la puerta de propiedad y la lista de valores
   * permitidos. Antes iba a pelo, y el mismo valor salia exento en
   * `color: transparent` y reportado en
   * `border-top: 3px solid var(--colorInsert, transparent)`; ademas `height`
   * (fuera de properties) se colaba solo como respaldo de un var(). */
  test('el respaldo de un var() respeta la puerta de propiedad y los valores permitidos', () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/respaldo.css',
      fileName: '/workspace/src/respaldo.css',
      languageId: 'css',
      content: [
        '.a { height: var(--alto, 120px); }',
        '.b { border-top: 3px solid var(--colorInsert, transparent); }',
        '.c { color: var(--texto, transparent); }',
      ].join('\n'),
    });

    const hallazgos = analyzeVarsenseDocument(documento, indiceVacio(), buildAnalysisConfig({}), parserCssVarsense);

    assert.deepStrictEqual(hallazgos.filter(hallazgo => hallazgo.ruleId === 'valorHardcoded'), []);
  });

  /* [15A-25][T3-control] Con la propiedad dentro de `properties` y un valor no
   * permitido, el respaldo si es un hardcodeo accionable. */
  test('el respaldo de un var() en propiedad vigilada si reporta hardcodeo', () => {
    const documento = createCoreDocument({
      uri: 'file:///workspace/src/respaldo.css',
      fileName: '/workspace/src/respaldo.css',
      languageId: 'css',
      content: '.a { color: var(--texto, #ff0000); }',
    });

    const hallazgos = analyzeVarsenseDocument(documento, indiceVacio(), buildAnalysisConfig({}), parserCssVarsense);

    assert.strictEqual(hallazgos.filter(hallazgo => hallazgo.ruleId === 'valorHardcoded').length, 1);
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
    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'panelMuerto');
  });

  /* [299A-13 F5] La convención de nombre portador en un solo punto: las tres
   * vías de emisión (declaraciones, compuestos, push) la comparten. */
  test('esNombrePortadorClase cubre className/contentClass y prefijos clase/Clase', () => {
    assert.strictEqual(esNombrePortadorClase('className', PREFIJOS_AREA), true);
    assert.strictEqual(esNombrePortadorClase('contentClass', PREFIJOS_AREA), true);
    assert.strictEqual(esNombrePortadorClase('claseVariante', PREFIJOS_AREA), true);
    assert.strictEqual(esNombrePortadorClase('claseTamano', PREFIJOS_AREA), true);
    assert.strictEqual(esNombrePortadorClase('clases', PREFIJOS_AREA), true);
    assert.strictEqual(esNombrePortadorClase('ClaseExtra', PREFIJOS_AREA), true);
    assert.strictEqual(esNombrePortadorClase('titulo', PREFIJOS_AREA), false);
    assert.strictEqual(esNombrePortadorClase('variante', PREFIJOS_AREA), false);
    assert.strictEqual(esNombrePortadorClase('onClick', PREFIJOS_AREA), false);
    assert.strictEqual(esNombrePortadorClase('myclass', PREFIJOS_AREA), false);
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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

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

    const result = await builder.scan({ prefijosPortadores: PREFIJOS_AREA, exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'pagoEnv--muerto');
  });
});
