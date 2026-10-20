/*
 * Utilidades de rutas y patrones de archivos
 * Funciones para manipulación de rutas, extensiones y patrones glob
 */

import * as vscode from 'vscode';
import * as path from 'path';

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
