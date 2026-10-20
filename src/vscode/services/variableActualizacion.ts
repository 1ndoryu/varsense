/*
 * Actualización incremental del caché de variables: procesa o elimina un único archivo
 * sin re-escanear el workspace. No conoce vscode ni el emisor de eventos (eso lo hace el escáner).
 */

import { CacheState } from '@/types';
import { VariableIndexBuilder } from '@/core/indices/variableIndexBuilder';
import { WorkspaceFile } from '@/core/proveedores/workspaceProviders';
import { logger } from '@/utils/logger';

/* Quita del índice las variables de un archivo (antes de reprocesarlo o al borrarlo) */
function eliminarVariablesDeArchivo(cache: CacheState, builder: VariableIndexBuilder, fsPath: string): void {
    builder.removeFileFromIndex(fsPath, cache.indice.variables, cache.variablesPorArchivo);
}

/* Reemplaza las variables de un archivo por las de su contenido actual */
export async function actualizarArchivoEnCache(
    cache: CacheState,
    builder: VariableIndexBuilder,
    file: WorkspaceFile
): Promise<void> {
    eliminarVariablesDeArchivo(cache, builder, file.fsPath);
    try {
        await builder.addFileToIndex(file, cache.indice.variables, cache.variablesPorArchivo);
    } catch (error) {
        logger.error(`Error procesando ${file.fsPath}:`, error);
    }
    cache.indice.ultimaActualizacion = Date.now();
}

/* Quita un archivo del caché; devuelve false si no estaba, así no hay nada que notificar */
export function eliminarArchivoDeCache(cache: CacheState, builder: VariableIndexBuilder, file: WorkspaceFile): boolean {
    const fsPath = file.fsPath;
    if (!cache.variablesPorArchivo.has(fsPath)) {
        return false;
    }
    eliminarVariablesDeArchivo(cache, builder, fsPath);
    cache.variablesPorArchivo.delete(fsPath);
    cache.indice.archivosEscaneados = cache.indice.archivosEscaneados.filter(f => f !== fsPath);
    return true;
}
