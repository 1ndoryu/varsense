import { MAX_ENTRADAS_CACHE_ARCHIVOS } from './analisis/limites';

/* [O1] Caché con tope de entradas que se comporta como un Map. Al superar el tope expulsa la
 * entrada usada menos recientemente (LRU): acota la memoria de sesiones largas (LSP) sin cambiar
 * el resultado, porque una entrada expulsada se recalcula al volver a pedirla. */
export class CacheAcotada<K, V> extends Map<K, V> {
    constructor(private readonly maximo: number) {
        super();
    }

    /* Leer cuenta como uso: la entrada pasa al final del orden de expulsión. */
    public override get(clave: K): V | undefined {
        if (!super.has(clave)) {
            return undefined;
        }
        const valor = super.get(clave) as V;
        super.delete(clave);
        super.set(clave, valor);
        return valor;
    }

    public override set(clave: K, valor: V): this {
        super.delete(clave);
        super.set(clave, valor);
        while (this.size > this.maximo) {
            const masAntigua = this.keys().next().value as K;
            super.delete(masAntigua);
        }
        return this;
    }
}

/* Caché por archivo con el tope común de archivos; lo usan los índices de clases. */
export function crearCacheArchivos<V>(): CacheAcotada<string, V> {
    return new CacheAcotada<string, V>(MAX_ENTRADAS_CACHE_ARCHIVOS);
}
