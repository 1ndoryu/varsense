/*
 * Escáner de variables CSS
 * Escanea archivos del workspace para construir índice de variables definidas
 * Implementa caché para optimización de rendimiento
 */

import * as vscode from 'vscode';
import {CssVariable, VariableIndex, CacheState} from '../types';
import {buscarArchivos, crearFileWatcher, debounce} from '../utils/fileUtils';
import {parsearDefiniciones} from '../parsers/cssParser';
import {obtenerConfigService} from './configService';

/*
 * Clase principal del escáner de variables
 * Singleton para mantener caché consistente
 */
export class VariableScanner {
    private static _instancia: VariableScanner;
    private _cache: CacheState;
    private _disposables: vscode.Disposable[] = [];
    private _onVariablesChange: vscode.EventEmitter<void>;
    private _escaneando: boolean = false;

    public readonly onVariablesChange: vscode.Event<void>;

    private constructor() {
        this._cache = {
            valido: false,
            indice: {
                variables: new Map(),
                ultimaActualizacion: 0,
                archivosEscaneados: []
            },
            variablesPorArchivo: new Map()
        };

        this._onVariablesChange = new vscode.EventEmitter<void>();
        this.onVariablesChange = this._onVariablesChange.event;

        this.configurarWatchers();
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
            const patrones = configService.obtenerPatronesVariables();
            const excluidos = configService.obtenerPatronesExcluidos();

            /* Buscar archivos que coincidan con los patrones */
            const archivos = await buscarArchivos(patrones, excluidos);

            /* Limpiar caché anterior */
            this._cache.indice.variables.clear();
            this._cache.variablesPorArchivo.clear();
            this._cache.indice.archivosEscaneados = [];

            /* Procesar archivos en paralelo para mejor rendimiento */
            const promesas = archivos.map(uri => this.procesarArchivo(uri));
            await Promise.all(promesas);

            /* Actualizar metadata del caché */
            this._cache.indice.ultimaActualizacion = Date.now();
            this._cache.indice.archivosEscaneados = archivos.map(u => u.fsPath);
            this._cache.valido = true;

            /* Notificar cambios */
            this._onVariablesChange.fire();

            console.log(`[CSS Vars Validator] Escaneadas ${this._cache.indice.variables.size} variables de ${archivos.length} archivos`);
        } catch (error) {
            console.error('[CSS Vars Validator] Error escaneando variables:', error);
        } finally {
            this._escaneando = false;
        }

        return this._cache.indice;
    }

    /*
     * Procesa un archivo individual y extrae sus variables
     */
    private async procesarArchivo(uri: vscode.Uri): Promise<void> {
        try {
            const documento = await vscode.workspace.openTextDocument(uri);
            const variables = parsearDefiniciones(documento);

            /* Guardar variables por archivo para invalidación parcial */
            this._cache.variablesPorArchivo.set(uri.fsPath, variables);

            /* Agregar al índice global */
            for (const variable of variables) {
                /* Si ya existe, actualizar solo si es diferente archivo
                   (priorizar primera definición encontrada) */
                if (!this._cache.indice.variables.has(variable.nombre)) {
                    this._cache.indice.variables.set(variable.nombre, variable);
                }
            }
        } catch (error) {
            console.error(`[CSS Vars Validator] Error procesando ${uri.fsPath}:`, error);
        }
    }

    /*
     * Actualiza el caché cuando un archivo cambia
     */
    private async actualizarArchivo(uri: vscode.Uri): Promise<void> {
        /* Eliminar variables antiguas de este archivo */
        const variablesAnteriores = this._cache.variablesPorArchivo.get(uri.fsPath) || [];
        for (const variable of variablesAnteriores) {
            /* Solo eliminar si esta es la fuente de la variable */
            const varActual = this._cache.indice.variables.get(variable.nombre);
            if (varActual && varActual.archivo === uri.fsPath) {
                this._cache.indice.variables.delete(variable.nombre);
            }
        }

        /* Procesar el archivo actualizado */
        await this.procesarArchivo(uri);

        /* Actualizar timestamp */
        this._cache.indice.ultimaActualizacion = Date.now();

        /* Notificar cambios */
        this._onVariablesChange.fire();
    }

    /*
     * Elimina un archivo del caché
     */
    private eliminarArchivo(uri: vscode.Uri): void {
        const variables = this._cache.variablesPorArchivo.get(uri.fsPath);

        if (variables) {
            for (const variable of variables) {
                const varActual = this._cache.indice.variables.get(variable.nombre);
                if (varActual && varActual.archivo === uri.fsPath) {
                    this._cache.indice.variables.delete(variable.nombre);
                }
            }

            this._cache.variablesPorArchivo.delete(uri.fsPath);
            this._cache.indice.archivosEscaneados = this._cache.indice.archivosEscaneados.filter(f => f !== uri.fsPath);

            /* Notificar cambios */
            this._onVariablesChange.fire();
        }
    }

    /*
     * Configura watchers para archivos de variables
     */
    private configurarWatchers(): void {
        const configService = obtenerConfigService();
        const patrones = configService.obtenerPatronesVariables();

        /* Crear función debounced para actualizaciones */
        const actualizarDebounced = debounce((...args: unknown[]) => {
            const uri = args[0] as vscode.Uri;
            void this.actualizarArchivo(uri);
        }, 500);

        const watchers = crearFileWatcher(patrones, {
            onCrear: uri => {
                void this.actualizarArchivo(uri);
            },
            onCambiar: actualizarDebounced,
            onEliminar: uri => this.eliminarArchivo(uri)
        });

        this._disposables.push(...watchers);

        /* Re-configurar watchers cuando cambie la configuración */
        this._disposables.push(
            configService.onConfigChange(() => {
                /* Limpiar watchers existentes */
                this._disposables.forEach(d => d.dispose());
                this._disposables = [];

                /* Invalidar caché */
                this._cache.valido = false;

                /* Re-configurar watchers */
                this.configurarWatchers();

                /* Re-escanear */
                void this.escanear(true);
            })
        );

        /* Configurar watcher para Git change (Branch switching) */
        const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/HEAD');
        gitWatcher.onDidChange(() => {
            console.log('[CSS Vars Validator] Cambio en Git detectado. Limpiando caché...');
            this.limpiarCache();
            void this.escanear(true);
        });
        this._disposables.push(gitWatcher);
    }

    /*
     * Limpia completamente el caché
     */
    public limpiarCache(): void {
        this._cache = {
            valido: false,
            indice: {
                variables: new Map(),
                ultimaActualizacion: 0,
                archivosEscaneados: []
            },
            variablesPorArchivo: new Map()
        };
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
        const resultados: CssVariable[] = [];

        for (const variable of this._cache.indice.variables.values()) {
            if (variable.nombre.toLowerCase().includes(busquedaLower)) {
                resultados.push(variable);
            }
        }

        return resultados;
    }

    /*
     * Busca variables que coincidan con palabras clave
     */
    public buscarPorPalabrasClave(palabrasClave: string[]): CssVariable[] {
        const resultados: CssVariable[] = [];
        const palabrasLower = palabrasClave.map(p => p.toLowerCase());

        for (const variable of this._cache.indice.variables.values()) {
            const nombreLower = variable.nombre.toLowerCase();

            /* Verificar si alguna palabra clave está en el nombre */
            const coincide = palabrasLower.some(palabra => nombreLower.includes(palabra));

            if (coincide) {
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
    public obtenerEstadisticas(): {
        totalVariables: number;
        archivosEscaneados: number;
        ultimaActualizacion: Date;
    } {
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
        this._disposables.forEach(d => d.dispose());
        this._onVariablesChange.dispose();
    }
}

/*
 * Funciones helper exportadas
 */
export function obtenerScanner(): VariableScanner {
    return VariableScanner.obtenerInstancia();
}

export async function escanearVariables(forzar: boolean = false): Promise<VariableIndex> {
    return VariableScanner.obtenerInstancia().escanear(forzar);
}

export function obtenerVariable(nombre: string): CssVariable | undefined {
    return VariableScanner.obtenerInstancia().obtenerVariable(nombre);
}

export function existeVariable(nombre: string): boolean {
    return VariableScanner.obtenerInstancia().existeVariable(nombre);
}
