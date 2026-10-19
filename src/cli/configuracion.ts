/* Carga de varsense.config.json: desde --config o desde la raíz del workspace. */
import * as path from 'path';
import { VarsenseConfigFile } from '@/core/config';
import { cargarVarsenseConfig } from '@/core/configArchivo';

/* [V10] Un --config explícito que no existe es un error de uso (rc 2), no una configuración vacía. */
export async function readConfig(configPath: string | undefined, workspacePath: string): Promise<VarsenseConfigFile> {
    const candidate = configPath
        ? path.resolve(configPath)
        : path.resolve(workspacePath, 'varsense.config.json');

    return cargarVarsenseConfig(candidate, { obligatorio: configPath !== undefined });
}
