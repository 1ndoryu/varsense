/*
 * Escáner de variables CSS
 * Escanea archivos del workspace para construir índice de variables definidas
 * Implementa caché para optimización de rendimiento
 */

import * as vscode from 'vscode';
import { CssVariable, VariableIndex, CacheState, ScoredVariable, ScannerStatistics } from '@/types';
import { buscarArchivos, crearFileWatcher, debounce } from '@/utils/fileUtils';
import { parsearDefiniciones } from '@/parsers/cssParser';
import { obtenerConfigService } from '@/services/configService';

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
    private static readonly SIMILARITY_EXACT_SCORE = 10;
    private static readonly SIMILARITY_PREFIX_SCORE = 5;
    private static readonly SIMILARITY_PREFIX_LENGTH = 5;
    private static readonly DEFAULT_SUGGESTION_LIMIT = 3;
    private static readonly MIN_WORD_LENGTH = 2;

    private _cache!: CacheState;
    private _fileWatcherDisposables: vscode.Disposable[] = [];
    private _globalDisposables: vscode.Disposable[] = [];
    private _onVariablesChange: vscode.EventEmitter<void>;
    private _escaneando: boolean = false;

    public readonly onVariablesChange: vscode.Event<void>;

    private constructor() {
        this._onVariablesChange = new vscode.EventEmitter<void>();
        this.onVariablesChange = this._onVariablesChange.event;

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

            /* Buscar archivos que coincidan con los patrones */
            const archivos = await buscarArchivos(patrones, excluidos);

            /* Construir índice temporal para swap atómico */
            const nuevoIndice: Map<string, CssVariable> = new Map();
            const nuevoPorArchivo: Map<string, CssVariable[]> = new Map();

            /* [124A-AUDIT1] Procesar archivos con concurrencia limitada para evitar
             * exhaustar file descriptors y generar memory spikes.
             * Antes: Promise.all(archivos.map(...)) sin límite */
            for (let i = 0; i < archivos.length; i += VariableScanner.MAX_CONCURRENT) {
                const lote = archivos.slice(i, i + VariableScanner.MAX_CONCURRENT);
                await Promise.all(lote.map(uri =>
                    this.procesarArchivoEnIndice(uri, nuevoIndice, nuevoPorArchivo)
                ));
            }

            /* Swap atómico: reemplazar el caché de una sola vez */
            this._cache.indice.variables = nuevoIndice;
            this._cache.variablesPorArchivo = nuevoPorArchivo;
            this._cache.indice.ultimaActualizacion = Date.now();
            this._cache.indice.archivosEscaneados = archivos.map(u => u.fsPath);
            this._cache.valido = true;

            /* Notificar cambios */
            this._onVariablesChange.fire();

            console.log(`[CSS Vars Validator] Escaneadas ${nuevoIndice.size} variables de ${archivos.length} archivos`);
        } catch (error) {
            console.error('[CSS Vars Validator] Error escaneando variables:', error);
        } finally {
            this._escaneando = false;
        }

        return this._cache.indice;
    }

    /*
     * Procesa un archivo individual y agrega sus variables a los mapas proporcionados
     * Usado durante el escaneo completo para construir índice temporal
     */
    private async procesarArchivoEnIndice(
        uri: vscode.Uri,
        indice: Map<string, CssVariable>,
        porArchivo: Map<string, CssVariable[]>
    ): Promise<void> {
        try {
            const documento = await vscode.workspace.openTextDocument(uri);
            const variables = parsearDefiniciones(documento);

            /* Guardar variables por archivo para invalidación parcial */
            porArchivo.set(uri.fsPath, variables);

            /* Agregar al índice global (primera definición gana) */
            for (const variable of variables) {
                if (!indice.has(variable.nombre)) {
                    indice.set(variable.nombre, variable);
                }
            }
        } catch (error) {
            console.error(`[CSS Vars Validator] Error procesando ${uri.fsPath}:`, error);
        }
    }

    /*
     * Actualiza el caché cuando un archivo cambia (actualización incremental)
     */
    private async actualizarArchivo(uri: vscode.Uri): Promise<void> {
        /* Eliminar variables antiguas de este archivo */
        this.eliminarVariablesDeArchivo(uri.fsPath);

        /* Procesar el archivo actualizado directamente en el caché vivo */
        await this.procesarArchivoEnIndice(
            uri,
            this._cache.indice.variables,
            this._cache.variablesPorArchivo
        );

        /* Actualizar timestamp */
        this._cache.indice.ultimaActualizacion = Date.now();

        /* Notificar cambios */
        this._onVariablesChange.fire();
    }

    /*
     * Elimina las variables pertenecientes a un archivo del índice
     */
    private eliminarVariablesDeArchivo(fsPath: string): void {
        const variables = this._cache.variablesPorArchivo.get(fsPath);

        if (!variables) {
            return;
        }

        for (const variable of variables) {
            /* Solo eliminar si esta es la fuente actual de la variable */
            const varActual = this._cache.indice.variables.get(variable.nombre);
            if (varActual && varActual.archivo === fsPath) {
                this._cache.indice.variables.delete(variable.nombre);
            }
        }
    }

    /*
     * Elimina un archivo del caché completamente
     */
    private eliminarArchivo(uri: vscode.Uri): void {
        const fsPath = uri.fsPath;

        if (!this._cache.variablesPorArchivo.has(fsPath)) {
            return;
        }

        this.eliminarVariablesDeArchivo(fsPath);
        this._cache.variablesPorArchivo.delete(fsPath);
        this._cache.indice.archivosEscaneados =
            this._cache.indice.archivosEscaneados.filter(f => f !== fsPath);

        /* Notificar cambios */
        this._onVariablesChange.fire();
    }

    /*
     * Configura watchers para archivos de variables (file system)
     * Esta función puede ser llamada múltiples veces al cambiar la configuración
     */
    private configurarFileWatchers(): void {
        /* Limpiar watchers previos */
        this._fileWatcherDisposables.forEach(d => d.dispose());
        this._fileWatcherDisposables = [];

        const configService = obtenerConfigService();
        const patrones = configService.obtenerPatronesVariables();

        /* Crear función debounced para actualizaciones */
        const actualizarDebounced = debounce((...args: unknown[]) => {
            const uri = args[0] as vscode.Uri;
            void this.actualizarArchivo(uri);
        }, VariableScanner.DEBOUNCE_WATCHER_MS);

        const watchers = crearFileWatcher(patrones, {
            onCrear: uri => {
                void this.actualizarArchivo(uri);
            },
            onCambiar: actualizarDebounced,
            onEliminar: uri => this.eliminarArchivo(uri)
        });

        this._fileWatcherDisposables.push(...watchers);

        /* Configurar watcher para Git change (Branch switching) */
        const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/HEAD');
        gitWatcher.onDidChange(() => {
            console.log('[CSS Vars Validator] Cambio en Git detectado. Limpiando caché...');
            this.limpiarCache();
            void this.escanear(true);
        });
        this._fileWatcherDisposables.push(gitWatcher);
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
     * Verifica si una variable existe
     */
    public existeVariable(nombre: string): boolean {
        return this._cache.indice.variables.has(nombre);
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
    public buscarVariables(busqueda: string): CssVariable[] {
        const busquedaLower = busqueda.toLowerCase();
        return this.buscar(variable => variable.nombre.toLowerCase().includes(busquedaLower));
    }

    /*
     * Busca variables que coincidan con palabras clave
     */
    public buscarPorPalabrasClave(palabrasClave: string[]): CssVariable[] {
        const palabrasLower = palabrasClave.map(p => p.toLowerCase());
        return this.buscar(variable => {
            const nombreLower = variable.nombre.toLowerCase();
            return palabrasLower.some(w => nombreLower.includes(w));
        });
    }

    /*
     * Busca variables similares a un nombre dado (usado para sugerencias)
     */
    public buscarSimilares(
        nombreBuscado: string,
        limite: number = VariableScanner.DEFAULT_SUGGESTION_LIMIT
    ): CssVariable[] {
        const nombreLower = nombreBuscado.toLowerCase();
        const palabras = nombreLower
            .replace('--', '')
            .split('-')
            .filter(p => p.length >= VariableScanner.MIN_WORD_LENGTH);

        const resultados: ScoredVariable[] = [];

        for (const variable of this._cache.indice.variables.values()) {
            const puntuacion = this.calcularPuntuacionSimilitud(variable, palabras, nombreLower);

            if (puntuacion > 0) {
                resultados.push({ variable, puntuacion });
            }
        }

        return resultados
            .sort((a, b) => b.puntuacion - a.puntuacion)
            .slice(0, limite)
            .map(r => r.variable);
    }

    /*
     * Calcula la puntuación de similitud entre una variable y un conjunto de palabras
     */
    private calcularPuntuacionSimilitud(
        variable: CssVariable,
        palabras: string[],
        nombreLower: string
    ): number {
        const varNombre = variable.nombre.toLowerCase();
        let puntuacion = 0;

        const varPalabras = varNombre.replace('--', '').split('-');
        for (const palabra of palabras) {
            for (const varPalabra of varPalabras) {
                if (varPalabra.includes(palabra) || palabra.includes(varPalabra)) {
                    puntuacion += VariableScanner.SIMILARITY_EXACT_SCORE;
                }
            }
        }

        /* Bonus por compartir prefijo */
        if (varNombre.startsWith(nombreLower.substring(0, VariableScanner.SIMILARITY_PREFIX_LENGTH))) {
            puntuacion += VariableScanner.SIMILARITY_PREFIX_SCORE;
        }

        return puntuacion;
    }

    /*
     * Función genérica de búsqueda con predicate
     */
    private buscar(predicate: (variable: CssVariable) => boolean): CssVariable[] {
        const resultados: CssVariable[] = [];
        for (const variable of this._cache.indice.variables.values()) {
            if (predicate(variable)) {
                resultados.push(variable);
            }
        }
        return resultados;
    }

    /*
     * Obtiene variables ordenadas por frecuencia de uso
     */
    public obtenerVariablesOrdenadas(): CssVariable[] {
        return this.obtenerTodasVariables().sort((a, b) => b.frecuenciaUso - a.frecuenciaUso);
    }

    /*
     * Incrementa el contador de uso de una variable
     */
    public incrementarUso(nombre: string): void {
        const variable = this._cache.indice.variables.get(nombre);
        if (variable) {
            variable.frecuenciaUso++;
        }
    }

    /*
     * Obtiene el índice de variables actual
     */
    public obtenerIndice(): VariableIndex {
        return this._cache.indice;
    }

    /*
     * Verifica si el caché está actualizado
     */
    public estaCacheValido(): boolean {
        return this._cache.valido;
    }

    /*
     * Invalida el caché forzando un re-escaneo en próxima consulta
     */
    public invalidarCache(): void {
        this._cache.valido = false;
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
