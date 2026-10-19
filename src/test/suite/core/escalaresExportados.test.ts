import * as assert from 'assert';
import { createCoreDocument } from '../../../core/types';
import { ClassIndexBuilder, extraerMapasExportados } from '../../../core/indices/classIndexBuilder';
import { DocumentProvider, WorkspaceFile, WorkspaceFileProvider } from '../../../core/proveedores/workspaceProviders';

/* [11AA-2] Suite standalone (sin importar adaptadores de 'vscode'): sirve para
 * iterar sobre el detector de claseHuerfana con `mocha --ui tdd` en segundos. */
class MemoryProvider implements WorkspaceFileProvider, DocumentProvider {
  constructor(private readonly files: Record<string, { languageId: string; content: string }>) {}

  async findFiles(patterns: string[]): Promise<WorkspaceFile[]> {
    const extensions = patterns.map(pattern => pattern.replace('**/*', ''));
    return Object.keys(this.files)
      .filter(filePath => extensions.some(extension => filePath.endsWith(extension)))
      .map(filePath => ({ uri: `file://${filePath}`, fsPath: filePath }));
  }

  async openTextDocument(file: WorkspaceFile) {
    const entry = this.files[file.fsPath];
    return createCoreDocument({
      uri: file.uri,
      fileName: file.fsPath,
      languageId: entry.languageId,
      content: entry.content,
    });
  }
}

suite('VarSense escalares exportados como fuente de clases', () => {
  /* [11AA-2] Escalares exportados (`export const CLASE = 'a b'`): cada token con
   * forma de clase se registra; valores con brackets o concatenados (`'x' + Y`)
   * se ignoran (fail-closed: no se conoce el valor completo). */
  test('extraerMapasExportados registra escalares exportados con clases', () => {
    const mapas = extraerMapasExportados([
      "export const CLASE_TEXTO = 'texto-publica';",
      "export const CLASE_ACTIVO: string = 'bg-[#F59820] activoPublica';",
      "const LOCAL_TEXTO = 'noExportada';",
      "export const CONCAT = 'parteUno' + SUFIJO;",
    ].join('\n'));

    assert.deepStrictEqual(mapas, { CLASE_TEXTO: ['texto-publica'], CLASE_ACTIVO: ['activoPublica'] });
  });

  /* [11AA-2] Caso real de MN-Inmobiliaria (`disenno.ts`): constante escalar
   * importada y consumida como `${CLASE_TEXTO}` en un className template. La
   * clase consumida no es huérfana; la no usada sí. */
  test('detects orphan classes consumed through an imported exported scalar', async () => {
    const provider = new MemoryProvider({
      '/workspace/src/styles.css': {
        languageId: 'css',
        content: '.texto-publica { color: red; }\n.panelOculto { color: blue; }',
      },
      '/workspace/src/disenno.ts': {
        languageId: 'typescript',
        content: "export const CLASE_TEXTO = 'texto-publica';",
      },
      '/workspace/src/view.tsx': {
        languageId: 'typescriptreact',
        content: "import { CLASE_TEXTO } from './disenno';\nexport const Vista = () => <p className={`${CLASE_TEXTO} parrafo`} />;",
      },
    });
    const builder = new ClassIndexBuilder(provider, provider);

    const result = await builder.scan({ exclude: [], minLength: 3 });

    assert.strictEqual(result.totalClasesHuerfanas, 1);
    assert.strictEqual(result.clasesHuerfanas[0].nombre, 'panelOculto');
  });
});
