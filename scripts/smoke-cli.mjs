/* Smoke test de la CLI compilada: ejecuta los subcomandos sobre los fixtures
 * versionados y comprueba el contrato público (rc 0/1, JSON con schemaVersion
 * y severityCounts, ayuda y versión). Corre contra dist/cli/index.js, así que
 * requiere `npm run compile` previo. No depende de VS Code. */
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'dist', 'cli', 'index.js');
const fixtures = path.join(repoRoot, 'fixtures');

const CASOS = [
    { nombre: 'all sobre tokens', args: ['all', '--workspace', path.join(fixtures, 'equivalence', 'basic-design-tokens'), '--format', 'json'] },
    { nombre: 'orphan-classes sobre fixture', args: ['orphan-classes', '--workspace', path.join(fixtures, 'equivalence', 'orphan-classes'), '--format', 'json'] },
    { nombre: 'scan sobre índice persistente', args: ['scan', '--workspace', path.join(fixtures, 'persistent-index'), '--format', 'json'] },
];

function fallar(mensaje) {
    console.error(`[smoke-cli] FAIL: ${mensaje}`);
    process.exit(1);
}

async function ejecutar(args) {
    try {
        const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], { maxBuffer: 16 * 1024 * 1024 });
        return { rc: 0, stdout };
    } catch (error) {
        // Con hallazgos de severidad error la CLI sale con 1 y sigue emitiendo el JSON.
        if (error.code === 1) return { rc: 1, stdout: error.stdout };
        throw error;
    }
}

for (const caso of CASOS) {
    const { rc, stdout } = await ejecutar(caso.args);
    let json;
    try {
        json = JSON.parse(stdout);
    } catch {
        fallar(`${caso.nombre}: la salida JSON no parsea`);
    }
    if (String(json.schemaVersion) !== '1') fallar(`${caso.nombre}: schemaVersion distinto de 1`);
    if (!json.severityCounts) fallar(`${caso.nombre}: falta severityCounts`);
    console.log(`[smoke-cli] OK ${caso.nombre} (rc ${rc})`);
}

const ayuda = await ejecutar(['--help']);
if (ayuda.rc !== 0 || !ayuda.stdout.includes('orphan-classes')) fallar('--help no lista los subcomandos');

const version = await ejecutar(['--version']);
if (version.rc !== 0 || !/^\d+\.\d+\.\d+/.test(version.stdout.trim())) fallar('--version no devuelve semver');

console.log('[smoke-cli] OK ayuda y versión');
