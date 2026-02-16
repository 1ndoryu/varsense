/*
 * Utilidades para manejo de archivos
 * Funciones helper para operaciones de sistema de archivos en VS Code
 */

import * as vscode from 'vscode';
import * as path from 'path';

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
 * Obtiene la ruta relativa de un archivo respecto al workspace
 */
export function obtenerRutaRelativa(rutaAbsoluta: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return rutaAbsoluta;
    }
    
    for (const folder of workspaceFolders) {
        const rutaWorkspace = folder.uri.fsPath;
        if (rutaAbsoluta.startsWith(rutaWorkspace)) {
            return path.relative(rutaWorkspace, rutaAbsoluta);
        }
    }
    
    return rutaAbsoluta;
}

/*
 * Obtiene la extensión de un archivo
 */
export function obtenerExtension(rutaArchivo: string): string {
    return path.extname(rutaArchivo).toLowerCase();
}

/*
 * Verifica si un archivo es un archivo CSS válido
 */
export function esCssValido(rutaArchivo: string): boolean {
    const extensionesValidas = ['.css', '.scss', '.sass', '.less'];
    return extensionesValidas.includes(obtenerExtension(rutaArchivo));
}

/*
 * Verifica si una ruta coincide con algún patrón glob
 */
export function coincideConPatron(ruta: string, patrones: string[]): boolean {
    const rutaNormalizada = ruta.replace(/\\/g, '/');
    
    for (const patron of patrones) {
        const patronRegex = patronGlobARegex(patron);
        if (patronRegex.test(rutaNormalizada)) {
            return true;
        }
    }
    
    return false;
}

/*
 * Convierte un patrón glob simple a regex
 * Soporta * y ** básicos
 */
function patronGlobARegex(patron: string): RegExp {
    const regex = patron
        .replace(/\\/g, '/')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '<<<DOBLE_ASTERISCO>>>')
        .replace(/\*/g, '[^/]*')
        .replace(/<<<DOBLE_ASTERISCO>>>/g, '.*');
    
    return new RegExp(regex);
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

/*
 * Obtiene información de posición (línea/columna) desde un offset en texto
 */
export function offsetAPosicion(texto: string, offset: number): { linea: number; columna: number } {
    let linea = 0;
    let columna = 0;
    
    for (let i = 0; i < offset && i < texto.length; i++) {
        if (texto[i] === '\n') {
            linea++;
            columna = 0;
        } else {
            columna++;
        }
    }
    
    return { linea, columna };
}

/*
 * Obtiene offset desde posición (línea/columna) en texto
 */
export function posicionAOffset(texto: string, linea: number, columna: number): number {
    let lineaActual = 0;
    let offset = 0;
    
    while (lineaActual < linea && offset < texto.length) {
        if (texto[offset] === '\n') {
            lineaActual++;
        }
        offset++;
    }
    
    return offset + columna;
}

/*
 * Crea un Range de VS Code desde información de posición
 */
export function crearRango(
    lineaInicio: number,
    columnaInicio: number,
    lineaFin: number,
    columnaFin: number
): vscode.Range {
    return new vscode.Range(
        new vscode.Position(lineaInicio, columnaInicio),
        new vscode.Position(lineaFin, columnaFin)
    );
}

/*
 * Verifica si el documento está en un lenguaje soportado
 */
export function esLenguajeSoportado(documento: vscode.TextDocument): boolean {
    const lenguajesSoportados = ['css', 'scss', 'sass', 'less', 'vue', 'html'];
    return lenguajesSoportados.includes(documento.languageId);
}

/*
 * Verifica si el documento es un archivo React (TSX/JSX)
 */
export function esReact(documento: vscode.TextDocument): boolean {
    return ['typescriptreact', 'javascriptreact'].includes(documento.languageId);
}

/*
 * Obtiene el texto de una línea específica
 */
export function obtenerLinea(documento: vscode.TextDocument, numeroLinea: number): string {
    if (numeroLinea < 0 || numeroLinea >= documento.lineCount) {
        return '';
    }
    return documento.lineAt(numeroLinea).text;
}

/*
 * Debounce para funciones (útil para watchers)
 */
export function debounce<T extends (...args: unknown[]) => void>(
    funcion: T,
    espera: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;
    
    return (...args: Parameters<T>) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            funcion(...args);
            timeout = null;
        }, espera);
    };
}

/*
 * Throttle para funciones (útil para eventos frecuentes)
 */
export function throttle<T extends (...args: unknown[]) => void>(
    funcion: T,
    limite: number
): (...args: Parameters<T>) => void {
    let enEspera = false;
    
    return (...args: Parameters<T>) => {
        if (!enEspera) {
            funcion(...args);
            enEspera = true;
            setTimeout(() => {
                enEspera = false;
            }, limite);
        }
    };
}

/*
 * Genera un hash simple para strings (útil para caché)
 */
export function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}
