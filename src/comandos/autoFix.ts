/*
 * Auto-fix: aplica los quick-fixes automáticos a todos los CSS con diagnósticos
 */

import * as vscode from 'vscode';
import { DiagnosticType } from '@/types';
import { VariableScanner } from '@/services/variableScanner';
import { estado } from './estado';
import { escribirReporteEnOutput } from './proyecto';

/*
 * Comando: aplica quick-fixes automáticos en todos los archivos CSS/SCSS/LESS con diagnósticos
 */
export async function comandoAutoFixTodosLosCss(): Promise<void> {
    if (!estado.diagnosticProvider) {
        return;
    }

    const provider = estado.diagnosticProvider;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'CSS Vars Validator',
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Escaneando proyecto completo...' });
            await VariableScanner.obtenerInstancia().escanear(true);
            const resultado = await provider.escanearTodoElProyecto();

            const archivosCss = resultado.archivosConProblemas.filter(a => /\.(css|scss|less)$/i.test(a.ruta));
            let totalFixesAplicados = 0;

            for (let indice = 0; indice < archivosCss.length; indice++) {
                const archivo = archivosCss[indice];
                const porcentaje = Math.round(((indice + 1) / archivosCss.length) * 100);

                progress.report({
                    message: `Aplicando quick-fixes (${indice + 1}/${archivosCss.length}): ${archivo.ruta.split(/[/\\]/).pop()}`,
                    increment: archivosCss.length > 0 ? 100 / archivosCss.length : 100
                });

                const fixesArchivo = await aplicarQuickFixesEnDocumento(archivo.uri);
                totalFixesAplicados += fixesArchivo;

                if (porcentaje % 20 === 0 && estado.canalSalida) {
                    estado.canalSalida.appendLine(`[AutoFix] Progreso ${porcentaje}% · ${archivo.ruta} · fixes: ${fixesArchivo}`);
                }
            }

            progress.report({ message: 'Re-escanendo diagnósticos para validar resultados...' });
            const resultadoFinal = await provider.escanearTodoElProyecto();
            escribirReporteEnOutput(resultadoFinal);

            vscode.window.showInformationMessage(
                `CSS Vars: Auto-fix completado. ${totalFixesAplicados} quick-fix(es) aplicado(s). Restantes: ${resultadoFinal.totalDiagnosticos}`,
                'Ver reporte'
            ).then(accion => {
                if (accion === 'Ver reporte' && estado.canalSalida) {
                    estado.canalSalida.show(true);
                }
            });
        }
    );
}

/*
 * Aplica quick-fixes soportados para un documento específico
 */
async function aplicarQuickFixesEnDocumento(uri: vscode.Uri): Promise<number> {
    if (!estado.diagnosticProvider) {
        return 0;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
    await estado.diagnosticProvider.actualizarDiagnosticos(doc);

    const diagnosticos = estado.diagnosticProvider
        .obtenerColeccion()
        .get(uri)
        ?.filter(diag => {
            if (diag.source !== 'CSS Vars Validator') {
                return false;
            }

            return diag.code === DiagnosticType.ValorHardcoded ||
                diag.code === DiagnosticType.FallbackHardcoded ||
                diag.code === DiagnosticType.VariableNoDefinida;
        }) || [];

    if (diagnosticos.length === 0) {
        return 0;
    }

    const diagnosticosOrdenados = [...diagnosticos].sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
            return b.range.start.line - a.range.start.line;
        }
        return b.range.start.character - a.range.start.character;
    });

    let fixesAplicados = 0;

    for (const diagnostic of diagnosticosOrdenados) {
        const acciones = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
            'vscode.executeCodeActionProvider',
            uri,
            diagnostic.range,
            vscode.CodeActionKind.QuickFix
        );

        if (!acciones || acciones.length === 0) {
            continue;
        }

        const accionesCodigo = acciones.filter((accion): accion is vscode.CodeAction => {
            return accion instanceof vscode.CodeAction;
        });

        if (accionesCodigo.length === 0) {
            continue;
        }

        const accionElegida = accionesCodigo.find(a => a.isPreferred) || accionesCodigo[0];

        if (accionElegida.edit) {
            const aplicado = await vscode.workspace.applyEdit(accionElegida.edit);
            if (aplicado) {
                fixesAplicados++;
            }
        }

        if (accionElegida.command) {
            await vscode.commands.executeCommand(accionElegida.command.command, ...(accionElegida.command.arguments || []));
        }
    }

    await editor.document.save();
    await estado.diagnosticProvider.actualizarDiagnosticos(editor.document);

    return fixesAplicados;
}
