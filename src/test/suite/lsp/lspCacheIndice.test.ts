import * as assert from 'assert';
import { crearCacheIndice } from '../../../lsp/cacheIndice';

suite('LSP caché del índice', () => {
    test('dos obtener seguidos sobre la misma raíz construyen una sola vez', async () => {
        let construcciones = 0;
        const cache = crearCacheIndice({
            construir: async raiz => { construcciones++; return `indice:${raiz}`; },
            ttlMs: 30_000,
        });

        assert.strictEqual(await cache.obtener('/ws'), 'indice:/ws');
        assert.strictEqual(await cache.obtener('/ws'), 'indice:/ws');
        assert.strictEqual(construcciones, 1);
    });

    test('invalidar fuerza una nueva construcción', async () => {
        let construcciones = 0;
        const cache = crearCacheIndice({
            construir: async () => ++construcciones,
            ttlMs: 30_000,
        });

        await cache.obtener('/ws');
        cache.invalidar();
        assert.strictEqual(await cache.obtener('/ws'), 2);
    });

    test('la entrada caduca tras el TTL aunque no haya guardados', async () => {
        let reloj = 0;
        let construcciones = 0;
        const cache = crearCacheIndice({
            construir: async () => ++construcciones,
            ttlMs: 1000,
            ahora: () => reloj,
        });

        await cache.obtener('/ws');
        reloj = 999;
        await cache.obtener('/ws');
        assert.strictEqual(construcciones, 1);

        reloj = 1000;
        await cache.obtener('/ws');
        assert.strictEqual(construcciones, 2);
    });

    test('un fallo no se cachea: la siguiente llamada vuelve a construir', async () => {
        let intentos = 0;
        const cache = crearCacheIndice({
            construir: async () => {
                intentos++;
                if (intentos === 1) {
                    throw new Error('lectura fallida');
                }
                return 'ok';
            },
            ttlMs: 30_000,
        });

        await assert.rejects(cache.obtener('/ws'), /lectura fallida/);
        assert.strictEqual(await cache.obtener('/ws'), 'ok');
        assert.strictEqual(intentos, 2);
    });
});
