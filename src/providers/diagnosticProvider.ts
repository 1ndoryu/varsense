/*
 * Provider de diagnósticos CSS
 * Detecta errores y warnings relacionados con variables CSS
 * - Variables no definidas (error)
 * - Valores hardcodeados (warning)
 * - Fallbacks hardcodeados (warning)
 * Los quick fixes viven en diagnosticCodeActions.ts
 */

import * as vscode from 'vscode';
import {DiagnosticType} from '@/types';
import {VariableScanner} from '@/services/variableScanner';
import {obtenerConfigService} from '@/services/configService';
import {esLenguajeSoportado, debounce, coincideConPatron} from '@/utils/fileUtils';
import { analyzeVarsenseDocument } from '@/core/analyzeDocument';
import { CoreFinding } from '@/core/types';
import { configuracionAnalisisDesdeExtension, documentFromVsCode, findingToDiagnostic } from '@/vscode/vscodeAdapter';
import { parserCssVarsense } from '@/parsers';
import { registrarMetadataDiagnostico } from '@/providers/diagnosticMetadata';

/*
 * Lenguajes React para detección de inline CSS
 */
const LENGUAJES_REACT = ['typescriptreact', 'javascriptreact'];

/*
 * Nombre de la colección de diagnósticos
 */
const DIAGNOSTIC_COLLECTION_NAME = 'cssVarsValidator';

/*
 * Resumen de diagnósticos por archivo durante escaneo global
 */
export interface ResumenDiagnosticoArchivo {
    uri: vscode.Uri;
    ruta: string;
    total: number;
    errores: number;
    warnings: number;
    informacion: number;
    hints: number;
    ejemplos: string[];
}

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
 * Provider de diagnósticos
 */
export class DiagnosticProvider {
    private _coleccion: vscode.DiagnosticCollection;
    private _disposables: vscode.Disposable[] = [];

    constructor() {
        this._coleccion = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_COLLECTION_NAME);
        this.configurarListeners();
    }

    /*
     * Verifica si el documento es soportado (CSS o React)
     */
    private esDocumentoSoportado(doc: vscode.TextDocument): boolean {
        const lenguajeSoportado = esLenguajeSoportado(doc) || LENGUAJES_REACT.includes(doc.languageId);

        if (!lenguajeSoportado) {
            return false;
        }

        const configService = obtenerConfigService();
        const ruta = doc.uri.fsPath;
        const incluidos = configService.obtenerPatronesIncluidos();
        const excluidos = configService.obtenerPatronesExcluidos();

        if (incluidos.length > 0 && !coincideConPatron(ruta, incluidos)) {
            return false;
        }

        if (coincideConPatron(ruta, excluidos)) {
            return false;
        }

        return true;
    }

    /*
     * Configura los listeners para actualizar diagnósticos
     */
    private configurarListeners(): void {
        /* Actualizar diagnósticos cuando se abre un documento */
        this._disposables.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                if (this.esDocumentoSoportado(doc)) {
                    void this.actualizarDiagnosticos(doc);
                }
            })
        );

        /* Actualizar diagnósticos cuando se edita un documento (con debounce) */
        const actualizarDebounced = debounce((...args: unknown[]) => {
            const doc = args[0] as vscode.TextDocument;
            if (this.esDocumentoSoportado(doc)) {
                void this.actualizarDiagnosticos(doc);
            }
        }, 500);

        this._disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                actualizarDebounced(e.document);
            })
        );

        /* Limpiar diagnósticos cuando se cierra un documento */
        this._disposables.push(
            vscode.workspace.onDidCloseTextDocument(doc => {
                this._coleccion.delete(doc.uri);
            })
        );

        /* [124A-AUDIT1] Debounce para evitar event storm cuando muchos archivos cambian
         * Variables changing fires once per file update; without debounce 50 file changes
         * would trigger 50 × (all open docs) update cycles */
        const actualizarTodosDebounced = debounce(() => {
            void this.actualizarTodosDocumentos();
        }, 1000);

        /* Actualizar todos los documentos cuando cambian las variables */
        this._disposables.push(
            VariableScanner.obtenerInstancia().onVariablesChange(() => {
                actualizarTodosDebounced();
            })
        );

        /* Actualizar cuando cambia la configuración */
        this._disposables.push(
            obtenerConfigService().onConfigChange(() => {
                void this.actualizarTodosDocumentos();
            })
        );
    }

    /*
     * Actualiza diagnósticos para un documento específico.
     * El análisis lo hace el core (analyzeVarsenseDocument), igual que CLI y LSP:
     * aquí solo se aplican las puertas de la extensión y se traducen los hallazgos.
     */
    public async actualizarDiagnosticos(documento: vscode.TextDocument): Promise<void> {
        const configService = obtenerConfigService();

        if (!this.esDocumentoSoportado(documento)) {
            this._coleccion.delete(documento.uri);
            return;
        }

        /* Verificar si la extensión está habilitada */
        if (!configService.estaHabilitada()) {
            this._coleccion.delete(documento.uri);
            return;
        }

        /* Solo CSS necesita el índice al día; React no usa variables y no escanea */
        const scanner = VariableScanner.obtenerInstancia();
        const indice = LENGUAJES_REACT.includes(documento.languageId)
            ? scanner.obtenerIndice()
            : await scanner.escanear();

        const hallazgos = analyzeVarsenseDocument(
            documentFromVsCode(documento),
            indice,
            configuracionAnalisisDesdeExtension(configService.obtenerConfig()), parserCssVarsense
        );

        this._coleccion.set(documento.uri, hallazgos.map(hallazgo => this.diagnosticoDesdeHallazgo(hallazgo)));
    }

    /*
     * Convierte un hallazgo del core en diagnóstico de VS Code. La fuente debe ser
     * 'CSS Vars Validator': el quick fix filtra por ella.
     */
    private diagnosticoDesdeHallazgo(hallazgo: CoreFinding): vscode.Diagnostic {
        const diagnostic = findingToDiagnostic(hallazgo);
        diagnostic.source = 'CSS Vars Validator';

        /* El quick fix de valores hardcodeados necesita propiedad y valor */
        if (hallazgo.ruleId === DiagnosticType.ValorHardcoded) {
            registrarMetadataDiagnostico(diagnostic, {
                propiedad: String(hallazgo.metadata?.property ?? ''),
                valor: String(hallazgo.metadata?.value ?? ''),
            });
        }

        return diagnostic;
    }

    /*
     * Actualiza diagnósticos en todos los documentos abiertos
     */
    public async actualizarTodosDocumentos(): Promise<void> {
        const documentos = vscode.workspace.textDocuments;

        for (const doc of documentos) {
            if (esLenguajeSoportado(doc) || LENGUAJES_REACT.includes(doc.languageId)) {
                await this.actualizarDiagnosticos(doc);
            }
        }
    }

    /*
     * Escanea TODOS los archivos CSS del proyecto, no solo los abiertos
     * Retorna el total de diagnósticos encontrados
     */
    public async escanearTodoElProyecto(
        onProgress?: (actual: number, total: number, rutaArchivo: string) => void
    ): Promise<ResultadoEscaneoProyecto> {
        const configService = obtenerConfigService();
        const excluidos = configService.obtenerPatronesExcluidos();
        const patronExclusion = excluidos.length > 0 ? `{${excluidos.join(',')}}` : '**/node_modules/**';

        /* Buscar archivos CSS */
        const patronesCss = ['**/*.css', '**/*.scss', '**/*.less'];
        const patronesReact = ['**/*.tsx', '**/*.jsx'];
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
                await this.actualizarDiagnosticos(doc);
                const diags = this._coleccion.get(doc.uri);
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

    /*
     * Obtiene la colección de diagnósticos
     */
    public obtenerColeccion(): vscode.DiagnosticCollection {
        return this._coleccion;
    }

    /*
     * Limpia todos los diagnósticos
     */
    public limpiar(): void {
        this._coleccion.clear();
    }

    /*
     * Libera recursos
     */
    public dispose(): void {
        this._coleccion.dispose();
        this._disposables.forEach(d => d.dispose());
    }
}
