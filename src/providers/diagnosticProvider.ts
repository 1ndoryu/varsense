/*
 * Provider de diagnósticos CSS
 * Detecta errores y warnings relacionados con variables CSS
 * - Variables no definidas (error)
 * - Valores hardcodeados (warning)
 * - Fallbacks hardcodeados (warning)
 */

import * as vscode from 'vscode';
import { DiagnosticType } from '../types';
import {buscarUsosVariables} from '../parsers/cssParser';
import {esValorHardcodeado} from '../parsers/valueParser';
import {existeVariable, obtenerScanner} from '../services/variableScanner';
import {obtenerConfigService} from '../services/configService';
import {esLenguajeSoportado, debounce} from '../utils/fileUtils';

/*
 * Nombre de la colección de diagnósticos
 */
const DIAGNOSTIC_COLLECTION_NAME = 'cssVarsValidator';

/*
 * Mapa para almacenar metadatos de diagnósticos
 * Evita el uso de propiedades no estándar en objetos Diagnostic
 */
interface DiagnosticMetadata {
    propiedad: string;
    valor: string;
}

const diagnosticMetadataMap = new WeakMap<vscode.Diagnostic, DiagnosticMetadata>();

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
                if (esLenguajeSoportado(doc)) {
                    void this.actualizarDiagnosticos(doc);
                }
            })
        );

        /* Actualizar diagnósticos cuando se edita un documento (con debounce) */
        const actualizarDebounced = debounce((...args: unknown[]) => {
            const doc = args[0] as vscode.TextDocument;
            if (esLenguajeSoportado(doc)) {
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

        /* Actualizar todos los documentos cuando cambian las variables */
        this._disposables.push(
            obtenerScanner().onVariablesChange(() => {
                void this.actualizarTodosDocumentos();
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
     * Actualiza diagnósticos para un documento específico
     */
    public async actualizarDiagnosticos(documento: vscode.TextDocument): Promise<void> {
        const configService = obtenerConfigService();

        /* Verificar si la extensión está habilitada */
        if (!configService.estaHabilitada()) {
            this._coleccion.delete(documento.uri);
            return;
        }

        const diagnosticos: vscode.Diagnostic[] = [];

        /* Detectar variables no definidas */
        const diagnosticosVariables = await this.detectarVariablesNoDefinidas(documento);
        diagnosticos.push(...diagnosticosVariables);

        /* Detectar valores hardcodeados */
        const diagnosticosHardcoded = this.detectarValoresHardcodeados(documento);
        diagnosticos.push(...diagnosticosHardcoded);

        /* Establecer diagnósticos */
        this._coleccion.set(documento.uri, diagnosticos);
    }

    /*
     * Detecta usos de variables CSS que no están definidas
     */
    private async detectarVariablesNoDefinidas(documento: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
        const diagnosticos: vscode.Diagnostic[] = [];

        /* Asegurar que el índice de variables esté actualizado */
        await obtenerScanner().escanear();

        /* Buscar todos los usos de var() en el documento */
        const usos = buscarUsosVariables(documento);

        for (const uso of usos) {
            /* Verificar si la variable existe */
            if (!existeVariable(uso.nombreVariable)) {
                const diagnostic = new vscode.Diagnostic(uso.rango, `Variable '${uso.nombreVariable}' no está definida`, vscode.DiagnosticSeverity.Error);

                diagnostic.code = DiagnosticType.VariableNoDefinida;
                diagnostic.source = 'CSS Vars Validator';

                diagnosticos.push(diagnostic);
            }

            /* Verificar fallback hardcodeado */
            if (uso.fallback && esValorHardcodeado(uso.fallback)) {
                const configService = obtenerConfigService();

                /* Verificar si el valor está permitido */
                if (!configService.esValorPermitido(uso.fallback)) {
                    const severidad = configService.obtenerConfigHardcoded().severidad;

                    const diagnostic = new vscode.Diagnostic(uso.rango, `Fallback hardcodeado '${uso.fallback}' - considera usar una variable CSS`, severidad);

                    diagnostic.code = DiagnosticType.FallbackHardcoded;
                    diagnostic.source = 'CSS Vars Validator';

                    diagnosticos.push(diagnostic);
                }
            }
        }

        return diagnosticos;
    }

    /*
     * Detecta valores hardcodeados en propiedades configuradas
     */
    private detectarValoresHardcodeados(documento: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnosticos: vscode.Diagnostic[] = [];
        const configService = obtenerConfigService();

        /* Verificar si la detección de hardcoded está habilitada */
        if (!configService.obtenerConfigHardcoded().habilitado) {
            return diagnosticos;
        }

        const texto = documento.getText();

        /*
         * Regex mejorada para detectar declaraciones CSS
         * Soporta múltiples declaraciones por línea y estilos minificados
         * Captura: propiedad y valor (sin el ;)
         */
        const declaracionRegex = /([a-zA-Z-]+)\s*:\s*([^;{}]+?)\s*(?:;|(?=}))/g;

        let match: RegExpExecArray | null;
        while ((match = declaracionRegex.exec(texto)) !== null) {
            const propiedad = match[1].trim();
            const valor = match[2].trim();
            const matchIndex = match.index;

            /* Verificar si la propiedad debe ser chequeada */
            if (!configService.deberiVerificarPropiedad(propiedad)) {
                continue;
            }

            /* Ignorar si contiene var() */
            if (valor.includes('var(')) {
                continue;
            }

            /* Verificar si el valor está permitido */
            if (configService.esValorPermitido(valor)) {
                continue;
            }

            /* Verificar si es hardcodeado */
            if (esValorHardcodeado(valor)) {
                /* Encontrar posición exacta del valor en el texto */
                const inicioValorOffset = matchIndex + match[0].indexOf(match[2]);
                const finValorOffset = inicioValorOffset + valor.length;

                const posInicio = documento.positionAt(inicioValorOffset);
                const posFin = documento.positionAt(finValorOffset);
                const rango = new vscode.Range(posInicio, posFin);

                const severidad = configService.obtenerConfigHardcoded().severidad;

                const diagnostic = new vscode.Diagnostic(
                    rango, 
                    `Valor hardcodeado '${valor}' en '${propiedad}' - considera usar una variable CSS`, 
                    severidad
                );

                diagnostic.code = DiagnosticType.ValorHardcoded;
                diagnostic.source = 'CSS Vars Validator';

                /* Almacenar metadatos usando WeakMap en lugar de propiedad .data */
                diagnosticMetadataMap.set(diagnostic, {
                    propiedad,
                    valor
                });

                diagnosticos.push(diagnostic);
            }
        }

        return diagnosticos;
    }

    /*
     * Actualiza diagnósticos en todos los documentos abiertos
     */
    public async actualizarTodosDocumentos(): Promise<void> {
        const documentos = vscode.workspace.textDocuments;

        for (const doc of documentos) {
            if (esLenguajeSoportado(doc)) {
                await this.actualizarDiagnosticos(doc);
            }
        }
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

/*
 * Crea un provider de código de acciones (quick fixes)
 */
export class DiagnosticCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    public provideCodeActions(documento: vscode.TextDocument, rango: vscode.Range | vscode.Selection, contexto: vscode.CodeActionContext, _token: vscode.CancellationToken): vscode.CodeAction[] | undefined {
        const acciones: vscode.CodeAction[] = [];

        for (const diagnostic of contexto.diagnostics) {
            /* Solo procesar diagnósticos de nuestra extensión */
            if (diagnostic.source !== 'CSS Vars Validator') {
                continue;
            }

            switch (diagnostic.code) {
                case DiagnosticType.ValorHardcoded:
                case DiagnosticType.FallbackHardcoded:
                    acciones.push(...this.crearAccionesHardcoded(documento, diagnostic));
                    break;

                case DiagnosticType.VariableNoDefinida:
                    acciones.push(...this.crearAccionesVariableNoDefinida(documento, diagnostic));
                    break;
            }
        }

        return acciones;
    }

    /*
     * Crea acciones para valores hardcodeados
     */
    private crearAccionesHardcoded(documento: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction[] {
        const acciones: vscode.CodeAction[] = [];
        
        /* Obtener metadatos desde WeakMap */
        const data = diagnosticMetadataMap.get(diagnostic);

        if (!data) {
            return acciones;
        }

        /* Buscar variables sugeridas */
        const {obtenerResolver} = require('../services/variableResolver') as typeof import('../services/variableResolver');
        const sugerencias = obtenerResolver().sugerirVariablesParaValor(data.valor, 3);

        for (const variable of sugerencias) {
            const accion = new vscode.CodeAction(`Reemplazar con var(${variable.nombre})`, vscode.CodeActionKind.QuickFix);

            accion.diagnostics = [diagnostic];
            accion.edit = new vscode.WorkspaceEdit();
            accion.edit.replace(documento.uri, diagnostic.range, `var(${variable.nombre})`);

            accion.isPreferred = sugerencias.indexOf(variable) === 0;
            acciones.push(accion);
        }

        return acciones;
    }

    /*
     * Crea acciones para variables no definidas
     */
    private crearAccionesVariableNoDefinida(documento: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction[] {
        const acciones: vscode.CodeAction[] = [];

        /* Extraer nombre de variable del mensaje */
        const nombreMatch = /Variable '(--[\w-]+)'/.exec(diagnostic.message);
        if (!nombreMatch) {
            return acciones;
        }

        const nombreVariable = nombreMatch[1];

        /* Buscar variables similares */
        const scanner = obtenerScanner();
        const todasVariables = scanner.obtenerTodasVariables();

        /* Encontrar variables con nombres similares */
        const similares = todasVariables
            .filter(v => {
                const similitud = calcularSimilitud(v.nombre, nombreVariable);
                return similitud > 0.5;
            })
            .sort((a, b) => {
                const simA = calcularSimilitud(a.nombre, nombreVariable);
                const simB = calcularSimilitud(b.nombre, nombreVariable);
                return simB - simA;
            })
            .slice(0, 3);

        for (const variable of similares) {
            const accion = new vscode.CodeAction(`¿Quisiste decir var(${variable.nombre})?`, vscode.CodeActionKind.QuickFix);

            accion.diagnostics = [diagnostic];
            accion.edit = new vscode.WorkspaceEdit();

            /* Reemplazar el nombre de la variable en var() */
            const textoLinea = documento.lineAt(diagnostic.range.start.line).text;
            const varRegex = new RegExp(`var\\(\\s*${nombreVariable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`);
            const match = varRegex.exec(textoLinea);

            if (match) {
                const inicioReemplazo = textoLinea.indexOf(match[0]);
                const finReemplazo = inicioReemplazo + match[0].length;

                accion.edit.replace(documento.uri, new vscode.Range(diagnostic.range.start.line, inicioReemplazo, diagnostic.range.start.line, finReemplazo), `var(${variable.nombre}`);
            }

            acciones.push(accion);
        }

        return acciones;
    }
}

/*
 * Calcula similitud entre dos strings (algoritmo simple)
 */
function calcularSimilitud(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
        return 1.0;
    }

    const editDistance = calcularDistanciaEdicion(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

/*
 * Calcula la distancia de edición (Levenshtein)
 */
function calcularDistanciaEdicion(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = [];

    for (let i = 0; i <= m; i++) {
        dp[i] = [i];
    }

    for (let j = 0; j <= n; j++) {
        dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(dp[i - 1][j - 1] + 1, dp[i][j - 1] + 1, dp[i - 1][j] + 1);
            }
        }
    }

    return dp[m][n];
}
