/*
 * Comandos de proyecto: escaneo global, reporte en output y exportación a markdown
 */

import * as vscode from 'vscode';
import { ResultadoEscaneoProyecto } from '@/vscode/providers/diagnosticProvider';
import { VariableScanner } from '@/vscode/services/variableScanner';
import { estado } from './estado';

/*
 * Comando: Escanear todo el proyecto (archivos abiertos y cerrados)
 */
export async function comandoEscanearTodoProyecto(): Promise<void> {
    let resultadoEscaneo: ResultadoEscaneoProyecto | null = null;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'CSS Vars Validator',
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Escaneando variables...' });
            await VariableScanner.obtenerInstancia().escanear(true);

            progress.report({ message: 'Analizando todos los archivos del proyecto...' });

            if (estado.diagnosticProvider) {
                resultadoEscaneo = await estado.diagnosticProvider.escanearTodoElProyecto((actual, total, rutaArchivo) => {
                    const nombreArchivo = rutaArchivo.split(/[/\\]/).pop() || rutaArchivo;
                    progress.report({ message: `Analizando ${actual}/${total}: ${nombreArchivo}` });
                });
            }
        }
    );

    if (resultadoEscaneo) {
        mostrarResultadoEscaneo(resultadoEscaneo);
    }
}

/*
 * Muestra resultado del escaneo global y facilita navegación por archivo
 */
function mostrarResultadoEscaneo(resultado: ResultadoEscaneoProyecto): void {
    const mensaje = `CSS Vars: Escaneo completo — ${resultado.totalDiagnosticos} problema(s) en ${resultado.totalArchivosConProblemas} archivo(s)`;

    if (resultado.totalDiagnosticos === 0) {
        void vscode.window.showInformationMessage(mensaje);
        return;
    }

    escribirReporteEnOutput(resultado);

    void vscode.window.showInformationMessage(
        mensaje,
        'Ver reporte',
        'Ir a archivo con errores'
    ).then(async accion => {
        if (accion === 'Ver reporte' && estado.canalSalida) {
            estado.canalSalida.show(true);
            return;
        }

        if (accion === 'Ir a archivo con errores') {
            await abrirQuickPickArchivosConProblemas(resultado);
        }
    });
}

/*
 * Escribe el reporte completo en el OutputChannel
 */
export function escribirReporteEnOutput(resultado: ResultadoEscaneoProyecto): void {
    if (!estado.canalSalida) {
        return;
    }

    estado.canalSalida.clear();
    estado.canalSalida.appendLine('=== CSS Vars Validator · Reporte de escaneo global ===');
    estado.canalSalida.appendLine(`Total diagnósticos: ${resultado.totalDiagnosticos}`);
    estado.canalSalida.appendLine(`Archivos analizados: ${resultado.totalArchivosAnalizados}`);
    estado.canalSalida.appendLine(`Archivos con problemas: ${resultado.totalArchivosConProblemas}`);
    estado.canalSalida.appendLine('');

    for (const archivo of resultado.archivosConProblemas) {
        estado.canalSalida.appendLine(`• ${archivo.ruta}`);
        estado.canalSalida.appendLine(`  Total: ${archivo.total} | Errores: ${archivo.errores} | Warnings: ${archivo.warnings} | Info: ${archivo.informacion} | Hint: ${archivo.hints}`);
        for (const ejemplo of archivo.ejemplos) {
            estado.canalSalida.appendLine(`    - ${ejemplo}`);
        }
        estado.canalSalida.appendLine('');
    }
}

/*
 * Abre un quick pick para navegar a los archivos con problemas
 */
async function abrirQuickPickArchivosConProblemas(resultado: ResultadoEscaneoProyecto): Promise<void> {
    const items = resultado.archivosConProblemas.map(archivo => ({
        label: `${archivo.errores > 0 ? '$(error)' : '$(warning)'} ${archivo.ruta.split(/[/\\]/).pop() || archivo.ruta}`,
        description: `${archivo.total} problema(s) · E:${archivo.errores} W:${archivo.warnings}`,
        detail: archivo.ruta,
        uri: archivo.uri
    }));

    const seleccion = await vscode.window.showQuickPick(items, {
        placeHolder: 'Selecciona un archivo para abrirlo',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (!seleccion) {
        return;
    }

    const doc = await vscode.workspace.openTextDocument(seleccion.uri);
    await vscode.window.showTextDocument(doc);
}

/*
 * Comando: Exportar reporte de errores a archivo markdown
 * Similar a lo que hace Code Sentinel con .sentinel-report.md
 */
export async function comandoExportarReporte(): Promise<void> {
    if (!estado.diagnosticProvider) {
        vscode.window.showWarningMessage('CSS Vars: Provider de diagnosticos no inicializado.');
        return;
    }

    const provider = estado.diagnosticProvider;
    let resultadoEscaneo: ResultadoEscaneoProyecto | null = null;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'CSS Vars Validator',
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Escaneando variables...' });
            await VariableScanner.obtenerInstancia().escanear(true);

            progress.report({ message: 'Analizando todos los archivos del proyecto...' });
            resultadoEscaneo = await provider.escanearTodoElProyecto((actual, total, rutaArchivo) => {
                const nombreArchivo = rutaArchivo.split(/[/\\]/).pop() || rutaArchivo;
                progress.report({ message: `Analizando ${actual}/${total}: ${nombreArchivo}` });
            });
        }
    );

    if (!resultadoEscaneo) {
        return;
    }

    const resultado = resultadoEscaneo as ResultadoEscaneoProyecto;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    const rutaBase = workspaceFolders[0].uri.fsPath.replace(/\\/g, '/');
    const fecha = new Date().toISOString().replace('T', ' ').substring(0, 19);

    let contenido = `# VarSense - Reporte de Errores CSS\n\n`;
    contenido += `**Fecha:** ${fecha}  \n`;
    contenido += `**Archivos analizados:** ${resultado.totalArchivosAnalizados}  \n`;
    contenido += `**Archivos con problemas:** ${resultado.totalArchivosConProblemas}  \n`;
    contenido += `**Total problemas:** ${resultado.totalDiagnosticos}  \n\n`;

    if (resultado.totalDiagnosticos === 0) {
        contenido += `> Sin problemas detectados. El proyecto esta limpio.\n`;
    }

    /* Conteos por severidad */
    let totalErrores = 0;
    let totalWarnings = 0;
    let totalInfo = 0;
    let totalHints = 0;

    for (const archivo of resultado.archivosConProblemas) {
        totalErrores += archivo.errores;
        totalWarnings += archivo.warnings;
        totalInfo += archivo.informacion;
        totalHints += archivo.hints;
    }

    contenido += `| Severidad | Cantidad |\n`;
    contenido += `|-----------|----------|\n`;
    contenido += `| Error | ${totalErrores} |\n`;
    contenido += `| Warning | ${totalWarnings} |\n`;
    contenido += `| Info | ${totalInfo} |\n`;
    contenido += `| Hint | ${totalHints} |\n\n`;

    /* Detalle por archivo */
    for (const archivo of resultado.archivosConProblemas) {
        const rutaRelativa = archivo.ruta.replace(/\\/g, '/').replace(rutaBase + '/', '');

        contenido += `---\n\n`;
        contenido += `## ${rutaRelativa} (${archivo.total} problemas)\n\n`;

        for (const ejemplo of archivo.ejemplos) {
            contenido += `- ${ejemplo}\n`;
        }

        contenido += `\n`;
    }

    try {
        const rutaReporte = vscode.Uri.joinPath(workspaceFolders[0].uri, '.varsense-report.md');
        await vscode.workspace.fs.writeFile(rutaReporte, Buffer.from(contenido, 'utf-8'));
        const doc = await vscode.workspace.openTextDocument(rutaReporte);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        vscode.window.showInformationMessage(
            `CSS Vars: Reporte exportado a .varsense-report.md (${resultado.totalDiagnosticos} problemas en ${resultado.totalArchivosConProblemas} archivos).`
        );
    } catch (error) {
        vscode.window.showErrorMessage(
            `CSS Vars: Error al generar reporte — ${error instanceof Error ? error.message : 'Error desconocido'}`
        );
    }
}
