import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeVarsenseDocument, orphanClassToFinding } from '../../core/analyzeDocument';
import { NodeDocumentProvider, NodeWorkspaceFileProvider } from '../../core/nodeProviders';
import { VariableIndexBuilder } from '../../core/variableIndexBuilder';
import { ClassIndexBuilder } from '../../core/classIndexBuilder';
import { CoreFinding } from '../../core/types';
import {
    analyzeCliTarget,
    buildAnalysisConfig,
    DEFAULT_CSS_PATTERNS,
    DEFAULT_EXCLUDE_PATTERNS,
    DEFAULT_REACT_PATTERNS,
    DEFAULT_VARIABLE_PATTERNS,
    parseCliArgs,
} from '../../cli';

interface ExpectedFinding {
    file: string;
    ruleId: string;
    severity: string;
    line: number;
    character: number;
    message: string;
}

interface EntryWithFindings {
    ruta: string;
    findings: CoreFinding[];
}

function fixturePath(name: string): string {
    return path.resolve(__dirname, '../../..', 'fixtures', 'equivalence', name);
}

function loadExpected(rootPath: string): ExpectedFinding[] {
    const raw = fs.readFileSync(path.join(rootPath, 'expected-findings.json'), 'utf8');
    return sortFindings(JSON.parse(raw) as ExpectedFinding[]);
}

function normalizeEntries(rootPath: string, entries: EntryWithFindings[]): ExpectedFinding[] {
    const findings = entries.flatMap(entry => entry.findings.map(finding => ({
        file: path.relative(rootPath, entry.ruta).replace(/\\/g, '/'),
        ruleId: finding.ruleId,
        severity: finding.severity,
        line: finding.range.start.line,
        character: finding.range.start.character,
        message: finding.message,
    })));

    return sortFindings(findings);
}

function sortFindings(findings: ExpectedFinding[]): ExpectedFinding[] {
    return [...findings].sort((first, second) => {
        const fileCompare = first.file.localeCompare(second.file);
        if (fileCompare !== 0) {
            return fileCompare;
        }

        const lineCompare = first.line - second.line;
        if (lineCompare !== 0) {
            return lineCompare;
        }

        const characterCompare = first.character - second.character;
        if (characterCompare !== 0) {
            return characterCompare;
        }

        return first.ruleId.localeCompare(second.ruleId);
    });
}

async function analyzeScanWithCore(rootPath: string): Promise<EntryWithFindings[]> {
    const fileProvider = new NodeWorkspaceFileProvider(rootPath);
    const documentProvider = new NodeDocumentProvider();
    const variableBuilder = new VariableIndexBuilder(fileProvider, documentProvider);
    const variableResult = await variableBuilder.build({
        patterns: DEFAULT_VARIABLE_PATTERNS,
        exclude: DEFAULT_EXCLUDE_PATTERNS,
    });
    const files = await fileProvider.findFiles([...DEFAULT_CSS_PATTERNS, ...DEFAULT_REACT_PATTERNS], DEFAULT_EXCLUDE_PATTERNS);
    const config = buildAnalysisConfig({});
    const entries: EntryWithFindings[] = [];

    for (const file of files) {
        const document = await documentProvider.openTextDocument(file);
        const findings = analyzeVarsenseDocument(document, variableResult.indice, config);
        if (findings.length > 0) {
            entries.push({ ruta: file.fsPath, findings });
        }
    }

    return entries;
}

async function analyzeOrphansWithCore(rootPath: string): Promise<EntryWithFindings[]> {
    const fileProvider = new NodeWorkspaceFileProvider(rootPath);
    const documentProvider = new NodeDocumentProvider();
    const builder = new ClassIndexBuilder(fileProvider, documentProvider);
    const result = await builder.scan({
        exclude: DEFAULT_EXCLUDE_PATTERNS,
        minLength: 3,
        excludedClassPatterns: [],
    });

    return result.clasesHuerfanas.map(orphanClass => ({
        ruta: orphanClass.archivo,
        findings: [orphanClassToFinding(orphanClass)],
    }));
}

suite('VarSense equivalence fixtures', () => {
    test('scan produce los mismos hallazgos en core y CLI', async () => {
        const rootPath = fixturePath('basic-design-tokens');
        const expected = loadExpected(rootPath);
        const coreFindings = normalizeEntries(rootPath, await analyzeScanWithCore(rootPath));
        const cliResult = await analyzeCliTarget(parseCliArgs(['scan', '--workspace', rootPath, '--format', 'json']));
        const cliFindings = normalizeEntries(rootPath, cliResult.entries);

        assert.deepStrictEqual(coreFindings, expected);
        assert.deepStrictEqual(cliFindings, expected);
    });

    test('orphan-classes produce los mismos hallazgos en core y CLI', async () => {
        const rootPath = fixturePath('orphan-classes');
        const expected = loadExpected(rootPath);
        const coreFindings = normalizeEntries(rootPath, await analyzeOrphansWithCore(rootPath));
        const cliResult = await analyzeCliTarget(parseCliArgs(['orphan-classes', '--workspace', rootPath, '--format', 'json']));
        const cliFindings = normalizeEntries(rootPath, cliResult.entries);

        assert.deepStrictEqual(coreFindings, expected);
        assert.deepStrictEqual(cliFindings, expected);
    });
});
