import { CoreTextDocument } from './types';

export interface WorkspaceFile {
    uri: string;
    fsPath: string;
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
