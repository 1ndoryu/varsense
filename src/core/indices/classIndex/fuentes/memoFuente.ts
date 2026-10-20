/* Memo acotado por texto de fuente. Los escáneres consultan muchas posiciones de un mismo
 * archivo, y alternan entre archivos al indexar: calcular el estado una vez por fuente
 * evita recorrerla en cada consulta. El tope evita que un proceso LSP que visita muchos
 * archivos acumule memoria. */
const MAX_FUENTES_MEMO = 8;

export function memoPorFuente<T>(cache: Map<string, T>, source: string, calcular: (texto: string) => T): T {
    const previo = cache.get(source);
    if (previo !== undefined) { return previo; }
    /* Al llegar al tope se desaloja la entrada más antigua (orden de inserción del Map) */
    if (cache.size >= MAX_FUENTES_MEMO) {
        const masAntigua = cache.keys().next().value;
        if (masAntigua !== undefined) { cache.delete(masAntigua); }
    }
    const valor = calcular(source);
    cache.set(source, valor);
    return valor;
}
