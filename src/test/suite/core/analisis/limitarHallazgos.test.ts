/* [O2] El tope de hallazgos conserva el conteo real, recorta en orden de ruta y se activa desde la CLI. */

import * as assert from 'assert';
import { limitarHallazgos } from '../../../../core/analisis/limitarHallazgos';
import { VarsenseReportEntry } from '../../../../core/analisis/report';
import { CoreFinding } from '../../../../core/types';
import { parseCliArgs } from '../../../../cli/args';

function hallazgo(severity: CoreFinding['severity']): CoreFinding {
    return { ruleId: 'regla', severity, message: 'm', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } } as CoreFinding;
}

function entrada(ruta: string, ...severidades: CoreFinding['severity'][]): VarsenseReportEntry {
    return { ruta, findings: severidades.map(hallazgo) };
}

suite('limitarHallazgos', () => {
    test('sin límite o con límite que no recorta devuelve las entradas intactas', () => {
        const entries = [entrada('a.css', 'error', 'warning')];

        assert.strictEqual(limitarHallazgos(entries, 0).truncado, undefined);
        assert.strictEqual(limitarHallazgos(entries, 2).truncado, undefined);
        assert.strictEqual(limitarHallazgos(entries, 2).entries, entries);
    });

    test('recorta en orden de entrada y declara el total y los omitidos', () => {
        const entries = [entrada('a.css', 'error', 'warning'), entrada('b.css', 'hint', 'error', 'error')];

        const { entries: mostrados, truncado } = limitarHallazgos(entries, 3);

        assert.deepStrictEqual(mostrados.map(e => [e.ruta, e.findings.length]), [['a.css', 2], ['b.css', 1]]);
        assert.deepStrictEqual(truncado, {
            limite: 3,
            hallazgosTotal: 5,
            hallazgosOmitidos: 2,
            archivosConHallazgos: 2,
            severityCounts: { error: 3, warning: 1, information: 0, hint: 1 },
        });
    });

    test('descarta archivos enteros que quedan fuera del tope', () => {
        const entries = [entrada('a.css', 'error', 'error'), entrada('b.css', 'warning')];

        const { entries: mostrados, truncado } = limitarHallazgos(entries, 2);

        assert.deepStrictEqual(mostrados.map(e => e.ruta), ['a.css']);
        assert.strictEqual(truncado?.archivosConHallazgos, 2);
    });
});

suite('parseCliArgs --max-hallazgos', () => {
    test('acepta 0 y enteros positivos; por defecto no limita', () => {
        assert.strictEqual(parseCliArgs(['scan']).maxHallazgos, undefined);
        assert.strictEqual(parseCliArgs(['scan', '--max-hallazgos', '0']).maxHallazgos, 0);
        assert.strictEqual(parseCliArgs(['all', '--max-hallazgos', '25']).maxHallazgos, 25);
    });

    test('rechaza valores que no son enteros >= 0', () => {
        assert.throws(() => parseCliArgs(['scan', '--max-hallazgos', '-1']), /entero >= 0/);
        assert.throws(() => parseCliArgs(['scan', '--max-hallazgos', '2.5']), /entero >= 0/);
        assert.throws(() => parseCliArgs(['scan', '--max-hallazgos', 'x']), /entero >= 0/);
    });
});
