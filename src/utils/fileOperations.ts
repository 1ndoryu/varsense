/*
 * Operaciones de lectura y búsqueda de archivos en el workspace
 * Separado de fileUtils para cumplir SRP (operaciones I/O de archivos)
 */

import * as vscode from 'vscode';

/*
 * Busca archivos en el workspace según patrones glob
 * Excluye automáticamente node_modules y otros directorios comunes
 */
export async function buscarArchivos(
    patrones: string[],
    excluir: string[] = []
): Promise<vscode.Uri[]> {
    const archivosEncontrados: vscode.Uri[] = [];
    
    /* Patrón de exclusión por defecto */
    const patronExclusion = excluir.length > 0
        ? `{${excluir.join(',')}}`
        : '**/node_modules/**';
    
    for (const patron of patrones) {
        try {
            const archivos = await vscode.workspace.findFiles(patron, patronExclusion);
            archivosEncontrados.push(...archivos);
        } catch (error) {
            console.error(`Error buscando archivos con patrón ${patron}:`, error);
        }
    }
    
    /* Eliminar duplicados basándose en la ruta */
    const rutasUnicas = new Set<string>();
    return archivosEncontrados.filter(uri => {
        const ruta = uri.fsPath;
        if (rutasUnicas.has(ruta)) {
            return false;
        }
        rutasUnicas.add(ruta);
        return true;
    });
}

/*
 * Lee el contenido de un archivo
 */
export async function leerArchivo(uri: vscode.Uri): Promise<string> {
    try {
        const contenidoBytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(contenidoBytes).toString('utf8');
    } catch (error) {
        console.error(`Error leyendo archivo ${uri.fsPath}:`, error);
        throw error;
    }
}

/*
 * Crea un watcher de archivos para los patrones especificados
 */
export function crearFileWatcher(
    patrones: string[],
    callbacks: {
        onCrear?: (uri: vscode.Uri) => void;
        onCambiar?: (uri: vscode.Uri) => void;
        onEliminar?: (uri: vscode.Uri) => void;
    }
): vscode.Disposable[] {
    const watchers: vscode.Disposable[] = [];
    
    for (const patron of patrones) {
        const watcher = vscode.workspace.createFileSystemWatcher(patron);
        
        if (callbacks.onCrear) {
            watchers.push(watcher.onDidCreate(callbacks.onCrear));
        }
        if (callbacks.onCambiar) {
            watchers.push(watcher.onDidChange(callbacks.onCambiar));
        }
        if (callbacks.onEliminar) {
            watchers.push(watcher.onDidDelete(callbacks.onEliminar));
        }
        
        watchers.push(watcher);
    }
    
    return watchers;
}
