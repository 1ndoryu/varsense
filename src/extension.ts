/*
 * Punto de entrada principal de la extensión CSS Variables Validator
 * Coordina la activación de todos los providers y servicios
 */

import * as vscode from 'vscode';
import { DiagnosticProvider, DiagnosticCodeActionProvider, ResultadoEscaneoProyecto } from '@/providers/diagnosticProvider';
import { crearHoverProvider } from '@/providers/hoverProvider';
import { crearCompletionProvider } from '@/providers/completionProvider';
import { VariableScanner } from '@/services/variableScanner';
import { obtenerConfigService, estaExtensionHabilitada } from '@/services/configService';
import { CssVariable, DiagnosticType } from '@/types';
import { escanearClasesHuerfanas, ResultadoClasesHuerfanas } from '@/services/classScanner';

/*
 * Colección de disposables para limpieza
 */
let disposables: vscode.Disposable[] = [];
let diagnosticProvider: DiagnosticProvider | null = null;
let canalSalida: vscode.OutputChannel | null = null;
let coleccionHuerfanas: vscode.DiagnosticCollection | null = null;

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

        coleccionHuerfanas = vscode.languages.createDiagnosticCollection('cssVarsOrphanClasses');
        contexto.subscriptions.push(coleccionHuerfanas);
        
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

    /* Limpiar coleccion de huerfanas */
    if (coleccionHuerfanas) {
        coleccionHuerfanas.dispose();
        coleccionHuerfanas = null;
    }
    
    /* Limpiar servicios singleton */
    VariableScanner.obtenerInstancia().dispose();
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
    VariableScanner.obtenerInstancia();
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

    /* Comando: Exportar errores a archivo */
    contexto.subscriptions.push(
        vscode.commands.registerCommand('cssVarsValidator.exportReport', async () => {
            await comandoExportarReporte();
        })
    );

    /* Comando: Detectar clases CSS huerfanas */
    contexto.subscriptions.push(
        vscode.commands.registerCommand('cssVarsValidator.scanOrphanClasses', async () => {
            await comandoDetectarClasesHuerfanas();
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
            await VariableScanner.obtenerInstancia().escanear(true);
        }
    );
    
    const duracion = Date.now() - inicio;
    const stats = VariableScanner.obtenerInstancia().obtenerEstadisticas();
    
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
            
            await VariableScanner.obtenerInstancia().escanear(true);
            
            const stats = VariableScanner.obtenerInstancia().obtenerEstadisticas();
            
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
            await VariableScanner.obtenerInstancia().escanear(true);

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
            VariableScanner.obtenerInstancia().limpiarCache();

            /* Limpiar diagnósticos */
            if (diagnosticProvider) {
                diagnosticProvider.limpiar();
            }

            progress.report({ message: 'Re-escaneando variables...' });
            await VariableScanner.obtenerInstancia().escanear(true);

            /* Actualizar diagnósticos en documentos abiertos */
            if (diagnosticProvider) {
                await diagnosticProvider.actualizarTodosDocumentos();
            }

            const stats = VariableScanner.obtenerInstancia().obtenerEstadisticas();
            vscode.window.showInformationMessage(
                `CSS Vars: Caché limpiado. ${stats.totalVariables} variables re-escaneadas de ${stats.archivosEscaneados} archivos`
            );
        }
    );
}

/*
 * Comando: Exportar reporte de errores a archivo markdown
 * Similar a lo que hace Code Sentinel con .sentinel-report.md
 */
async function comandoExportarReporte(): Promise<void> {
    if (!diagnosticProvider) {
        vscode.window.showWarningMessage('CSS Vars: Provider de diagnosticos no inicializado.');
        return;
    }

    const provider = diagnosticProvider;
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

/*
 * Comando: Detectar clases CSS definidas pero no usadas en el proyecto
 * Escanea todos los CSS para definiciones, cruza con TSX/JSX/PHP/HTML para uso
 * Muestra diagnosticos en los archivos CSS donde se definen las clases huerfanas
 */
async function comandoDetectarClasesHuerfanas(): Promise<void> {
    if (!coleccionHuerfanas) {
        vscode.window.showWarningMessage('CSS Vars: Coleccion de diagnosticos de huerfanas no inicializada.');
        return;
    }

    const config = vscode.workspace.getConfiguration('cssVarsValidator');
    const excluidos = config.get<string[]>('excludePatterns', [
        '**/node_modules/**', '**/vendor/**', '**/*.min.css', '**/dist/**', '**/build/**'
    ]);
    const longitudMinima = config.get<number>('orphanClassDetection.minClassLength', 3);
    const patronesExcluidos = config.get<string[]>('orphanClassDetection.excludeClassPatterns', []);

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
                }
            );
        }
    );

    if (!resultado) {
        return;
    }

    const res = resultado as ResultadoClasesHuerfanas;

    /* Crear diagnosticos en los archivos CSS donde se definen las clases huerfanas */
    coleccionHuerfanas.clear();
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
        coleccionHuerfanas.set(vscode.Uri.file(archivo), diags);
    }

    /* Escribir reporte en el output channel */
    if (canalSalida) {
        canalSalida.clear();
        canalSalida.appendLine('=== CSS Vars Validator · Clases CSS Huerfanas ===');
        canalSalida.appendLine(`Clases definidas: ${res.totalClasesDefinidas}`);
        canalSalida.appendLine(`Clases usadas: ${res.totalClasesUsadas}`);
        canalSalida.appendLine(`Clases huerfanas: ${res.totalClasesHuerfanas}`);
        canalSalida.appendLine(`Archivos CSS analizados: ${res.archivosAnalizadosCss}`);
        canalSalida.appendLine(`Archivos consumidores analizados: ${res.archivosAnalizadosConsumo}`);
        canalSalida.appendLine(`Tiempo: ${res.tiempoMs}ms`);
        canalSalida.appendLine('');

        if (res.clasesHuerfanas.length > 0) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const rutaBase = workspaceFolders ? workspaceFolders[0].uri.fsPath.replace(/\\/g, '/') : '';

            let archivoActual = '';
            for (const clase of res.clasesHuerfanas) {
                const rutaRelativa = rutaBase
                    ? clase.archivo.replace(/\\/g, '/').replace(rutaBase + '/', '')
                    : clase.archivo;

                if (rutaRelativa !== archivoActual) {
                    canalSalida.appendLine(`\n--- ${rutaRelativa} ---`);
                    archivoActual = rutaRelativa;
                }
                canalSalida.appendLine(`  L${clase.linea + 1}: .${clase.nombre}  (${clase.selector})`);
            }
        } else {
            canalSalida.appendLine('Sin clases huerfanas detectadas. El proyecto esta limpio.');
        }
    }

    /* Mostrar notificacion con resultado */
    const mensaje = `CSS Vars: ${res.totalClasesHuerfanas} clase(s) huerfana(s) de ${res.totalClasesDefinidas} definida(s) [${res.tiempoMs}ms]`;

    if (res.totalClasesHuerfanas === 0) {
        vscode.window.showInformationMessage(mensaje);
    } else {
        vscode.window.showWarningMessage(mensaje, 'Ver reporte').then(accion => {
            if (accion === 'Ver reporte' && canalSalida) {
                canalSalida.show(true);
            }
        });
    }
}
