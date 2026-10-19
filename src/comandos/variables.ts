/*
 * Comandos de variables CSS: refrescar, listar, ir a definición y limpiar caché
 */

import * as vscode from 'vscode';
import { VariableScanner } from '@/services/variableScanner';
import { CssVariable } from '@/types';
import { estado } from './estado';

/*
 * Escanea variables al iniciar
 */
export async function escanearVariablesInicial(): Promise<void> {
    const inicio = Date.now();
    
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Window,
            title: 'CSS Vars: Escaneando variables...',
            cancellable: false
        },
        async () => {
            await VariableScanner.obtenerInstancia().escanear(true);
        }
    );
    
    const duracion = Date.now() - inicio;
    const stats = VariableScanner.obtenerInstancia().obtenerEstadisticas();
    
    /* El resumen va al canal de salida: la consola de desarrollo no es visible para la usuaria. */
    estado.canalSalida?.appendLine(`[CSS Vars Validator] Escaneo inicial completado en ${duracion}ms`);
    estado.canalSalida?.appendLine(`[CSS Vars Validator] ${stats.totalVariables} variables en ${stats.archivosEscaneados} archivos`);
}

/*
 * Comando: Refrescar variables manualmente
 */
export async function comandoRefrescarVariables(): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'CSS Vars Validator',
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Escaneando variables...' });
            
            await VariableScanner.obtenerInstancia().escanear(true);
            
            const stats = VariableScanner.obtenerInstancia().obtenerEstadisticas();
            
            /* Actualizar diagnósticos */
            if (estado.diagnosticProvider) {
                progress.report({ message: 'Actualizando diagnósticos...' });
                await estado.diagnosticProvider.actualizarTodosDocumentos();
            }
            
            vscode.window.showInformationMessage(
                `CSS Vars: ${stats.totalVariables} variables encontradas en ${stats.archivosEscaneados} archivos`
            );
        }
    );
}

/*
 * Comando: Mostrar todas las variables en Quick Pick
 */
export async function comandoMostrarVariables(): Promise<void> {
    const scanner = VariableScanner.obtenerInstancia();
    const variables = scanner.obtenerVariablesOrdenadas();
    
    if (variables.length === 0) {
        vscode.window.showWarningMessage(
            'CSS Vars: No se encontraron variables. Verifica la configuración de archivos.'
        );
        return;
    }
    
    /* Crear items para Quick Pick */
    const items: vscode.QuickPickItem[] = variables.map(v => ({
        label: v.nombre,
        description: v.valor,
        detail: `📁 ${v.archivo.split(/[/\\]/).pop()} · Línea ${v.linea + 1}${v.frecuenciaUso > 0 ? ` · Usos: ${v.frecuenciaUso}` : ''}`
    }));
    
    const seleccion = await vscode.window.showQuickPick(items, {
        placeHolder: 'Buscar variable CSS...',
        matchOnDescription: true,
        matchOnDetail: true
    });
    
    if (seleccion) {
        /* Encontrar la variable seleccionada */
        const variable = variables.find(v => v.nombre === seleccion.label);
        if (variable) {
            await navegarAVariable(variable);
        }
    }
}

/*
 * Comando: Ir a definición de variable bajo el cursor
 */
export async function comandoIrADefinicion(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    
    const documento = editor.document;
    const posicion = editor.selection.active;
    const lineaTexto = documento.lineAt(posicion.line).text;
    
    /* Buscar variable en la posición actual */
    const varRegex = /var\(\s*(--[\w-]+)/g;
    let match: RegExpExecArray | null;
    
    while ((match = varRegex.exec(lineaTexto)) !== null) {
        const inicio = match.index;
        const fin = inicio + match[0].length;
        
        if (posicion.character >= inicio && posicion.character <= fin) {
            const nombreVariable = match[1];
            const variable = VariableScanner.obtenerInstancia().obtenerVariable(nombreVariable);
            
            if (variable) {
                await navegarAVariable(variable);
                return;
            } else {
                vscode.window.showWarningMessage(
                    `CSS Vars: Variable '${nombreVariable}' no encontrada`
                );
                return;
            }
        }
    }
    
    vscode.window.showInformationMessage(
        'CSS Vars: Posiciona el cursor sobre una variable CSS para ir a su definición'
    );
}

/*
 * Navega a la definición de una variable
 */
export async function navegarAVariable(variable: CssVariable): Promise<void> {
    try {
        const uri = vscode.Uri.file(variable.archivo);
        const documento = await vscode.workspace.openTextDocument(uri);
        
        const editor = await vscode.window.showTextDocument(documento, {
            selection: new vscode.Range(
                new vscode.Position(variable.linea, variable.columna),
                new vscode.Position(variable.linea, variable.columna + variable.nombre.length)
            )
        });
        
        /* Centrar la vista en la línea */
        editor.revealRange(
            new vscode.Range(variable.linea, 0, variable.linea, 0),
            vscode.TextEditorRevealType.InCenter
        );
        
    } catch (error) {
        vscode.window.showErrorMessage(
            `CSS Vars: Error al abrir archivo - ${error instanceof Error ? error.message : 'Error desconocido'}`
        );
    }
}

/*
 * Comando: Limpiar caché y re-escanear
 */
export async function comandoLimpiarCache(): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'CSS Vars Validator',
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Limpiando caché...' });

            /* Limpiar caché del scanner */
            VariableScanner.obtenerInstancia().limpiarCache();

            /* Limpiar diagnósticos */
            if (estado.diagnosticProvider) {
                estado.diagnosticProvider.limpiar();
            }

            progress.report({ message: 'Re-escaneando variables...' });
            await VariableScanner.obtenerInstancia().escanear(true);

            /* Actualizar diagnósticos en documentos abiertos */
            if (estado.diagnosticProvider) {
                await estado.diagnosticProvider.actualizarTodosDocumentos();
            }

            const stats = VariableScanner.obtenerInstancia().obtenerEstadisticas();
            vscode.window.showInformationMessage(
                `CSS Vars: Caché limpiado. ${stats.totalVariables} variables re-escaneadas de ${stats.archivosEscaneados} archivos`
            );
        }
    );
}
