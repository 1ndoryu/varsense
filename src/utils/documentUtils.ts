/*
 * Utilidades de inspección de documentos VS Code
 * Verificaciones de lenguaje y acceso a contenido de líneas
 */

import * as vscode from 'vscode';

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
