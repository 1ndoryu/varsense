import { CssVariable, VariableIndex } from '@/types';
import { parsearDefiniciones } from '@/parsers/cssParser';
import { CancellationToken, DocumentProvider, throwIfCancelled, WorkspaceFile, WorkspaceFileProvider } from './workspaceProviders';
import { PersistentIndexStore, sha256File } from './persistentIndex';

export interface VariableIndexBuildResult {
    indice: VariableIndex;
    variablesPorArchivo: Map<string, CssVariable[]>;
}

export interface VariableIndexBuildOptions {
    patterns: string[];
    exclude: string[];
    maxConcurrent?: number;
    token?: CancellationToken;
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
        private readonly documentProvider: DocumentProvider,
        private readonly persistentStore?: PersistentIndexStore
    ) {}

    public async build(options: VariableIndexBuildOptions): Promise<VariableIndexBuildResult> {
        const files = await this.fileProvider.findFiles(options.patterns, options.exclude);
        throwIfCancelled(options.token);
        return this.buildFromFiles(files, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT, options.token);
    }

    public async buildFromFiles(
        files: WorkspaceFile[],
        maxConcurrent: number = DEFAULT_MAX_CONCURRENT,
        token?: CancellationToken
    ): Promise<VariableIndexBuildResult> {
        const indice = crearIndiceVacio();
        const variablesPorArchivo = new Map<string, CssVariable[]>();

        for (let index = 0; index < files.length; index += maxConcurrent) {
            throwIfCancelled(token);
            const batch = files.slice(index, index + maxConcurrent);
            await Promise.all(batch.map(file => this.addFileToIndex(file, indice.variables, variablesPorArchivo, token)));
        }

        throwIfCancelled(token);
        indice.ultimaActualizacion = Date.now();
        indice.archivosEscaneados = files.map(file => file.fsPath);

        return { indice, variablesPorArchivo };
    }

    public async addFileToIndex(
        file: WorkspaceFile,
        indice: Map<string, CssVariable>,
        variablesPorArchivo: Map<string, CssVariable[]>,
        token?: CancellationToken
    ): Promise<void> {
        throwIfCancelled(token);
        /* [028A-8] Reutiliza la entrada persistente cuando el hash coincide;
         * solo abre y parsea el documento cuando no hay coincidencia. */
        const store = this.persistentStore;
        const hash = store ? await sha256File(file.fsPath) : null;
        const stored = hash && store ? store.getEntry(file.fsPath) : undefined;
        let variables: CssVariable[];
        if (store && stored?.hash === hash && stored.variables) {
            store.stats.reused++;
            variables = stored.variables;
        } else {
            const document = await this.documentProvider.openTextDocument(file);
            throwIfCancelled(token);
            variables = parsearDefiniciones(document);
            if (hash && store) {
                const previa = store.getEntry(file.fsPath) ?? {};
                store.setEntry(file.fsPath, { ...previa, hash, variables });
                store.stats.reparsed++;
            }
        }

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
