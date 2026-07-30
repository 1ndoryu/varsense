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
});
