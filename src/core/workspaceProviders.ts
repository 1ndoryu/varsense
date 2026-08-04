import { CoreTextDocument } from './types';

export interface WorkspaceFile {
    uri: string;
    fsPath: string;
}

export interface CancellationToken {
    readonly isCancellationRequested: boolean;
}

export class CancellationError extends Error {
    public constructor() {
        super('Análisis cancelado');
        this.name = 'CancellationError';
    }
}

export function throwIfCancelled(token?: CancellationToken): void {
    if (token?.isCancellationRequested) {
        throw new CancellationError();
    }
}

export interface DocumentProvider {
    openTextDocument(file: WorkspaceFile): Promise<CoreTextDocument>;
}

export interface WorkspaceFileProvider {
    findFiles(patterns: string[], exclude: string[]): Promise<WorkspaceFile[]>;
}

export interface FileWatcherCallbacks {
    onCreate?: (file: WorkspaceFile) => void;
    onChange?: (file: WorkspaceFile) => void;
    onDelete?: (file: WorkspaceFile) => void;
}

export interface FileWatcher {
    dispose(): void;
}

export interface FileWatcherProvider {
    createWatchers(patterns: string[], callbacks: FileWatcherCallbacks): FileWatcher[];
}
