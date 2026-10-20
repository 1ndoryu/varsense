/*
 * Punto de entrada principal de la extensión CSS Variables Validator
 * Coordina la activación de todos los providers y servicios
 */

import * as vscode from 'vscode';
import { DiagnosticProvider } from '@/vscode/providers/diagnosticProvider';
import { DiagnosticCodeActionProvider } from '@/vscode/providers/diagnosticCodeActions';
import { crearHoverProvider } from '@/vscode/providers/hoverProvider';
import { crearCompletionProvider } from '@/vscode/providers/completionProvider';
import { VariableScanner } from '@/vscode/services/variableScanner';
import { obtenerConfigService, estaExtensionHabilitada } from '@/vscode/services/configService';
import { estado } from './vscode/comandos/estado';
import { escanearVariablesInicial, comandoRefrescarVariables, comandoMostrarVariables, comandoIrADefinicion, comandoLimpiarCache } from './vscode/comandos/variables';
import { comandoEscanearTodoProyecto, comandoExportarReporte } from './vscode/comandos/proyecto';
import { comandoAutoFixTodosLosCss } from './vscode/comandos/autoFix';
import { comandoDetectarClasesHuerfanas } from './vscode/comandos/clasesHuerfanas';
import { logger } from '@/utils/logger';

/*
 * Colección de disposables para limpieza
 */
let disposables: vscode.Disposable[] = [];

/*
 * Función de activación de la extensión
 * Se ejecuta cuando VS Code activa la extensión
 */
export async function activate(contexto: vscode.ExtensionContext): Promise<void> {
    logger.info('Activando extensión...');
    
    /* Verificar si la extensión está habilitada */
    if (!estaExtensionHabilitada()) {
        logger.info('Extensión deshabilitada por configuración');
        return;
    }
    
    try {
        /* Inicializar servicios */
        await inicializarServicios();
        
        /* Registrar providers */
        registrarProviders(contexto);
        
        /* Registrar comandos */
        registrarComandos(contexto);

        estado.canalSalida = vscode.window.createOutputChannel('CSS Vars Validator');
        contexto.subscriptions.push(estado.canalSalida);

        estado.coleccionHuerfanas = vscode.languages.createDiagnosticCollection('cssVarsOrphanClasses');
        contexto.subscriptions.push(estado.coleccionHuerfanas);
        
        /* Escanear variables inicialmente */
        await escanearVariablesInicial();
        
        /* Actualizar diagnósticos en documentos abiertos */
        if (estado.diagnosticProvider) {
            await estado.diagnosticProvider.actualizarTodosDocumentos();
        }
        
        logger.info('Extensión activada correctamente');
        
    } catch (error) {
        logger.error('Error durante activación:', error);
        vscode.window.showErrorMessage(
            `CSS Vars Validator: Error durante activación - ${error instanceof Error ? error.message : 'Error desconocido'}`
        );
    }
}

/*
 * Función de desactivación de la extensión
 */
export function deactivate(): void {
    logger.info('Desactivando extensión...');
    
    /* Limpiar todos los disposables */
    disposables.forEach(d => d.dispose());
    disposables = [];
    
    /* Limpiar diagnostic provider */
    if (estado.diagnosticProvider) {
        estado.diagnosticProvider.dispose();
        estado.diagnosticProvider = null;
    }

    /* Limpiar coleccion de huerfanas */
    if (estado.coleccionHuerfanas) {
        estado.coleccionHuerfanas.dispose();
        estado.coleccionHuerfanas = null;
    }
    
    /* Limpiar servicios singleton */
    VariableScanner.obtenerInstancia().dispose();
    obtenerConfigService().dispose();
    
    logger.info('Extensión desactivada');
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
    estado.diagnosticProvider = new DiagnosticProvider();
    disposables.push(estado.diagnosticProvider);
    
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
