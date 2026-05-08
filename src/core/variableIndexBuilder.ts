import { CssVariable, VariableIndex } from '@/types';
import { parsearDefiniciones } from '@/parsers/cssParser';
import { DocumentProvider, WorkspaceFile, WorkspaceFileProvider } from './workspaceProviders';

export interface VariableIndexBuildResult {
    indice: VariableIndex;
    variablesPorArchivo: Map<string, CssVariable[]>;
}

export interface VariableIndexBuildOptions {
    patterns: string[];
    exclude: string[];
    maxConcurrent?: number;
}

const DEFAULT_MAX_CONCURRENT = 10;

function crearIndiceVacio(): VariableIndex {
    return {
        variables: new Map(),
        ultimaActualizacion: 0,
        archivosEscaneados: []
    };
}

/* [085A-2] Construye indices de variables sin workspace ni watchers VS Code.
 * Gotcha: el host decide como encontrar y abrir archivos; el core solo parsea CoreTextDocument. */
export class VariableIndexBuilder {
    constructor(
        private readonly fileProvider: WorkspaceFileProvider,
        private readonly documentProvider: DocumentProvider
    ) {}

    public async build(options: VariableIndexBuildOptions): Promise<VariableIndexBuildResult> {
        const files = await this.fileProvider.findFiles(options.patterns, options.exclude);
        return this.buildFromFiles(files, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
    }

    public async buildFromFiles(
        files: WorkspaceFile[],
        maxConcurrent: number = DEFAULT_MAX_CONCURRENT
    ): Promise<VariableIndexBuildResult> {
        const indice = crearIndiceVacio();
        const variablesPorArchivo = new Map<string, CssVariable[]>();

        for (let index = 0; index < files.length; index += maxConcurrent) {
            const batch = files.slice(index, index + maxConcurrent);
            await Promise.all(batch.map(file => this.addFileToIndex(file, indice.variables, variablesPorArchivo)));
        }

        indice.ultimaActualizacion = Date.now();
        indice.archivosEscaneados = files.map(file => file.fsPath);

        return { indice, variablesPorArchivo };
    }

    public async addFileToIndex(
        file: WorkspaceFile,
        indice: Map<string, CssVariable>,
        variablesPorArchivo: Map<string, CssVariable[]>
    ): Promise<void> {
        const document = await this.documentProvider.openTextDocument(file);
        const variables = parsearDefiniciones(document);

        variablesPorArchivo.set(file.fsPath, variables);

        for (const variable of variables) {
            if (!indice.has(variable.nombre)) {
                indice.set(variable.nombre, variable);
            }
        }
    }

    public removeFileFromIndex(
        fsPath: string,
        indice: Map<string, CssVariable>,
        variablesPorArchivo: Map<string, CssVariable[]>
    ): void {
        const variables = variablesPorArchivo.get(fsPath);
        if (!variables) {
            return;
        }

        for (const variable of variables) {
            const actual = indice.get(variable.nombre);
            if (actual?.archivo === fsPath) {
                indice.delete(variable.nombre);
            }
        }

        variablesPorArchivo.delete(fsPath);
    }
}
