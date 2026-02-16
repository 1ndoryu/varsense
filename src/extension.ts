/*
 * Punto de entrada principal de la extensión CSS Variables Validator
 * Coordina la activación de todos los providers y servicios
 */

import * as vscode from 'vscode';
import { DiagnosticProvider, DiagnosticCodeActionProvider, ResultadoEscaneoProyecto } from './providers/diagnosticProvider';
import { crearHoverProvider } from './providers/hoverProvider';
import { crearCompletionProvider } from './providers/completionProvider';
import { obtenerScanner, escanearVariables } from './services/variableScanner';
import { obtenerConfigService, estaExtensionHabilitada } from './services/configService';
import { CssVariable, DiagnosticType } from './types';

/*
 * Colección de disposables para limpieza
 */
let disposables: vscode.Disposable[] = [];
let diagnosticProvider: DiagnosticProvider | null = null;
let canalSalida: vscode.OutputChannel | null = null;

/*
 * Función de activación de la extensión
 * Se ejecuta cuando VS Code activa la extensión
 */
export async function activate(contexto: vscode.ExtensionContext): Promise<void> {
    console.log('[CSS Vars Validator] Activando extensión...');
    
    /* Verificar si la extensión está habilitada */
    if (!estaExtensionHabilitada()) {
        console.log('[CSS Vars Validator] Extensión deshabilitada por configuración');
        return;
    }
    
    try {
        /* Inicializar servicios */
        await inicializarServicios();
        
        /* Registrar providers */
        registrarProviders(contexto);
        
        /* Registrar comandos */
        registrarComandos(contexto);

        canalSalida = vscode.window.createOutputChannel('CSS Vars Validator');
        contexto.subscriptions.push(canalSalida);
        
        /* Escanear variables inicialmente */
        await escanearVariablesInicial();
        
        /* Actualizar diagnósticos en documentos abiertos */
        if (diagnosticProvider) {
            await diagnosticProvider.actualizarTodosDocumentos();
        }
        
        console.log('[CSS Vars Validator] Extensión activada correctamente');
        
    } catch (error) {
        console.error('[CSS Vars Validator] Error durante activación:', error);
        vscode.window.showErrorMessage(
            `CSS Vars Validator: Error durante activación - ${error instanceof Error ? error.message : 'Error desconocido'}`
        );
    }
}

/*
 * Función de desactivación de la extensión
 */
export function deactivate(): void {
    console.log('[CSS Vars Validator] Desactivando extensión...');
    
    /* Limpiar todos los disposables */
    disposables.forEach(d => d.dispose());
    disposables = [];
    
    /* Limpiar diagnostic provider */
    if (diagnosticProvider) {
        diagnosticProvider.dispose();
        diagnosticProvider = null;
    }
    
    /* Limpiar servicios singleton */
    obtenerScanner().dispose();
    obtenerConfigService().dispose();
    
    console.log('[CSS Vars Validator] Extensión desactivada');
}

/*
 * Inicializa los servicios principales
 */
async function inicializarServicios(): Promise<void> {
    /* Inicializar servicio de configuración */
    obtenerConfigService();
    
    /* Inicializar scanner de variables */
    obtenerScanner();
}

/*
 * Registra los providers de VS Code
 */
function registrarProviders(contexto: vscode.ExtensionContext): void {
    /* Lenguajes soportados */
    const selectores: vscode.DocumentSelector = [
        { language: 'css', scheme: 'file' },
        { language: 'scss', scheme: 'file' },
        { language: 'less', scheme: 'file' },
        { language: 'vue', scheme: 'file' },
        { language: 'typescriptreact', scheme: 'file' },
        { language: 'javascriptreact', scheme: 'file' }
    ];
    
    /* Diagnostic Provider */
    diagnosticProvider = new DiagnosticProvider();
    disposables.push(diagnosticProvider);
    
    /* Code Action Provider (quick fixes) */
    disposables.push(
        vscode.languages.registerCodeActionsProvider(
            selectores,
            new DiagnosticCodeActionProvider(),
            {
                providedCodeActionKinds: DiagnosticCodeActionProvider.providedCodeActionKinds
            }
        )
    );
    
    /* Hover Provider */
    disposables.push(crearHoverProvider());
    
    /* Completion Provider */
    disposables.push(crearCompletionProvider());
    
    /* Agregar disposables al contexto */
    contexto.subscriptions.push(...disposables);
}

/*
 * Registra los comandos de la extensión
 */
function registrarComandos(contexto: vscode.ExtensionContext): void {
    /* Comando: Refrescar variables */
    contexto.subscriptions.push(
        vscode.commands.registerCommand('cssVarsValidator.refreshVariables', async () => {
            await comandoRefrescarVariables();
        })
    );
    
    /* Comando: Mostrar todas las variables */
    contexto.subscriptions.push(
        vscode.commands.registerCommand('cssVarsValidator.showAllVariables', async () => {
            await comandoMostrarVariables();
        })
    );
    
    /* Comando: Ir a definición de variable */
    contexto.subscriptions.push(
        vscode.commands.registerCommand('cssVarsValidator.goToDefinition', async () => {
            await comandoIrADefinicion();
        })
    );

    /* Comando: Escanear todo el proyecto */
    contexto.subscriptions.push(
        vscode.commands.registerCommand('cssVarsValidator.scanAllDiagnostics', async () => {
            await comandoEscanearTodoProyecto();
        })
    );

    /* Comando: Aplicar quick-fixes a todos los CSS */
    contexto.subscriptions.push(
        vscode.commands.registerCommand('cssVarsValidator.autoFixAllCss', async () => {
            await comandoAutoFixTodosLosCss();
        })
    );

    /* Comando: Limpiar caché */
    contexto.subscriptions.push(
        vscode.commands.registerCommand('cssVarsValidator.clearCache', async () => {
            await comandoLimpiarCache();
        })
    );
}

/*
 * Escanea variables al iniciar
 */
async function escanearVariablesInicial(): Promise<void> {
    const inicio = Date.now();
    
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Window,
            title: 'CSS Vars: Escaneando variables...',
            cancellable: false
        },
        async () => {
            await escanearVariables(true);
        }
    );
    
    const duracion = Date.now() - inicio;
    const stats = obtenerScanner().obtenerEstadisticas();
    
    console.log(`[CSS Vars Validator] Escaneo inicial completado en ${duracion}ms`);
    console.log(`[CSS Vars Validator] ${stats.totalVariables} variables en ${stats.archivosEscaneados} archivos`);
}

/*
 * Comando: Refrescar variables manualmente
 */
async function comandoRefrescarVariables(): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'CSS Vars Validator',
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Escaneando variables...' });
            
            await escanearVariables(true);
            
            const stats = obtenerScanner().obtenerEstadisticas();
            
            /* Actualizar diagnósticos */
            if (diagnosticProvider) {
                progress.report({ message: 'Actualizando diagnósticos...' });
                await diagnosticProvider.actualizarTodosDocumentos();
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
async function comandoMostrarVariables(): Promise<void> {
    const scanner = obtenerScanner();
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
async function comandoIrADefinicion(): Promise<void> {
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
            const variable = obtenerScanner().obtenerVariable(nombreVariable);
            
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
async function navegarAVariable(variable: CssVariable): Promise<void> {
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
 * Comando: Escanear todo el proyecto (archivos abiertos y cerrados)
 */
async function comandoEscanearTodoProyecto(): Promise<void> {
    let resultadoEscaneo: ResultadoEscaneoProyecto | null = null;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'CSS Vars Validator',
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Escaneando variables...' });
            await escanearVariables(true);

            progress.report({ message: 'Analizando todos los archivos del proyecto...' });

            if (diagnosticProvider) {
                resultadoEscaneo = await diagnosticProvider.escanearTodoElProyecto((actual, total, rutaArchivo) => {
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
        if (accion === 'Ver reporte' && canalSalida) {
            canalSalida.show(true);
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
function escribirReporteEnOutput(resultado: ResultadoEscaneoProyecto): void {
    if (!canalSalida) {
        return;
    }

    canalSalida.clear();
    canalSalida.appendLine('=== CSS Vars Validator · Reporte de escaneo global ===');
    canalSalida.appendLine(`Total diagnósticos: ${resultado.totalDiagnosticos}`);
    canalSalida.appendLine(`Archivos analizados: ${resultado.totalArchivosAnalizados}`);
    canalSalida.appendLine(`Archivos con problemas: ${resultado.totalArchivosConProblemas}`);
    canalSalida.appendLine('');

    for (const archivo of resultado.archivosConProblemas) {
        canalSalida.appendLine(`• ${archivo.ruta}`);
        canalSalida.appendLine(`  Total: ${archivo.total} | Errores: ${archivo.errores} | Warnings: ${archivo.warnings} | Info: ${archivo.informacion} | Hint: ${archivo.hints}`);
        for (const ejemplo of archivo.ejemplos) {
            canalSalida.appendLine(`    - ${ejemplo}`);
        }
        canalSalida.appendLine('');
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
 * Comando: aplica quick-fixes automáticos en todos los archivos CSS/SCSS/LESS con diagnósticos
 */
async function comandoAutoFixTodosLosCss(): Promise<void> {
    if (!diagnosticProvider) {
        return;
    }

    const provider = diagnosticProvider;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'CSS Vars Validator',
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Escaneando proyecto completo...' });
            await escanearVariables(true);
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

                if (porcentaje % 20 === 0 && canalSalida) {
                    canalSalida.appendLine(`[AutoFix] Progreso ${porcentaje}% · ${archivo.ruta} · fixes: ${fixesArchivo}`);
                }
            }

            progress.report({ message: 'Re-escanendo diagnósticos para validar resultados...' });
            const resultadoFinal = await provider.escanearTodoElProyecto();
            escribirReporteEnOutput(resultadoFinal);

            vscode.window.showInformationMessage(
                `CSS Vars: Auto-fix completado. ${totalFixesAplicados} quick-fix(es) aplicado(s). Restantes: ${resultadoFinal.totalDiagnosticos}`,
                'Ver reporte'
            ).then(accion => {
                if (accion === 'Ver reporte' && canalSalida) {
                    canalSalida.show(true);
                }
            });
        }
    );
}

/*
 * Aplica quick-fixes soportados para un documento específico
 */
async function aplicarQuickFixesEnDocumento(uri: vscode.Uri): Promise<number> {
    if (!diagnosticProvider) {
        return 0;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
    await diagnosticProvider.actualizarDiagnosticos(doc);

    const diagnosticos = diagnosticProvider
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
    await diagnosticProvider.actualizarDiagnosticos(editor.document);

    return fixesAplicados;
}

/*
 * Comando: Limpiar caché y re-escanear
 */
async function comandoLimpiarCache(): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'CSS Vars Validator',
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Limpiando caché...' });

            /* Limpiar caché del scanner */
            obtenerScanner().limpiarCache();

            /* Limpiar diagnósticos */
            if (diagnosticProvider) {
                diagnosticProvider.limpiar();
            }

            progress.report({ message: 'Re-escaneando variables...' });
            await escanearVariables(true);

            /* Actualizar diagnósticos en documentos abiertos */
            if (diagnosticProvider) {
                await diagnosticProvider.actualizarTodosDocumentos();
            }

            const stats = obtenerScanner().obtenerEstadisticas();
            vscode.window.showInformationMessage(
                `CSS Vars: Caché limpiado. ${stats.totalVariables} variables re-escaneadas de ${stats.archivosEscaneados} archivos`
            );
        }
    );
}
