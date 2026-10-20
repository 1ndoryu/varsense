/*
 * Provider de diagnósticos CSS
 * Detecta errores y warnings relacionados con variables CSS
 * - Variables no definidas (error)
 * - Valores hardcodeados (warning)
 * - Fallbacks hardcodeados (warning)
 * Los quick fixes viven en diagnosticCodeActions.ts
 * Puertas, traducción y escaneo global viven en sus módulos hermanos de providers/
 */

import * as vscode from 'vscode';
import {VariableScanner} from '@/vscode/services/variableScanner';
import {obtenerConfigService} from '@/vscode/services/configService';
import {esLenguajeSoportado, debounce} from '@/vscode/utils/fileUtils';
import { analyzeVarsenseDocument } from '@/core/analisis/analyzeDocument';
import { configuracionAnalisisDesdeExtension, documentFromVsCode } from '@/vscode/vscodeAdapter';
import { parserCssVarsense } from '@/parsers';
import { LENGUAJES_REACT, esDocumentoSoportado, diagnosticoDesdeHallazgo } from '@/vscode/providers/puertasYTraduccionDiagnosticos';
import { escanearTodoElProyecto } from '@/vscode/providers/escaneoProyectoDiagnosticos';
import type { ResultadoEscaneoProyecto } from '@/vscode/providers/escaneoProyectoDiagnosticos';

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
 * Reexport para que los importadores sigan usando este módulo
 */
export type { ResultadoEscaneoProyecto } from '@/vscode/providers/escaneoProyectoDiagnosticos';

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
     * Configura los listeners para actualizar diagnósticos
     */
    private configurarListeners(): void {
        /* Actualizar diagnósticos cuando se abre un documento */
        this._disposables.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                if (esDocumentoSoportado(doc)) {
                    void this.actualizarDiagnosticos(doc);
                }
            })
        );

        /* Actualizar diagnósticos cuando se edita un documento (con debounce) */
        const actualizarDebounced = debounce((...args: unknown[]) => {
            const doc = args[0] as vscode.TextDocument;
            if (esDocumentoSoportado(doc)) {
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

        if (!esDocumentoSoportado(documento)) {
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

        this._coleccion.set(documento.uri, hallazgos.map(hallazgo => diagnosticoDesdeHallazgo(hallazgo)));
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
     * Escanea TODOS los archivos del proyecto (ver escaneoProyectoDiagnosticos.ts).
     * Se pasa la colección y un callback para que el escaneo use este mismo provider.
     */
    public async escanearTodoElProyecto(
        onProgress?: (actual: number, total: number, rutaArchivo: string) => void
    ): Promise<ResultadoEscaneoProyecto> {
        return escanearTodoElProyecto(
            this._coleccion,
            documento => this.actualizarDiagnosticos(documento),
            onProgress
        );
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
