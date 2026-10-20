/*
 * Observadores de archivos del escáner de variables: vigilan los archivos de variables
 * y el HEAD de Git (cambio de rama, que invalida el caché).
 */

import { FileWatcher, FileWatcherProvider, WorkspaceFile } from '@/core/proveedores/workspaceProviders';

export interface ManejadoresObservadores {
    onCreate: (file: WorkspaceFile) => void;
    onChange: (file: WorkspaceFile) => void;
    onDelete: (file: WorkspaceFile) => void;
    onCambioRama: () => void;
}

/* Crea los watchers de los patrones de variables y el de cambio de rama */
export function crearObservadoresVariables(
    provider: FileWatcherProvider,
    patrones: string[],
    manejadores: ManejadoresObservadores
): FileWatcher[] {
    const watchers = provider.createWatchers(patrones, manejadores);
    const watchersGit = provider.createWatchers(['**/.git/HEAD'], { onChange: manejadores.onCambioRama });
    return [...watchers, ...watchersGit];
}
