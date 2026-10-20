/* Caché del índice por raíz: las validaciones seguidas comparten un único cálculo. */
import { CacheAcotada } from '@/core/cacheAcotada';
import { MAX_RAICES_CACHE_INDICE } from '@/core/analisis/limites';

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

interface Entrada<T> {
    promesa: Promise<T>;
    /* Instante en que termina la construcción. Mientras corre, la entrada no caduca: el TTL cuenta desde el final. */
    terminada?: number;
}

export function crearCacheIndice<T>({ construir, ttlMs, ahora = Date.now }: OpcionesCacheIndice<T>): CacheIndice<T> {
    const entradas = new CacheAcotada<string, Entrada<T>>(MAX_RAICES_CACHE_INDICE);

    return {
        obtener(raiz) {
            const existente = entradas.get(raiz);
            if (existente && (existente.terminada === undefined || ahora() - existente.terminada < ttlMs)) {
                return existente.promesa;
            }

            const entrada: Entrada<T> = {
                promesa: construir(raiz).then(
                    valor => {
                        entrada.terminada = ahora();
                        return valor;
                    },
                    error => {
                        // Un fallo no se cachea: la siguiente validación vuelve a intentarlo.
                        if (entradas.get(raiz) === entrada) {
                            entradas.delete(raiz);
                        }
                        throw error;
                    }
                ),
            };
            entradas.set(raiz, entrada);

            return entrada.promesa;
        },
        invalidar() {
            entradas.clear();
        },
    };
}
