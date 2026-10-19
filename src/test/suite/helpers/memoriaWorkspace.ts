/* Helpers compartidos por coreContracts y sus partes: evitan duplicarlos entre los tres archivos de test. */
import { createCoreDocument } from '../../../core/types';
import { DocumentProvider, WorkspaceFile, WorkspaceFileProvider } from '../../../core/proveedores/workspaceProviders';

/* Convencion del area: el core no la asume; los tests que la usan la pasan explicita. */
export const PREFIJOS_AREA = ['clase'];

export class MemoryWorkspaceProvider implements WorkspaceFileProvider, DocumentProvider {
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

/* [15A-25] Indice vacio para los casos que solo miran el veredicto por
 * documento (estilo inline, respaldos de var()) y no el indice de variables. */
export function indiceVacio() {
  return { variables: new Map(), ultimaActualizacion: 0, archivosEscaneados: [] as string[] };
}
