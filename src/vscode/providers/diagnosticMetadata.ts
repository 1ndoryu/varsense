/*
 * Metadatos de diagnósticos (propiedad y valor) que usan los quick fixes.
 * Se guardan en un WeakMap para no añadir propiedades no estándar a Diagnostic
 * y para que el mapa no retenga diagnósticos ya descartados.
 */

import * as vscode from 'vscode';

export interface DiagnosticMetadata {
    propiedad: string;
    valor: string;
}

const metadatos = new WeakMap<vscode.Diagnostic, DiagnosticMetadata>();

export function registrarMetadataDiagnostico(diagnostic: vscode.Diagnostic, metadata: DiagnosticMetadata): void {
    metadatos.set(diagnostic, metadata);
}

export function obtenerMetadataDiagnostico(diagnostic: vscode.Diagnostic): DiagnosticMetadata | undefined {
    return metadatos.get(diagnostic);
}
