import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeCliTarget, parseCliArgs } from '../../cli';
import { validateVarsenseConfig } from '../../core/config';

function crearWorkspaceTemporal(prefix: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    return root;
}

function escribir(root: string, relativePath: string, content: string): void {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

suite('VarSense CLI editor-agnostic', () => {
    test('parsea argumentos de scan', () => {
        const args = parseCliArgs(['scan', '--workspace', '.', '--format', 'json']);

        assert.strictEqual(args.command, 'scan');
        assert.strictEqual(args.format, 'json');
    });

    test('parsea el comando combinado all', () => {
        const args = parseCliArgs(['all', '--workspace', '.', '--format', 'json']);
        assert.strictEqual(args.command, 'all');
    });

    test('scan detecta variable no definida, hardcoded, propiedad prohibida e inline CSS', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-scan-');
        escribir(root, 'src/variables.css', ':root { --colorPrimary: #fff; }');
        escribir(root, 'src/component.css', '.card { color: var(--missingColor); background: #fff; box-shadow: 0 0 4px #000; }');
        escribir(root, 'src/App.tsx', 'export function App() { return <div style={{ color: "red" }} />; }');

        try {
            const result = await analyzeCliTarget(parseCliArgs(['scan', '--workspace', root, '--format', 'json']));
            const findings = result.entries.flatMap(entry => entry.findings);
            const ruleIds = findings.map(finding => finding.ruleId);

            assert.strictEqual(result.hasErrors, true);
            assert.ok(ruleIds.includes('variableNoDefinida'));
            assert.ok(ruleIds.includes('valorHardcoded'));
            assert.ok(ruleIds.includes('propiedadProhibida'));
            assert.ok(ruleIds.includes('cssInlineReact'));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('orphan-classes reporta clases CSS definidas pero no usadas', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-orphans-');
        escribir(root, 'src/styles.css', '.usada { color: red; }\n.huerfana { color: blue; }');
        escribir(root, 'src/App.tsx', 'export function App() { return <div className="usada" />; }');

        try {
            const result = await analyzeCliTarget(parseCliArgs(['orphan-classes', '--workspace', root, '--format', 'json']));
            const findings = result.entries.flatMap(entry => entry.findings);

            assert.strictEqual(result.hasErrors, false);
            assert.ok(findings.some(finding => finding.ruleId === 'claseHuerfana' && finding.message.includes('huerfana')));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('all combina variables, CSS inline y clases huerfanas en una ejecución', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-all-');
        escribir(root, 'src/variables.css', ':root { --colorPrimary: #fff; }\n.huerfana { color: red; }');
        escribir(root, 'src/App.tsx', 'export function App() { return <div style={{ color: "red" }} />; }');

        try {
            const result = await analyzeCliTarget(parseCliArgs(['all', '--workspace', root, '--format', 'json']));
            const ruleIds = result.entries.flatMap(entry => entry.findings).map(finding => finding.ruleId);
            assert.ok(ruleIds.includes('cssInlineReact'));
            assert.ok(ruleIds.includes('claseHuerfana'));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('all detecta tokens duplicados y no usados con el snapshot compartido', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-tokens-');
        escribir(root, 'src/variables.css', ':root { --colorA: #fff; --colorB: #fff; --sinUso: 2px; }');
        escribir(root, 'src/App.css', '.app { color: var(--colorA); }');

        try {
            const result = await analyzeCliTarget(parseCliArgs(['all', '--workspace', root, '--format', 'json']));
            const ruleIds = result.entries.flatMap(entry => entry.findings).map(finding => finding.ruleId);
            assert.ok(ruleIds.includes('token-duplicate'));
            assert.ok(ruleIds.includes('token-unused'));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('scan detecta CSS inline en Vanilla TypeScript', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-vanilla-');
        escribir(root, 'src/variables.css', ':root { --colorPrimary: #fff; }');
        escribir(root, 'src/view.ts', 'element.style.color = "red";');

        try {
            const result = await analyzeCliTarget(parseCliArgs(['scan', '--workspace', root, '--format', 'json']));
            const findings = result.entries.flatMap(entry => entry.findings);
            assert.ok(findings.some(finding => finding.ruleId === 'cssInlineScript'));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('scan permite setProperty para custom properties', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-custom-property-');
        escribir(root, 'src/variables.css', ':root { --colorPrimary: #fff; }');
        escribir(root, 'src/view.ts', 'root.style.setProperty("--colorPrimary", value);');

        try {
            const result = await analyzeCliTarget(parseCliArgs(['scan', '--workspace', root, '--format', 'json']));
            const findings = result.entries.flatMap(entry => entry.findings);
            assert.ok(!findings.some(finding => finding.ruleId === 'cssInlineScript'));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('orphan-classes bloquea cuando la severidad local es error', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-orphan-error-');
        escribir(root, 'src/styles.css', '.huerfana { color: red; }');
        escribir(root, 'varsense.config.json', JSON.stringify({
            orphanClassDetection: { severity: 'error' },
        }));

        try {
            const result = await analyzeCliTarget(parseCliArgs(['orphan-classes', '--workspace', root, '--format', 'json']));
            assert.strictEqual(result.hasErrors, true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rechaza claves desconocidas en config', () => {
        assert.throws(() => validateVarsenseConfig({ unknown: true }), /clave desconocida/);
        assert.throws(
            () => validateVarsenseConfig({ inlineDetection: { typo: true } }),
            /clave desconocida/,
        );

    });
    test('parsea --files-from', () => {
        const parsed = parseCliArgs(['scan', '--workspace', '/tmp/workspace', '--files-from', 'scope.txt']);
        assert.strictEqual(parsed.filesFromPath, 'scope.txt');
    });

    test('limita findings pero conserva el análisis global', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-files-from-');
        try {
            escribir(root, 'styles.css', '.orphanAlpha { color: red; } .orphanBeta { color: blue; }');
            escribir(root, 'scope.txt', 'styles.css' + String.fromCharCode(10));
            const first = await analyzeCliTarget(parseCliArgs([
                'orphan-classes', '--workspace', root, '--files-from', 'scope.txt', '--format', 'json',
            ]));
            const firstFindings = first.entries.flatMap(entry => entry.findings);
            assert.ok(firstFindings.some(finding => String(finding.message).includes('orphanAlpha')));
            assert.ok(firstFindings.some(finding => String(finding.message).includes('orphanBeta')));

            escribir(root, 'other.css', '.otherOrphan { color: green; }');
            escribir(root, 'scope.txt', 'other.css' + String.fromCharCode(10));
            const second = await analyzeCliTarget(parseCliArgs([
                'orphan-classes', '--workspace', root, '--files-from', 'scope.txt', '--format', 'json',
            ]));
            const secondFindings = second.entries.flatMap(entry => entry.findings);
            assert.ok(!secondFindings.some(finding => String(finding.message).includes('orphanAlpha')));
            assert.ok(!secondFindings.some(finding => String(finding.message).includes('orphanBeta')));
            assert.ok(secondFindings.some(finding => String(finding.message).includes('otherOrphan')));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('acepta archivos eliminados como metadatos sin fallar', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-files-from-deleted-');
        try {
            escribir(root, 'scope.txt', 'src/deleted.css' + String.fromCharCode(10));
            const result = await analyzeCliTarget(parseCliArgs([
                'orphan-classes', '--workspace', root, '--files-from', 'scope.txt', '--format', 'json',
            ]));
            assert.strictEqual(result.entries.length, 0);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rechaza rutas inseguras del manifiesto', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-files-from-invalid-');
        try {
            const newline = String.fromCharCode(10);
            const cases = [
                { content: '../outside.css' + newline, pattern: /workspace|fuera/ },
                { content: path.join(root, 'src', 'absolute.css') + newline, pattern: /Ruta absoluta|absoluta/ },
                { content: 'src/a.css' + newline + 'src/a.css' + newline, pattern: /duplicada/ },
            ];
            escribir(root, 'src/a.css', '.aOrphan {}');
            for (const currentCase of cases) {
                escribir(root, 'scope.txt', currentCase.content);
                await assert.rejects(
                    analyzeCliTarget(parseCliArgs([
                        'orphan-classes', '--workspace', root, '--files-from', 'scope.txt', '--format', 'json',
                    ])),
                    currentCase.pattern,
                );
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rechaza directorios del manifiesto', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-files-from-directory-');
        try {
            escribir(root, 'scope.txt', 'src' + String.fromCharCode(10));
            await assert.rejects(
                analyzeCliTarget(parseCliArgs([
                    'orphan-classes', '--workspace', root, '--files-from', 'scope.txt', '--format', 'json',
                ])),
                /directorio/,
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('all filtra tokens fuera del alcance y conserva el índice global', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-files-from-all-');
        try {
            escribir(root, 'src/variables.css', ':root { --colorA: #fff; --colorB: #fff; }');
            escribir(root, 'src/App.css', '.app { color: var(--colorA); }');
            escribir(root, 'scope.txt', 'src/variables.css' + String.fromCharCode(10));
            const result = await analyzeCliTarget(parseCliArgs([
                'all', '--workspace', root, '--files-from', 'scope.txt', '--format', 'json',
            ]));
            const findings = result.entries.flatMap(entry => entry.findings);
            const ruleIds = findings.map(finding => finding.ruleId);
            assert.ok(ruleIds.includes('token-duplicate'));
            assert.ok(findings.some(finding => finding.ruleId === 'token-unused' && String(finding.message).includes('--colorB')));
            assert.ok(!findings.some(finding => finding.ruleId === 'token-unused' && String(finding.message).includes('--colorA')));
            assert.ok(!result.entries.some(entry => entry.ruta.endsWith('App.css')));
            assert.ok(!findings.some(finding => String(finding.metadata?.file ?? '').endsWith('App.css')));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rechaza symlink que sale del workspace', async () => {
        const root = crearWorkspaceTemporal('varsense-cli-files-from-symlink-');
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'varsense-cli-outside-'));
        try {
            escribir(outside, 'outside.css', '.outsideOrphan {}');
            const link = path.join(root, 'linked.css');
            try {
                fs.symlinkSync(path.join(outside, 'outside.css'), link);
            } catch (error) {
                const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
                if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') return;
                throw error;
            }
            escribir(root, 'scope.txt', 'linked.css' + String.fromCharCode(10));
            await assert.rejects(
                analyzeCliTarget(parseCliArgs([
                    'orphan-classes', '--workspace', root, '--files-from', 'scope.txt', '--format', 'json',
                ])),
                /fuera del workspace/,
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});
