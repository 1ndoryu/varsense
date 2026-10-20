/*
 * Escaneo global de diagnósticos
 * Recorre todos los CSS y React del proyecto, no solo los abiertos, y resume
 * los problemas por archivo.
 */

import * as vscode from 'vscode';
import {obtenerConfigService} from '@/services/configService';
/* Globs por defecto del core: la extensión no duplica la convención de extensiones. */
import {DEFAULT_CSS_PATTERNS, DEFAULT_REACT_PATTERNS} from '@/core/configuracion/config';
/* Import de tipo: evita un ciclo en runtime con diagnosticProvider.ts */
import type {ResumenDiagnosticoArchivo} from '@/providers/diagnosticProvider';

/*
 * Resultado del escaneo global de diagnósticos
 */
export interface ResultadoEscaneoProyecto {
    totalDiagnosticos: number;
    totalArchivosAnalizados: number;
    totalArchivosConProblemas: number;
    archivosConProblemas: ResumenDiagnosticoArchivo[];
}

/*
 * Escanea TODOS los archivos CSS del proyecto, no solo los abiertos
 * Retorna el total de diagnósticos encontrados
 * La colección y el analizador llegan por parámetro: el escaneo no guarda estado propio
 * y usa la misma colección que el provider.
 */
export async function escanearTodoElProyecto(
    coleccion: vscode.DiagnosticCollection,
    actualizarDiagnosticos: (documento: vscode.TextDocument) => Promise<void>,
    onProgress?: (actual: number, total: number, rutaArchivo: string) => void
): Promise<ResultadoEscaneoProyecto> {
    const configService = obtenerConfigService();
    const excluidos = configService.obtenerPatronesExcluidos();
    const patronExclusion = excluidos.length > 0 ? `{${excluidos.join(',')}}` : '**/node_modules/**';

    /* Buscar archivos CSS */
    const patronesCss = DEFAULT_CSS_PATTERNS;
    const patronesReact = DEFAULT_REACT_PATTERNS;
    const todosPatrones = [...patronesCss, ...patronesReact];

    let totalDiagnosticos = 0;
    const archivosVisitados = new Set<string>();
    const resumenPorArchivo = new Map<string, ResumenDiagnosticoArchivo>();

    const urisUnicos = new Map<string, vscode.Uri>();

    for (const patron of todosPatrones) {
        const archivos = await vscode.workspace.findFiles(patron, patronExclusion);
        for (const uri of archivos) {
            urisUnicos.set(uri.fsPath, uri);
        }
    }

    const archivosPorProcesar = Array.from(urisUnicos.values());
    const totalArchivos = archivosPorProcesar.length;
    let archivosProcesados = 0;

    for (const uri of archivosPorProcesar) {
        const ruta = uri.fsPath;

        if (archivosVisitados.has(ruta)) {
            continue;
        }

        archivosVisitados.add(ruta);

        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await actualizarDiagnosticos(doc);
            const diags = coleccion.get(doc.uri);
            if (diags) {
                totalDiagnosticos += diags.length;

                if (diags.length > 0) {
                    let errores = 0;
                    let warnings = 0;
                    let informacion = 0;
                    let hints = 0;

                    for (const diag of diags) {
                        switch (diag.severity) {
                            case vscode.DiagnosticSeverity.Error:
                                errores++;
                                break;
                            case vscode.DiagnosticSeverity.Warning:
                                warnings++;
                                break;
                            case vscode.DiagnosticSeverity.Information:
                                informacion++;
                                break;
                            case vscode.DiagnosticSeverity.Hint:
                                hints++;
                                break;
                        }
                    }

                    const ejemplos = diags
                        .slice(0, 3)
                        .map(diag => `L${diag.range.start.line + 1}: ${diag.message}`);

                    resumenPorArchivo.set(ruta, {
                        uri: doc.uri,
                        ruta,
                        total: diags.length,
                        errores,
                        warnings,
                        informacion,
                        hints,
                        ejemplos
                    });
                }
            }
        } catch {
            /* Ignorar archivos que no se pueden abrir */
        } finally {
            archivosProcesados++;
            if (onProgress) {
                onProgress(archivosProcesados, totalArchivos, ruta);
            }
        }
    }

    const archivosConProblemas = Array.from(resumenPorArchivo.values()).sort((a, b) => {
        if (b.errores !== a.errores) {
            return b.errores - a.errores;
        }

        return b.total - a.total;
    });

    return {
        totalDiagnosticos,
        totalArchivosAnalizados: archivosVisitados.size,
        totalArchivosConProblemas: archivosConProblemas.length,
        archivosConProblemas
    };
}
