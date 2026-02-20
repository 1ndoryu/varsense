/*
 * Utilidades de posición y rangos para documentos VS Code
 * Conversiones entre offsets y posiciones línea/columna
 */

import * as vscode from 'vscode';

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
