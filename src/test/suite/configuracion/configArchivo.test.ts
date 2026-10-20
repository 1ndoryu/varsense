import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cargarVarsenseConfig } from '../../../node/configArchivo';

suite('Configuración compartida CLI y LSP', () => {
    test('sin varsense.config.json devuelve la configuración vacía', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'varsense-config-'));

        assert.deepStrictEqual(await cargarVarsenseConfig(path.join(root, 'varsense.config.json')), {});
    });

    test('un --config explícito que no existe es un error', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'varsense-config-'));

        await assert.rejects(
            cargarVarsenseConfig(path.join(root, 'no-existe.json'), { obligatorio: true }),
            /No existe el archivo de configuración/
        );
    });

    test('lee prefijosPortadores del archivo', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'varsense-config-'));
        const ruta = path.join(root, 'varsense.config.json');
        fs.writeFileSync(ruta, JSON.stringify({ prefijosPortadores: ['clase', 'tw'] }));

        const config = await cargarVarsenseConfig(ruta);
        assert.deepStrictEqual(config.prefijosPortadores, ['clase', 'tw']);
    });
});
