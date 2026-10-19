/*
 * Comando: clases CSS definidas y no usadas en el proyecto (diagnósticos y reporte)
 */

import * as vscode from 'vscode';
import { escanearClasesHuerfanas, ResultadoClasesHuerfanas } from '@/services/classScanner';
import { DiagnosticType } from '@/types';
import { estado } from './estado';

/*
 * Comando: Detectar clases CSS definidas pero no usadas en el proyecto
 * Escanea todos los CSS para definiciones, cruza con TSX/JSX/PHP/HTML para uso
 * Muestra diagnosticos en los archivos CSS donde se definen las clases huerfanas
 */
export async function comandoDetectarClasesHuerfanas(): Promise<void> {
    if (!estado.coleccionHuerfanas) {
        vscode.window.showWarningMessage('CSS Vars: Coleccion de diagnosticos de huerfanas no inicializada.');
        return;
    }

    const config = vscode.workspace.getConfiguration('cssVarsValidator');
    const excluidos = config.get<string[]>('excludePatterns', [
        '**/node_modules/**', '**/vendor/**', '**/*.min.css', '**/dist/**', '**/build/**'
    ]);
    const longitudMinima = config.get<number>('orphanClassDetection.minClassLength', 3);
    const patronesExcluidos = config.get<string[]>('orphanClassDetection.excludeClassPatterns', []);
    const prefijosPortadores = config.get<string[]>('carrierPrefixes', ['clase']);

    let resultado: ResultadoClasesHuerfanas | null = null;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'CSS Vars Validator',
            cancellable: false
        },
        async (progress) => {
            resultado = await escanearClasesHuerfanas(
                excluidos,
                longitudMinima,
                patronesExcluidos,
                (fase, actual, total) => {
                    progress.report({ message: `${fase} (${actual}/${total})` });
                },
                prefijosPortadores
            );
        }
    );

    if (!resultado) {
        return;
    }

    const res = resultado as ResultadoClasesHuerfanas;

    /* Crear diagnosticos en los archivos CSS donde se definen las clases huerfanas */
    estado.coleccionHuerfanas.clear();
    const diagsPorArchivo = new Map<string, vscode.Diagnostic[]>();

    for (const clase of res.clasesHuerfanas) {
        const diags = diagsPorArchivo.get(clase.archivo) || [];

        const posInicio = new vscode.Position(clase.linea, clase.columna);
        /* +1 por el punto del selector .clase */
        const posFin = new vscode.Position(clase.linea, clase.columna + clase.nombre.length + 1);
        const rango = new vscode.Range(posInicio, posFin);

        const diag = new vscode.Diagnostic(
            rango,
            `Clase CSS '.${clase.nombre}' no se usa en ningun archivo del proyecto`,
            vscode.DiagnosticSeverity.Information
        );
        diag.code = DiagnosticType.ClaseHuerfana;
        diag.source = 'CSS Vars Validator';

        diags.push(diag);
        diagsPorArchivo.set(clase.archivo, diags);
    }

    for (const [archivo, diags] of diagsPorArchivo) {
        estado.coleccionHuerfanas.set(vscode.Uri.file(archivo), diags);
    }

    /* Escribir reporte en el output channel */
    if (estado.canalSalida) {
        estado.canalSalida.clear();
        estado.canalSalida.appendLine('=== CSS Vars Validator · Clases CSS Huerfanas ===');
        estado.canalSalida.appendLine(`Clases definidas: ${res.totalClasesDefinidas}`);
        estado.canalSalida.appendLine(`Clases usadas: ${res.totalClasesUsadas}`);
        estado.canalSalida.appendLine(`Clases huerfanas: ${res.totalClasesHuerfanas}`);
        estado.canalSalida.appendLine(`Archivos CSS analizados: ${res.archivosAnalizadosCss}`);
        estado.canalSalida.appendLine(`Archivos consumidores analizados: ${res.archivosAnalizadosConsumo}`);
        estado.canalSalida.appendLine(`Tiempo: ${res.tiempoMs}ms`);
        estado.canalSalida.appendLine('');

        if (res.clasesHuerfanas.length > 0) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const rutaBase = workspaceFolders ? workspaceFolders[0].uri.fsPath.replace(/\\/g, '/') : '';

            let archivoActual = '';
            for (const clase of res.clasesHuerfanas) {
                const rutaRelativa = rutaBase
                    ? clase.archivo.replace(/\\/g, '/').replace(rutaBase + '/', '')
                    : clase.archivo;

                if (rutaRelativa !== archivoActual) {
                    estado.canalSalida.appendLine(`\n--- ${rutaRelativa} ---`);
                    archivoActual = rutaRelativa;
                }
                estado.canalSalida.appendLine(`  L${clase.linea + 1}: .${clase.nombre}  (${clase.selector})`);
            }
        } else {
            estado.canalSalida.appendLine('Sin clases huerfanas detectadas. El proyecto esta limpio.');
        }
    }

    /* Mostrar notificacion con resultado */
    const mensaje = `CSS Vars: ${res.totalClasesHuerfanas} clase(s) huerfana(s) de ${res.totalClasesDefinidas} definida(s) [${res.tiempoMs}ms]`;

    if (res.totalClasesHuerfanas === 0) {
        vscode.window.showInformationMessage(mensaje);
    } else {
        vscode.window.showWarningMessage(mensaje, 'Ver reporte').then(accion => {
            if (accion === 'Ver reporte' && estado.canalSalida) {
                estado.canalSalida.show(true);
            }
        });
    }
}
