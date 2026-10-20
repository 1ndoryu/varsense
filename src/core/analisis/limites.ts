/* [V7] Límites compartidos por CLI, LSP y proveedores Node: tamaño de archivo y tiempo de análisis. */

import type { CancellationToken } from '../proveedores/workspaceProviders';

/* Un archivo mayor se omite del análisis: suele ser minificado, generado o binario con extensión de código.
 * Acota la memoria y el tiempo de parseo sin cambiar el resultado para archivos normales. */
export const TAMANO_MAXIMO_ARCHIVO_BYTES = 2 * 1024 * 1024;

/* La CLI espera 10 minutos por defecto; `--timeout 0` lo desactiva. */
export const TIMEOUT_CLI_POR_DEFECTO_MS = 10 * 60 * 1000;

/* El LSP responde en pocos segundos o no responde: un análisis lento se reporta como error en el documento. */
export const TIMEOUT_LSP_MS = 10 * 1000;

export class TiempoAgotadoError extends Error {
    constructor(ms: number) {
        super(`Tiempo agotado tras ${ms / 1000} s`);
        this.name = 'TiempoAgotadoError';
    }
}

/* Señal de cancelación que el llamador puede activar y el trabajo consulta en sus puntos de control. */
export class FuenteCancelacion implements CancellationToken {
    private cancelada = false;

    public get isCancellationRequested(): boolean {
        return this.cancelada;
    }

    public cancelar(): void {
        this.cancelada = true;
    }
}

/* Ejecuta `trabajo` y rechaza con TiempoAgotadoError si tarda más de `ms`. Con `ms` = 0 no hay límite.
 * Al agotarse el tiempo marca `fuente` como cancelada: el trabajo se detiene en su siguiente punto de control
 * (throwIfCancelled) en vez de seguir consumiendo CPU y memoria en segundo plano. */
export function conTiempoLimite<T>(
    trabajo: (token: CancellationToken) => Promise<T>,
    ms: number,
    fuente: FuenteCancelacion = new FuenteCancelacion()
): Promise<T> {
    const promesa = trabajo(fuente);
    if (ms === 0) {
        return promesa;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            fuente.cancelar();
            reject(new TiempoAgotadoError(ms));
        }, ms);
    });

    return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
}

/* [O1] Topes de las cachés en memoria. Al superarlos se expulsa la entrada menos usada: solo cuesta recalcular. */
/* Archivos con definiciones CSS o tokens de consumo cacheados por ClassIndexBuilder. */
export const MAX_ENTRADAS_CACHE_ARCHIVOS = 2000;
/* Documentos abiertos por el proveedor de documentos Node dentro de una ejecución. */
export const MAX_ENTRADAS_CACHE_DOCUMENTOS = 500;
/* Resoluciones de variables CSS del servicio del LSP. */
export const MAX_ENTRADAS_CACHE_RESOLUCION = 200;
/* Raíces de workspace con índice de contexto en el LSP. */
export const MAX_RAICES_CACHE_INDICE = 8;
