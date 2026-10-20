import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NodeWorkspaceFileProvider } from '../../../node/nodeProviders';
import { conTiempoLimite, FuenteCancelacion, TAMANO_MAXIMO_ARCHIVO_BYTES, TiempoAgotadoError } from '../../../core/analisis/limites';
import { CancellationError } from '../../../core/proveedores/workspaceProviders';
import { parseCliArgs } from '../../../cli/args';
import { analyzeCliTarget } from '../../../cli/analisis/objetivos';

suite('V7 Límites de tiempo y tamaño', () => {
    test('conTiempoLimite rechaza con TiempoAgotadoError si el trabajo tarda más del límite', async () => {
        const lenta = () => new Promise<string>(resolve => setTimeout(() => resolve('tarde'), 200));

        await assert.rejects(conTiempoLimite(lenta, 20), TiempoAgotadoError);
    });

    test('conTiempoLimite resuelve si el trabajo termina dentro del límite', async () => {
        assert.strictEqual(await conTiempoLimite(async () => 42, 1000), 42);
    });

    test('conTiempoLimite con 0 no impone límite', async () => {
        const lenta = () => new Promise<string>(resolve => setTimeout(() => resolve('ok'), 30));

        assert.strictEqual(await conTiempoLimite(lenta, 0), 'ok');
    });

    test('conTiempoLimite marca cancelada la fuente del trabajo al agotarse el tiempo', async () => {
        const fuente = new FuenteCancelacion();
        const lenta = () => new Promise<void>(resolve => setTimeout(resolve, 200));

        await assert.rejects(conTiempoLimite(lenta, 20, fuente), TiempoAgotadoError);
        assert.strictEqual(fuente.isCancellationRequested, true);
    });

    test('analyzeCliTarget se detiene con CancellationError si el token ya está cancelado', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'varsense-cancel-'));
        fs.writeFileSync(path.join(root, 'a.css'), ':root{--c:#fff}\n');
        const fuente = new FuenteCancelacion();
        fuente.cancelar();

        await assert.rejects(analyzeCliTarget(parseCliArgs(['all', '--workspace', root]), fuente), CancellationError);
    });

    test('findFiles omite el archivo que supera el tamaño máximo y lo registra', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'varsense-limites-'));
        const pequeño = path.join(root, 'pequeño.ts');
        const grande = path.join(root, 'grande.ts');
        fs.writeFileSync(pequeño, 'export const a = 1;\n');
        fs.writeFileSync(grande, Buffer.alloc(TAMANO_MAXIMO_ARCHIVO_BYTES + 1, 'a'));

        const provider = new NodeWorkspaceFileProvider(root);
        const archivos = await provider.findFiles(['**/*.ts'], []);

        assert.deepStrictEqual(archivos.map(file => path.basename(file.fsPath)), ['pequeño.ts']);
        assert.deepStrictEqual(provider.omitidosPorTamano.map(f => path.basename(f)), ['grande.ts']);
    });
});
