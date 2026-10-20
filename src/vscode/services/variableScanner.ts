/*
 * Escáner de variables CSS
 * Escanea archivos del workspace para construir índice de variables definidas
 * Implementa caché para optimización de rendimiento
 */

import * as vscode from 'vscode';
import { CssVariable, VariableIndex, CacheState, ScannerStatistics } from '@/types';
import { debounce } from '@/vscode/utils/fileUtils';
import { obtenerConfigService } from '@/vscode/services/configService';
import { VscodeDocumentProvider, VscodeFileWatcherProvider, VscodeWorkspaceFileProvider } from '@/vscode/vscodeAdapter';
import { VariableIndexBuilder } from '@/core/indices/variableIndexBuilder';
import { logger } from '@/utils/logger';
import { FileWatcher, FileWatcherProvider, WorkspaceFile } from '@/core/proveedores/workspaceProviders';
import { parserCssVarsense } from '@/parsers';
import * as busqueda from './variableBusqueda';
import { crearObservadoresVariables } from './variableWatchers';
import { actualizarArchivoEnCache, eliminarArchivoDeCache } from './variableActualizacion';

/*
 * Patrones glob para escanear todos los archivos CSS del proyecto
 */
const PATRONES_CSS_GLOBALES = ['**/*.css', '**/*.scss', '**/*.less'];

/*
 * Clase principal del escáner de variables
 * Singleton para mantener caché consistente
 */
export class VariableScanner {
    private static _instancia: VariableScanner;

    /* Constantes de configuración y escaneo */
    private static readonly MAX_CONCURRENT = 10;
    private static readonly DEBOUNCE_WATCHER_MS = 500;

    private _cache!: CacheState;
    private _fileWatcherDisposables: FileWatcher[] = [];
    private _globalDisposables: vscode.Disposable[] = [];
    private _onVariablesChange: vscode.EventEmitter<void>;
    private readonly _indexBuilder: VariableIndexBuilder;
    private readonly _fileWatcherProvider: FileWatcherProvider;
    private _escaneando: boolean = false;

    public readonly onVariablesChange: vscode.Event<void>;

    private constructor() {
        this._onVariablesChange = new vscode.EventEmitter<void>();
        this.onVariablesChange = this._onVariablesChange.event;
        this._indexBuilder = new VariableIndexBuilder(
            new VscodeWorkspaceFileProvider(),
            new VscodeDocumentProvider(), parserCssVarsense
        );
        this._fileWatcherProvider = new VscodeFileWatcherProvider();

        this.reiniciarEstadoCache();
        this.configurarFileWatchers();
        this.configurarListenersGlobales();
    }

    /*
     * Obtiene la instancia singleton
     */
    public static obtenerInstancia(): VariableScanner {
        if (!VariableScanner._instancia) {
            VariableScanner._instancia = new VariableScanner();
        }
        return VariableScanner._instancia;
    }

    /*
     * Escanea todos los archivos de variables configurados
     * Construye un índice temporal y lo intercambia atómicamente
     * para evitar que consumidores lean un caché parcialmente vacío
     */
    public async escanear(forzar: boolean = false): Promise<VariableIndex> {
        /* Evitar escaneos concurrentes */
        if (this._escaneando) {
            return this._cache.indice;
        }

        /* Usar caché si es válido y no se fuerza */
        if (this._cache.valido && !forzar) {
            return this._cache.indice;
        }

        this._escaneando = true;

        try {
            const configService = obtenerConfigService();
            const excluidos = configService.obtenerPatronesExcluidos();

            /*
             * Si scanAllFiles está habilitado, escanear TODOS los archivos CSS del proyecto.
             * Caso contrario, usar solo los patrones de variableFiles.
             */
            const patrones = configService.debeEscanearTodos()
                ? PATRONES_CSS_GLOBALES
                : configService.obtenerPatronesVariables();

            const resultado = await this._indexBuilder.build({
                patterns: patrones,
                exclude: excluidos,
                maxConcurrent: VariableScanner.MAX_CONCURRENT
            });

            /* Swap atómico: reemplazar el caché de una sola vez */
            this._cache.indice = resultado.indice;
            this._cache.variablesPorArchivo = resultado.variablesPorArchivo;
            this._cache.valido = true;

            /* Notificar cambios */
            this._onVariablesChange.fire();

            logger.info(`Escaneadas ${resultado.indice.variables.size} variables de ${resultado.indice.archivosEscaneados.length} archivos`);
        } catch (error) {
            logger.error('Error escaneando variables:', error);
        } finally {
            this._escaneando = false;
        }

        return this._cache.indice;
    }

    /*
     * Actualiza el caché cuando un archivo cambia (actualización incremental)
     */
    private async actualizarArchivo(file: WorkspaceFile): Promise<void> {
        await actualizarArchivoEnCache(this._cache, this._indexBuilder, file);
        this._onVariablesChange.fire();
    }

    /*
     * Elimina un archivo del caché completamente
     */
    private eliminarArchivo(file: WorkspaceFile): void {
        if (eliminarArchivoDeCache(this._cache, this._indexBuilder, file)) {
            this._onVariablesChange.fire();
        }
    }

    /*
     * Configura watchers para archivos de variables (file system)
     * Esta función puede ser llamada múltiples veces al cambiar la configuración
     */
    private configurarFileWatchers(): void {
        /* Limpiar watchers previos */
        this._fileWatcherDisposables.forEach(d => d.dispose());

        const configService = obtenerConfigService();
        const patrones = configService.obtenerPatronesVariables();

        /* Crear función debounced para actualizaciones */
        const actualizarDebounced = debounce((...args: unknown[]) => {
            const file = args[0] as WorkspaceFile;
            void this.actualizarArchivo(file);
        }, VariableScanner.DEBOUNCE_WATCHER_MS);

        this._fileWatcherDisposables = crearObservadoresVariables(this._fileWatcherProvider, patrones, {
            onCreate: file => {
                void this.actualizarArchivo(file);
            },
            onChange: file => actualizarDebounced(file),
            onDelete: file => this.eliminarArchivo(file),
            /* Cambio de rama Git: el índice anterior ya no es válido */
            onCambioRama: () => {
                logger.info('Cambio en Git detectado. Limpiando caché...');
                this.limpiarCache();
                void this.escanear(true);
            }
        });
    }

    /*
     * Configura listeners globales que solo deben inicializarse una vez
     * (onConfigChange se suscribe una sola vez y reconfigura los file watchers)
     */
    private configurarListenersGlobales(): void {
        const configService = obtenerConfigService();

        this._globalDisposables.push(
            configService.onConfigChange(() => {
                /* Invalidar caché */
                this._cache.valido = false;

                /* Re-configurar solo los file watchers */
                this.configurarFileWatchers();

                /* Re-escanear */
                void this.escanear(true);
            })
        );
    }

    /*
     * Reinicia el estado interno del caché
     */
    private reiniciarEstadoCache(): void {
        this._cache = {
            valido: false,
            indice: {
                variables: new Map(),
                ultimaActualizacion: 0,
                archivosEscaneados: []
            },
            variablesPorArchivo: new Map()
        };
    }

    /*
     * Limpia completamente el caché y notifica
     */
    public limpiarCache(): void {
        this.reiniciarEstadoCache();
        this._onVariablesChange.fire();
    }

    /*
     * Obtiene una variable por nombre
     */
    public obtenerVariable(nombre: string): CssVariable | undefined {
        return this._cache.indice.variables.get(nombre);
    }

    /*
     * Obtiene todas las variables del índice
     */
    public obtenerTodasVariables(): CssVariable[] {
        return Array.from(this._cache.indice.variables.values());
    }

    /*
     * Busca variables que contengan un texto en su nombre
     */
    public buscarVariables(busquedaTexto: string): CssVariable[] {
        return busqueda.buscarPorNombre(this._cache.indice.variables.values(), busquedaTexto);
    }

    /*
     * Busca variables que coincidan con palabras clave
     */
    public buscarPorPalabrasClave(palabrasClave: string[]): CssVariable[] {
        return busqueda.buscarPorPalabrasClave(this._cache.indice.variables.values(), palabrasClave);
    }

    /*
     * Busca variables similares a un nombre dado (usado para sugerencias)
     */
    public buscarSimilares(
        nombreBuscado: string,
        limite: number = busqueda.DEFAULT_SUGGESTION_LIMIT
    ): CssVariable[] {
        return busqueda.buscarSimilares(this._cache.indice.variables.values(), nombreBuscado, limite);
    }

    /*
     * Obtiene variables ordenadas por frecuencia de uso
     */
    public obtenerVariablesOrdenadas(): CssVariable[] {
        return busqueda.ordenarPorUso(this.obtenerTodasVariables());
    }

    /*
     * Obtiene el índice de variables actual
     */
    public obtenerIndice(): VariableIndex {
        return this._cache.indice;
    }

    /*
     * Obtiene estadísticas del escáner
     */
    public obtenerEstadisticas(): ScannerStatistics {
        return {
            totalVariables: this._cache.indice.variables.size,
            archivosEscaneados: this._cache.indice.archivosEscaneados.length,
            ultimaActualizacion: new Date(this._cache.indice.ultimaActualizacion)
        };
    }

    /*
     * Libera recursos
     */
    public dispose(): void {
        this._fileWatcherDisposables.forEach(d => d.dispose());
        this._globalDisposables.forEach(d => d.dispose());
        this._onVariablesChange.dispose();
    }
}
