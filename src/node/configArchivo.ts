import * as fs from 'fs/promises';
import { VarsenseConfigFile } from '@/core/configuracion/config';
import { interpretarVarsenseConfig } from '@/core/configuracion/configArchivo';

/* Lee varsense.config.json. Lo comparten la CLI y el LSP para que ambos decidan igual. */
export async function cargarVarsenseConfig(
    rutaConfig: string,
    opciones: { obligatorio?: boolean } = {}
): Promise<VarsenseConfigFile> {
    let raw: string;
    try {
        raw = await fs.readFile(rutaConfig, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
        // Sin archivo, vale la configuración por defecto; un --config explícito debe existir.
        if (opciones.obligatorio) {
            throw new Error(`No existe el archivo de configuración: ${rutaConfig}`);
        }
        return {};
    }

    return interpretarVarsenseConfig(raw, rutaConfig);
}
