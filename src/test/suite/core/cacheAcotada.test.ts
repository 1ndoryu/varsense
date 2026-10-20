/* [O1] La caché acotada expulsa la entrada menos usada y mantiene el resto como un Map. */

import * as assert from 'assert';
import { CacheAcotada } from '../../../core/cacheAcotada';

suite('CacheAcotada', () => {
    test('expulsa la entrada más antigua al superar el tope', () => {
        const cache = new CacheAcotada<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        assert.strictEqual(cache.size, 2);
        assert.strictEqual(cache.has('a'), false);
        assert.deepStrictEqual([...cache.keys()], ['b', 'c']);
    });

    test('leer una entrada la deja como la más reciente', () => {
        const cache = new CacheAcotada<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        assert.strictEqual(cache.get('a'), 1);
        cache.set('c', 3);

        assert.strictEqual(cache.has('b'), false);
        assert.deepStrictEqual([...cache.keys()], ['a', 'c']);
    });

    test('reescribir una clave no la duplica ni expulsa otras', () => {
        const cache = new CacheAcotada<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('a', 10);

        assert.strictEqual(cache.size, 2);
        assert.strictEqual(cache.get('a'), 10);
    });

    test('get de una clave ausente devuelve undefined sin crearla', () => {
        const cache = new CacheAcotada<string, number>(2);

        assert.strictEqual(cache.get('x'), undefined);
        assert.strictEqual(cache.size, 0);
    });
});
