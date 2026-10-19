/* Caché del índice por raíz: las validaciones seguidas comparten un único cálculo. */

export interface OpcionesCacheIndice<T> {
    construir: (raiz: string) => Promise<T>;
    /* Caduca aunque no haya guardados: cubre cambios hechos fuera del editor. */
    ttlMs: number;
    ahora?: () => number;
}

export interface CacheIndice<T> {
    obtener(raiz: string): Promise<T>;
    invalidar(): void;
}

export function crearCacheIndice<T>({ construir, ttlMs, ahora = Date.now }: OpcionesCacheIndice<T>): CacheIndice<T> {
    const entradas = new Map<string, { promesa: Promise<T>; creada: number }>();

    return {
        obtener(raiz) {
            const existente = entradas.get(raiz);
            if (existente && ahora() - existente.creada < ttlMs) {
                return existente.promesa;
            }

            const promesa = construir(raiz);
            entradas.set(raiz, { promesa, creada: ahora() });
            // Un fallo no se cachea: la siguiente validación vuelve a intentarlo.
            promesa.catch(() => {
                if (entradas.get(raiz)?.promesa === promesa) {
                    entradas.delete(raiz);
                }
            });

            return promesa;
        },
        invalidar() {
            entradas.clear();
        },
    };
}
