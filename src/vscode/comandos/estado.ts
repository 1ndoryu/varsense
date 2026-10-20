/*
 * Estado compartido por los comandos de la extensión.
 * Lo rellena activate() y lo leen los módulos de comandos; deactivate() lo limpia.
 */

import * as vscode from 'vscode';
import { DiagnosticProvider } from '@/vscode/providers/diagnosticProvider';

export interface EstadoExtension {
    diagnosticProvider: DiagnosticProvider | null;
    canalSalida: vscode.OutputChannel | null;
    coleccionHuerfanas: vscode.DiagnosticCollection | null;
}

export const estado: EstadoExtension = {
    diagnosticProvider: null,
    canalSalida: null,
    coleccionHuerfanas: null,
};
