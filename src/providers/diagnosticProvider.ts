/*
 * Provider de diagnósticos CSS
 * Detecta errores y warnings relacionados con variables CSS
 * - Variables no definidas (error)
 * - Valores hardcodeados (warning)
 * - Fallbacks hardcodeados (warning)
 */

import * as vscode from 'vscode';
import {DiagnosticType} from '../types';
import {ParseResult, DuplicateClass} from '../types';
import {parsearDocumento} from '../parsers/cssParser';
import {existeVariable, obtenerScanner} from '../services/variableScanner';
import {obtenerConfigService} from '../services/configService';
import {esLenguajeSoportado, debounce} from '../utils/fileUtils';

/*
 * Lenguajes React para detección de inline CSS
 */
const LENGUAJES_REACT = ['typescriptreact', 'javascriptreact'];

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
     * Verifica si el documento es soportado (CSS o React)
     */
    private esDocumentoSoportado(doc: vscode.TextDocument): boolean {
        return esLenguajeSoportado(doc) || LENGUAJES_REACT.includes(doc.languageId);
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

        /* Si es un archivo React, solo buscar inline CSS */
        if (LENGUAJES_REACT.includes(documento.languageId)) {
            const diagnosticosInline = this.detectarInlineCssReact(documento);
            this._coleccion.set(documento.uri, diagnosticosInline);
            return;
        }

        /* Asegurar que el índice de variables global esté actualizado */
        await obtenerScanner().escanear();

        /* Parsear documento actual */
        const resultadoParse = parsearDocumento(documento);
        const diagnosticos: vscode.Diagnostic[] = [];

        /* 1. Detectar variables no definidas */
        const diagnosticosVariables = this.detectarVariablesNoDefinidas(resultadoParse);
        diagnosticos.push(...diagnosticosVariables);

        /* 2. Detectar valores hardcodeados */
        // Usamos los detectados por el parser directamente
        for (const hardcoded of resultadoParse.valoresHardcoded) {
            const severidad = configService.obtenerConfigHardcoded().severidad;
            const diagnostic = new vscode.Diagnostic(hardcoded.rango, `Valor hardcodeado '${hardcoded.valor}' en '${hardcoded.propiedad}' - considera usar una variable CSS`, severidad);
            diagnostic.code = DiagnosticType.ValorHardcoded;
            diagnostic.source = 'CSS Vars Validator';

            diagnosticMetadataMap.set(diagnostic, {
                propiedad: hardcoded.propiedad,
                valor: hardcoded.valor
            });

            diagnosticos.push(diagnostic);
        }

        /* 3 y 4. Detectar clases duplicadas (si está habilitado) */
        if (configService.estaDeteccionDuplicadosHabilitada()) {
            for (const duplicada of resultadoParse.clasesDuplicadas) {
                const diagnostic = new vscode.Diagnostic(duplicada.rango, `Clase duplicada '${duplicada.nombre}'. Esta clase ya está definida en este archivo.`, vscode.DiagnosticSeverity.Warning);
                diagnostic.code = DiagnosticType.ClaseDuplicada;
                diagnostic.source = 'CSS Vars Validator';
                diagnosticos.push(diagnostic);
            }

            if (configService.estaCrossFileHabilitado()) {
                const diagnosticosCrossFile = this.detectarClasesCrossFile(resultadoParse, documento);
                diagnosticos.push(...diagnosticosCrossFile);
            }
        }

        /* Establecer diagnósticos */
        this._coleccion.set(documento.uri, diagnosticos);
    }

    /*
     * Detecta usos de variables CSS que no están definidas
     */
    private detectarVariablesNoDefinidas(resultadoParse: ParseResult): vscode.Diagnostic[] {
        const diagnosticos: vscode.Diagnostic[] = [];
        const scanner = obtenerScanner();

        /* Crear Set de variables locales para búsqueda rápida */
        const variablesLocales = new Set(resultadoParse.variablesDefinidas.map(v => v.nombre));

        for (const uso of resultadoParse.usosVariables) {
            /* Verificar si la variable existe (Globalmente O Localmente) */
            if (!scanner.existeVariable(uso.nombreVariable) && !variablesLocales.has(uso.nombreVariable)) {
                const diagnostic = new vscode.Diagnostic(uso.rango, `Variable '${uso.nombreVariable}' no está definida`, vscode.DiagnosticSeverity.Error);

                diagnostic.code = DiagnosticType.VariableNoDefinida;
                diagnostic.source = 'CSS Vars Validator';

                diagnosticos.push(diagnostic);
            }

            /* Verificar fallback hardcodeado */
            // Esto ya podría venir en valoresHardcoded si el parser lo detectara así,
            // pero el parser actual separa 'usosVariables' de 'valoresHardcodeados'.
            /* Nota: Si el parser ya detectó fallbacks hardcodeados en valoresHardcoded, esto podría duplicar?
               Revisando cssParser.ts:
               for (const uso of declaracion.variablesUsadas) {
                   if (uso.fallback && esValorHardcodeado(uso.fallback)) {
                       resultado.valoresHardcoded.push(...)
               }
               ¡Sí, el parser YA agrega fallbacks hardcodeados a result.valoresHardcoded!
               Por lo tanto, NO necesitamos verificar fallbacks aquí de nuevo.
            */
        }

        return diagnosticos;
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
    public async escanearTodoElProyecto(): Promise<number> {
        const configService = obtenerConfigService();
        const excluidos = configService.obtenerPatronesExcluidos();
        const patronExclusion = excluidos.length > 0 ? `{${excluidos.join(',')}}` : '**/node_modules/**';

        /* Buscar archivos CSS */
        const patronesCss = ['**/*.css', '**/*.scss', '**/*.less'];
        const patronesReact = ['**/*.tsx', '**/*.jsx'];
        const todosPatrones = [...patronesCss, ...patronesReact];

        let totalDiagnosticos = 0;

        for (const patron of todosPatrones) {
            const archivos = await vscode.workspace.findFiles(patron, patronExclusion);
            for (const uri of archivos) {
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    await this.actualizarDiagnosticos(doc);
                    const diags = this._coleccion.get(doc.uri);
                    if (diags) {
                        totalDiagnosticos += diags.length;
                    }
                } catch {
                    /* Ignorar archivos que no se pueden abrir */
                }
            }
        }

        return totalDiagnosticos;
    }

    /*
     * Detecta clases CSS definidas en este archivo que ya existen en otro archivo del proyecto
     */
    private detectarClasesCrossFile(resultadoParse: ParseResult, documento: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnosticos: vscode.Diagnostic[] = [];
        const scanner = obtenerScanner();
        const archivoActual = documento.uri.fsPath;

        /* Obtener nombres de clase únicos del archivo actual (de las reglas parseadas) */
        const texto = documento.getText();
        const bloqueRegex = /([^{}]+)\{/g;
        let match: RegExpExecArray | null;

        while ((match = bloqueRegex.exec(texto)) !== null) {
            const selectorCompleto = match[1].trim();
            const selectores = selectorCompleto.split(',').map(s => s.trim());

            for (const sel of selectores) {
                if (/^\.[a-zA-Z0-9_-]+$/.test(sel)) {
                    const duplicadaEnOtro = scanner.buscarClaseEnOtroArchivo(sel, archivoActual);
                    if (duplicadaEnOtro) {
                        const pos = documento.positionAt(match.index);
                        const rango = new vscode.Range(pos, documento.positionAt(match.index + sel.length));
                        const archivoCorto = duplicadaEnOtro.archivo.split(/[/\\]/).pop() || duplicadaEnOtro.archivo;

                        const diagnostic = new vscode.Diagnostic(
                            rango,
                            `Clase '${sel}' ya definida en '${archivoCorto}' (línea ${duplicadaEnOtro.linea + 1})`,
                            vscode.DiagnosticSeverity.Warning
                        );
                        diagnostic.code = DiagnosticType.ClaseDuplicadaCrossFile;
                        diagnostic.source = 'CSS Vars Validator';
                        diagnosticos.push(diagnostic);
                    }
                }
            }
        }

        return diagnosticos;
    }

    /*
     * Detecta uso de CSS inline (style={{ }}) en archivos React TSX/JSX
     */
    private detectarInlineCssReact(documento: vscode.TextDocument): vscode.Diagnostic[] {
        const configService = obtenerConfigService();
        const configInline = configService.obtenerConfigInline();

        if (!configInline.habilitado) {
            return [];
        }

        const diagnosticos: vscode.Diagnostic[] = [];
        const texto = documento.getText();

        /* Patrón 1: style={{ ... }} — objeto literal inline */
        const styleObjRegex = /style\s*=\s*\{\s*\{/g;
        let match: RegExpExecArray | null;

        while ((match = styleObjRegex.exec(texto)) !== null) {
            /* Encontrar el cierre correspondiente */
            let profundidad = 2; /* ya abrimos {{ */
            let i = match.index + match[0].length;

            while (i < texto.length && profundidad > 0) {
                if (texto[i] === '{') profundidad++;
                else if (texto[i] === '}') profundidad--;
                i++;
            }

            const inicio = documento.positionAt(match.index);
            const fin = documento.positionAt(i);
            const rango = new vscode.Range(inicio, fin);

            const diagnostic = new vscode.Diagnostic(
                rango,
                'CSS inline detectado — usa clases CSS con variables en vez de style={{}}',
                configInline.severidad
            );
            diagnostic.code = DiagnosticType.CssInlineReact;
            diagnostic.source = 'CSS Vars Validator';
            diagnosticos.push(diagnostic);
        }

        /* Patrón 2: style={variable} — variable que contiene estilos */
        const styleVarRegex = /style\s*=\s*\{(?!\s*\{)([^}]+)\}/g;

        while ((match = styleVarRegex.exec(texto)) !== null) {
            /* Verificar que no sea un ternario o expresión compleja con className */
            const contenido = match[1].trim();

            /* Saltar si ya fue capturado por el patrón 1 (doble llave) */
            if (contenido.startsWith('{')) continue;

            const inicio = documento.positionAt(match.index);
            const fin = documento.positionAt(match.index + match[0].length);
            const rango = new vscode.Range(inicio, fin);

            const diagnostic = new vscode.Diagnostic(
                rango,
                `CSS inline detectado (style={${contenido}}) — usa clases CSS con variables`,
                configInline.severidad
            );
            diagnostic.code = DiagnosticType.CssInlineReact;
            diagnostic.source = 'CSS Vars Validator';
            diagnosticos.push(diagnostic);
        }

        return diagnosticos;
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
