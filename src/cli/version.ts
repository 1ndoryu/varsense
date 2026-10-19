/* Lectura de la versión instalada desde package.json (para --version y la identidad del índice). */
import * as fs from 'fs/promises';
import * as path from 'path';

export async function readPackageVersion(): Promise<string> {
    const packagePath = path.resolve(__dirname, '../../package.json');
    const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8')) as { version?: unknown };
    if (typeof packageJson.version !== 'string') {
        throw new Error('package.json no contiene una version valida');
    }
    return packageJson.version;
}
