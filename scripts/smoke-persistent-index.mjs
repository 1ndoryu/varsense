/* [028A-8] Smoke test del índice persistente del CLI: verifica
 * 1) segunda ejecución reutiliza entradas (reused > 0, reparsed = 0),
 * 2) tras modificar un archivo ese archivo se re-parsea (reparsed > 0),
 * 3) un cambio de config invalida el snapshot completo por identidad.
 * No depende de VS Code: corre contra dist/cli/index.js compilado. */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'dist', 'cli', 'index.js');
const fixtureRoot = path.join(repoRoot, 'fixtures', 'persistent-index');
const componentCss = path.join(fixtureRoot, 'src', 'component.css');

function assert(condition, message) {
    if (!condition) {
        console.error(`[smoke-persistent-index] FAIL: ${message}`);
        process.exit(1);
    }
}

async function runCli(indexDir, outputPath) {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
        cliPath,
        'all',
        '--workspace', fixtureRoot,
        '--config', path.join(fixtureRoot, 'varsense.config.json'),
        '--format', 'json',
        '--output', outputPath,
        '--index-dir', indexDir,
    ]);
    return JSON.parse(await fs.readFile(outputPath, 'utf8'));
}

async function main() {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'varsense-index-'));
    const indexDir = path.join(tmpRoot, 'cache', 'varsense');
    const out1 = path.join(tmpRoot, 'run1.json');
    const out2 = path.join(tmpRoot, 'run2.json');
    const out3 = path.join(tmpRoot, 'run3.json');
    const out4 = path.join(tmpRoot, 'run4.json');
    const out5 = path.join(tmpRoot, 'run5.json');

    /* Run 1: construye el índice desde cero. */
    const run1 = await runCli(indexDir, out1);
    assert(run1.cache?.enabled === true, 'run1 debería reportar cache.enabled=true');
    assert(typeof run1.cache?.identity === 'string' && run1.cache.identity.length > 0, 'run1 debería reportar identity');
    const snapshot = JSON.parse(await fs.readFile(path.join(indexDir, 'varsense-index.json'), 'utf8'));
    assert(snapshot.identity === run1.cache.identity, 'el snapshot debe persistir la misma identity');
    assert(snapshot.schemaVersion === 1, 'schemaVersion debe ser 1');
    assert(Object.keys(snapshot.entries).length > 0, 'el snapshot debe tener entradas');

    /* Run 2: sin cambios → todo reutilizado, nada re-parseado. */
    const run2 = await runCli(indexDir, out2);
    assert(run2.cache.loaded > 0, `run2 debería cargar entradas (loaded=${run2.cache.loaded})`);
    assert(run2.cache.reused > 0, `run2 debería reutilizar entradas (reused=${run2.cache.reused})`);
    assert(run2.cache.reparsed === 0, `run2 no debería re-parsear nada (reparsed=${run2.cache.reparsed})`);
    assert(JSON.stringify(run2.entries) === JSON.stringify(run1.entries), 'run2 debe producir findings idénticos a run1');

    /* Run 3: modifico component.css → al menos ese archivo se re-parsea. */
    const original = await fs.readFile(componentCss, 'utf8');
    await fs.writeFile(componentCss, original + '\n.auxiliar {\n    color: #0000ff;\n}\n', 'utf8');
    const run3 = await runCli(indexDir, out3);
    assert(run3.cache.reparsed > 0, `run3 debería re-parsear el archivo modificado (reparsed=${run3.cache.reparsed})`);
    assert(run3.cache.reused > 0, `run3 debería reutilizar los archivos intactos (reused=${run3.cache.reused})`);
    await fs.writeFile(componentCss, original, 'utf8');

    /* Run 4: borro un archivo → la reconciliación con disco debe expulsar su
     * entrada persistente (el proceso es nuevo, la caché en memoria arranca
     * vacía y solo el stat por entrada detecta la ausencia). */
    const auxFile = path.join(fixtureRoot, 'src', 'tokens.css');
    const auxContent = await fs.readFile(auxFile, 'utf8');
    await fs.rm(auxFile);
    const run4 = await runCli(indexDir, out4);
    assert(run4.cache.removed > 0, `run4 debería expulsar la entrada del archivo borrado (removed=${run4.cache.removed})`);
    assert(run4.cache.reused > 0, `run4 debería reutilizar los archivos intactos (reused=${run4.cache.reused})`);
    await fs.writeFile(auxFile, auxContent, 'utf8');

    /* Run 5: cambio la config → identidad distinta → snapshot inválido. */
    const configPath = path.join(fixtureRoot, 'varsense.config.json');
    const configOriginal = await fs.readFile(configPath, 'utf8');
    await fs.writeFile(configPath, JSON.stringify({ excludePatterns: ['**/node_modules/**'], scanAllFiles: true }, null, 4), 'utf8');
    const run5 = await runCli(indexDir, out5);
    assert(run5.cache.loaded === 0, `run5 (config cambiada) no debería cargar entradas (loaded=${run5.cache.loaded})`);
    assert(run5.cache.identity !== run1.cache.identity, 'la identity debe cambiar con la config');
    await fs.writeFile(configPath, configOriginal, 'utf8');

    await fs.rm(tmpRoot, { recursive: true, force: true });
    console.log('[smoke-persistent-index] OK');
}

main().catch(error => {
    console.error(`[smoke-persistent-index] ERROR: ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(2);
});
