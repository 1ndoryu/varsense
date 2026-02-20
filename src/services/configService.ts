/*
 * Servicio de configuración de la extensión
 * Gestiona la lectura y actualización de settings del usuario
 */

import * as vscode from 'vscode';
import { ExtensionConfig, HardcodedDetectionConfig, InlineDetectionConfig, SEVERITY_MAP } from '../types';

/*
 * Nombre de la sección de configuración en VS Code
 */
const CONFIG_SECTION = 'cssVarsValidator';

/*
 * Configuración por defecto
 */
const DEFAULT_CONFIG: ExtensionConfig = {
    habilitado: true,
    archivosVariables: [
        '**/variables.css',
        '**/vars.css',
        '**/_variables.scss',
        '**/tokens.css'
    ],
    patronesIncluidos: ['**/*'],
    deteccionHardcoded: {
        habilitado: true,
        severidad: vscode.DiagnosticSeverity.Warning,
        propiedades: {
            'font-size': true,
            'color': true,
            'background-color': true,
            'background': true,
            'border-color': true,
            'margin': false,
            'padding': false,
            'gap': false,
            'border-radius': false
        },
        valoresPermitidos: [
            '0', 'auto', 'inherit', 'initial', 'unset', 'none',
            '100%', '50%', 'transparent', 'currentColor'
        ]
    },
    deteccionInline: {
        habilitado: true,
        severidad: vscode.DiagnosticSeverity.Error
    },
    sugerenciasContextuales: {
        'font-size': ['font', 'size', 'fs', 'text', 'tipo'],
        'font-family': ['font', 'family', 'tipo'],
        'font-weight': ['font', 'weight', 'fw'],
        'line-height': ['line', 'height', 'lh'],
        'color': ['color', 'clr', 'text', 'primary', 'secondary'],
        'background-color': ['bg', 'background', 'fondo'],
        'background': ['bg', 'background', 'fondo'],
        'border-color': ['border', 'borde', 'color'],
        'border-radius': ['radius', 'round', 'borde'],
        'gap': ['space', 'gap', 'espacio'],
        'margin': ['space', 'margin', 'espacio'],
        'padding': ['space', 'padding', 'espacio'],
        'width': ['width', 'size', 'ancho'],
        'height': ['height', 'size', 'alto'],
        'box-shadow': ['shadow', 'sombra'],
        'z-index': ['z', 'index', 'layer'],
        'transition': ['transition', 'duration', 'ease'],
        'opacity': ['opacity', 'alpha']
    },
    patronesExcluidos: [
        '**/node_modules/**',
        '**/vendor/**',
        '**/*.min.css',
        '**/dist/**',
        '**/build/**'
    ],
    escanearTodosArchivos: false
};

/*
 * Servicio singleton para manejar la configuración
 */
class ConfigService {
    private static _instancia: ConfigService;
    private _config: ExtensionConfig;
    private _disposables: vscode.Disposable[] = [];
    private _onConfigChange: vscode.EventEmitter<ExtensionConfig>;
    
    public readonly onConfigChange: vscode.Event<ExtensionConfig>;
    
    private constructor() {
        this._config = this.cargarConfiguracion();
        this._onConfigChange = new vscode.EventEmitter<ExtensionConfig>();
        this.onConfigChange = this._onConfigChange.event;
        
        /* Escuchar cambios en la configuración */
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration(CONFIG_SECTION)) {
                    this._config = this.cargarConfiguracion();
                    this._onConfigChange.fire(this._config);
                }
            })
        );
    }
    
    /*
     * Obtiene la instancia singleton del servicio
     */
    public static obtenerInstancia(): ConfigService {
        if (!ConfigService._instancia) {
            ConfigService._instancia = new ConfigService();
        }
        return ConfigService._instancia;
    }
    
    /*
     * Obtiene la configuración actual
     */
    public obtenerConfig(): ExtensionConfig {
        return this._config;
    }
    
    /*
     * Verifica si la extensión está habilitada
     */
    public estaHabilitada(): boolean {
        return this._config.habilitado;
    }
    
    /*
     * Obtiene los patrones de archivos de variables
     */
    public obtenerPatronesVariables(): string[] {
        return this._config.archivosVariables;
    }

    /*
     * Obtiene los patrones de inclusión de archivos
     */
    public obtenerPatronesIncluidos(): string[] {
        return this._config.patronesIncluidos;
    }
    
    /*
     * Obtiene la configuración de detección de hardcoded
     */
    public obtenerConfigHardcoded(): HardcodedDetectionConfig {
        return this._config.deteccionHardcoded;
    }
    
    /*
     * Obtiene las sugerencias contextuales para una propiedad
     */
    public obtenerSugerenciasParaPropiedad(propiedad: string): string[] {
        return this._config.sugerenciasContextuales[propiedad] || [];
    }
    
    /*
     * Obtiene todos los mapeos de sugerencias contextuales
     */
    public obtenerTodasSugerencias(): Record<string, string[]> {
        return this._config.sugerenciasContextuales;
    }
    
    /*
     * Obtiene la configuración de detección inline React
     */
    public obtenerConfigInline(): InlineDetectionConfig {
        return this._config.deteccionInline;
    }

    /*
     * Obtiene los patrones de exclusión
     */
    public obtenerPatronesExcluidos(): string[] {
        return this._config.patronesExcluidos;
    }
    
    /*
     * Verifica si se debe escanear todos los archivos
     */
    public debeEscanearTodos(): boolean {
        return this._config.escanearTodosArchivos;
    }
    
    /*
     * Verifica si una propiedad debe ser verificada por hardcoded
     */
    public deberiVerificarPropiedad(propiedad: string): boolean {
        if (!this._config.deteccionHardcoded.habilitado) {
            return false;
        }
        
        /* Verificar la propiedad exacta */
        if (propiedad in this._config.deteccionHardcoded.propiedades) {
            return this._config.deteccionHardcoded.propiedades[propiedad];
        }
        
        /* Verificar propiedades con prefijo (ej: margin-top -> margin) */
        const propiedadBase = propiedad.split('-')[0];
        if (propiedadBase in this._config.deteccionHardcoded.propiedades) {
            return this._config.deteccionHardcoded.propiedades[propiedadBase];
        }
        
        return false;
    }
    
    /*
     * Verifica si un valor está en la lista de permitidos
     */
    public esValorPermitido(valor: string): boolean {
        const valorNormalizado = valor.trim().toLowerCase();
        return this._config.deteccionHardcoded.valoresPermitidos.some(
            v => v.toLowerCase() === valorNormalizado
        );
    }
    
    /*
     * Carga la configuración desde VS Code
     */
    private cargarConfiguracion(): ExtensionConfig {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        
        return {
            habilitado: config.get<boolean>('enable', DEFAULT_CONFIG.habilitado),
            archivosVariables: config.get<string[]>('variableFiles', DEFAULT_CONFIG.archivosVariables),
            patronesIncluidos: config.get<string[]>('includePatterns', DEFAULT_CONFIG.patronesIncluidos),
            deteccionHardcoded: this.cargarConfigHardcoded(config),
            deteccionInline: this.cargarConfigInline(config),
            sugerenciasContextuales: config.get<Record<string, string[]>>(
                'contextualSuggestions',
                DEFAULT_CONFIG.sugerenciasContextuales
            ),
            patronesExcluidos: config.get<string[]>('excludePatterns', DEFAULT_CONFIG.patronesExcluidos),
            escanearTodosArchivos: config.get<boolean>('scanAllFiles', DEFAULT_CONFIG.escanearTodosArchivos)
        };
    }
    
    /*
     * Carga la configuración de detección de hardcoded
     */
    private cargarConfigHardcoded(config: vscode.WorkspaceConfiguration): HardcodedDetectionConfig {
        const severidadStr = config.get<string>('hardcodedDetection.severity', 'warning');
        const severidad = SEVERITY_MAP[severidadStr] ?? vscode.DiagnosticSeverity.Warning;
        
        return {
            habilitado: config.get<boolean>(
                'hardcodedDetection.enabled',
                DEFAULT_CONFIG.deteccionHardcoded.habilitado
            ),
            severidad,
            propiedades: config.get<Record<string, boolean>>(
                'hardcodedDetection.properties',
                DEFAULT_CONFIG.deteccionHardcoded.propiedades
            ),
            valoresPermitidos: config.get<string[]>(
                'hardcodedDetection.allowedValues',
                DEFAULT_CONFIG.deteccionHardcoded.valoresPermitidos
            )
        };
    }

    /*
     * Carga la configuración de detección de inline CSS en React
     */
    private cargarConfigInline(config: vscode.WorkspaceConfiguration): InlineDetectionConfig {
        const severidadStr = config.get<string>('inlineDetection.severity', 'error');
        const severidad = SEVERITY_MAP[severidadStr] ?? vscode.DiagnosticSeverity.Error;

        return {
            habilitado: config.get<boolean>(
                'inlineDetection.enabled',
                DEFAULT_CONFIG.deteccionInline.habilitado
            ),
            severidad
        };
    }
    
    /*
     * Libera recursos
     */
    public dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._onConfigChange.dispose();
    }
}

/*
 * Exporta funciones helper para acceso rápido
 */
export function obtenerConfigService(): ConfigService {
    return ConfigService.obtenerInstancia();
}

export function obtenerConfig(): ExtensionConfig {
    return ConfigService.obtenerInstancia().obtenerConfig();
}

export function estaExtensionHabilitada(): boolean {
    return ConfigService.obtenerInstancia().estaHabilitada();
}

export { ConfigService };
