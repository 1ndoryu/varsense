#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import { CoreFinding, CoreTextDocument } from '@/core/types';
import { CachedNodeDocumentProvider, NodeDocumentProvider, NodeWorkspaceFileProvider, matchesAnyGlob } from '@/core/nodeProviders';
import { VariableIndexBuilder } from '@/core/variableIndexBuilder';
import { ClassIndexBuilder } from '@/core/classIndexBuilder';
import { analyzeVarsenseDocument, orphanClassToFinding } from '@/core/analyzeDocument';
import { analyzeTokenRules } from '@/core/tokenRules';
import { VarsenseReportEntry, generarReporteMarkdown } from '@/core/report';
import {
    DEFAULT_CSS_PATTERNS,
    DEFAULT_EXCLUDE_PATTERNS,
    DEFAULT_INCLUDE_PATTERNS,
    DEFAULT_REACT_PATTERNS,
    DEFAULT_SCRIPT_PATTERNS,
    DEFAULT_VARIABLE_PATTERNS,
    VarsenseConfigFile,
    buildAnalysisConfig,
    validateVarsenseConfig,
} from '@/core/config';

export {
    DEFAULT_CSS_PATTERNS,
    DEFAULT_EXCLUDE_PATTERNS,
    DEFAULT_INCLUDE_PATTERNS,
    DEFAULT_REACT_PATTERNS,
    DEFAULT_SCRIPT_PATTERNS,
    DEFAULT_VARIABLE_PATTERNS,
    buildAnalysisConfig,
    validateVarsenseConfig,
} from '@/core/config';

export type VarsenseCliCommand = 'scan' | 'orphan-classes' | 'all';
export type VarsenseCliFormat = 'markdown' | 'json';

export interface ParsedCliArgs {
    command: VarsenseCliCommand;
    workspacePath: string;
    format: VarsenseCliFormat;
    outputPath?: string;
    configPath?: string;
}

export type VarsenseCliConfigFile = VarsenseConfigFile;

export interface CliAnalysisResult {
    entries: VarsenseReportEntry[];
    totalArchivos: number;
    hasErrors: boolean;
    durationMs: number;
}

export const VARSENSE_JSON_SCHEMA_VERSION = '1';

function usage(): string {
    return [
        'Uso:',
        '  varsense scan --workspace . --format markdown --output .varsense-report.md',
        '  varsense orphan-classes --workspace . --format json',
        '  varsense all --workspace . --format json',
        '  varsense --version',
        '',
        'Opciones:',
        '  --workspace <path>  Analiza un workspace. Por defecto: cwd',
        '  --format <type>     markdown | json. Por defecto: markdown',
        '  --output <path>     Escribe salida en archivo; si falta, imprime en stdout',
        '  --config <path>     Carga varsense.config.json',
        '  --help              Muestra esta ayuda',
        '  --version           Muestra la version instalada',
    ].join('\n');
}

function takeValue(args: string[], index: number, option: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`Falta valor para ${option}`);
    }
    return value;
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
    const command = args[0];
    if (command !== 'scan' && command !== 'orphan-classes' && command !== 'all') {
        throw new Error(usage());
    }

    const parsed: ParsedCliArgs = {
        command,
        workspacePath: process.cwd(),
        format: 'markdown',
    };

    for (let index = 1; index < args.length; index++) {
        const arg = args[index];

        switch (arg) {
            case '--workspace':
                parsed.workspacePath = takeValue(args, index, arg);
                index++;
                break;
            case '--format': {
                const value = takeValue(args, index, arg);
                if (value !== 'markdown' && value !== 'json') {
                    throw new Error('--format debe ser markdown o json');
                }
                parsed.format = value;
                index++;
                break;
            }
            case '--output':
                parsed.outputPath = takeValue(args, index, arg);
                index++;
                break;
            case '--config':
                parsed.configPath = takeValue(args, index, arg);
                index++;
                break;
            case '--help':
            case '-h':
                throw new Error(usage());
            default:
                throw new Error(`Opcion no reconocida: ${arg}\n${usage()}`);
        }
    }

    parsed.workspacePath = path.resolve(parsed.workspacePath);
    return parsed;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function readConfig(configPath: string | undefined, workspacePath: string): Promise<VarsenseConfigFile> {
    const candidate = configPath
        ? path.resolve(configPath)
        : path.resolve(workspacePath, 'varsense.config.json');

    if (!await fileExists(candidate)) {
        return {};
    }

    const raw = await fs.readFile(candidate, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    validateVarsenseConfig(parsed);
    return parsed;
}

function isIncluded(filePath: string, workspacePath: string, includePatterns: string[]): boolean {
    const relativePath = path.relative(workspacePath, filePath).replace(/\\/g, '/');
    return matchesAnyGlob(relativePath, includePatterns);
}

function groupFindingsByFile(findings: Array<{ ruta: string; finding: CoreFinding }>): VarsenseReportEntry[] {
    const entries = new Map<string, CoreFinding[]>();

    for (const item of findings) {
        const current = entries.get(item.ruta) ?? [];
        current.push(item.finding);
        entries.set(item.ruta, current);
    }

    return Array.from(entries.entries())
        .map(([ruta, fileFindings]) => ({ ruta, findings: fileFindings }))
        .sort((first, second) => first.ruta.localeCompare(second.ruta));
}

export async function analyzeScanTarget(args: ParsedCliArgs): Promise<CliAnalysisResult> {
    const startedAt = Date.now();
    const configFile = await readConfig(args.configPath, args.workspacePath);
    const analysisConfig = buildAnalysisConfig(configFile);
    const includePatterns = configFile.includePatterns ?? DEFAULT_INCLUDE_PATTERNS;
    const excludePatterns = configFile.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
    const fileProvider = new NodeWorkspaceFileProvider(args.workspacePath);
    const documentProvider = new NodeDocumentProvider();
    const variableBuilder = new VariableIndexBuilder(fileProvider, documentProvider);
    const variablePatterns = configFile.scanAllFiles
        ? DEFAULT_CSS_PATTERNS
        : (configFile.variableFiles ?? DEFAULT_VARIABLE_PATTERNS);

    const variableResult = await variableBuilder.build({
        patterns: variablePatterns,
        exclude: excludePatterns,
    });

    const candidates = await fileProvider.findFiles(
        [...DEFAULT_CSS_PATTERNS, ...DEFAULT_REACT_PATTERNS, ...DEFAULT_SCRIPT_PATTERNS],
        excludePatterns
    );
    const includedCandidates = candidates.filter(file => isIncluded(file.fsPath, args.workspacePath, includePatterns));
    const findings: Array<{ ruta: string; finding: CoreFinding }> = [];

    for (const file of includedCandidates) {
        const document = await documentProvider.openTextDocument(file);
        const documentFindings = analyzeVarsenseDocument(document, variableResult.indice, analysisConfig);
        for (const documentFinding of documentFindings) {
            findings.push({ ruta: file.fsPath, finding: documentFinding });
        }
    }

    const entries = groupFindingsByFile(findings);
    return {
        entries,
        totalArchivos: includedCandidates.length,
        hasErrors: entries.some(entry => entry.findings.some(finding => finding.severity === 'error')),
        durationMs: Date.now() - startedAt,
    };
}

export async function analyzeOrphanClassesTarget(args: ParsedCliArgs): Promise<CliAnalysisResult> {
    const startedAt = Date.now();
    const configFile = await readConfig(args.configPath, args.workspacePath);
    const excludePatterns = configFile.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
    const fileProvider = new NodeWorkspaceFileProvider(args.workspacePath);
    const documentProvider = new NodeDocumentProvider();
    const builder = new ClassIndexBuilder(fileProvider, documentProvider);
    const result = await builder.scan({
        exclude: excludePatterns,
        minLength: configFile.orphanClassDetection?.minClassLength ?? 3,
        excludedClassPatterns: configFile.orphanClassDetection?.excludeClassPatterns ?? [],
    });

    const entries = groupFindingsByFile(result.clasesHuerfanas.map(clase => ({
        ruta: clase.archivo,
        finding: orphanClassToFinding(clase, configFile.orphanClassDetection?.severity ?? 'warning'),
    })));

    return {
        entries,
        totalArchivos: result.archivosAnalizadosCss + result.archivosAnalizadosConsumo,
        hasErrors: entries.some(entry => entry.findings.some(finding => finding.severity === 'error')),
        durationMs: Date.now() - startedAt,
    };
}

export async function analyzeAllTarget(args: ParsedCliArgs): Promise<CliAnalysisResult> {
    const startedAt = Date.now();
    const configFile = await readConfig(args.configPath, args.workspacePath);
    const excludePatterns = configFile.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
    const fileProvider = new NodeWorkspaceFileProvider(args.workspacePath);
    const documentProvider = new CachedNodeDocumentProvider();
    const variableBuilder = new VariableIndexBuilder(fileProvider, documentProvider);
    const variablePatterns = configFile.scanAllFiles ? DEFAULT_CSS_PATTERNS : (configFile.variableFiles ?? DEFAULT_VARIABLE_PATTERNS);
    const variableResult = await variableBuilder.build({ patterns: variablePatterns, exclude: excludePatterns });
    const classBuilder = new ClassIndexBuilder(fileProvider, documentProvider);
    const classResult = await classBuilder.scan({
        exclude: excludePatterns,
        minLength: configFile.orphanClassDetection?.minClassLength ?? 3,
        excludedClassPatterns: configFile.orphanClassDetection?.excludeClassPatterns ?? [],
    });
    const includePatterns = configFile.includePatterns ?? DEFAULT_INCLUDE_PATTERNS;
    const candidates = await fileProvider.findFiles([...DEFAULT_CSS_PATTERNS, ...DEFAULT_REACT_PATTERNS, ...DEFAULT_SCRIPT_PATTERNS], excludePatterns);
    const includedCandidates = candidates.filter(file => isIncluded(file.fsPath, args.workspacePath, includePatterns));
    const findings: Array<{ ruta: string; finding: CoreFinding }> = [];
    const analysisConfig = buildAnalysisConfig(configFile);
    const documents: Array<{ file: string; document: CoreTextDocument }> = [];
    for (const file of includedCandidates) {
        const document = await documentProvider.openTextDocument(file);
        documents.push({ file: file.fsPath, document });
        for (const documentFinding of analyzeVarsenseDocument(document, variableResult.indice, analysisConfig)) {
            findings.push({ ruta: file.fsPath, finding: documentFinding });
        }
    }
    for (const finding of analyzeTokenRules(variableResult.variablesPorArchivo, documents, analysisConfig)) {
        findings.push({ ruta: String(finding.metadata?.file ?? args.workspacePath), finding });
    }
    findings.push(...classResult.clasesHuerfanas.map(clase => ({
        ruta: clase.archivo,
        finding: orphanClassToFinding(clase, configFile.orphanClassDetection?.severity ?? 'warning'),
    })));
    const entries = groupFindingsByFile(findings);
    return {
        entries,
        totalArchivos: includedCandidates.length + classResult.archivosAnalizadosCss + classResult.archivosAnalizadosConsumo,
        hasErrors: entries.some(entry => entry.findings.some(finding => finding.severity === 'error')),
        durationMs: Date.now() - startedAt,
    };
}

export async function analyzeCliTarget(args: ParsedCliArgs): Promise<CliAnalysisResult> {
    if (args.command === 'scan') {
        return analyzeScanTarget(args);
    }
    if (args.command === 'orphan-classes') {
        return analyzeOrphanClassesTarget(args);
    }
    return analyzeAllTarget(args);
}

function severityCounts(result: CliAnalysisResult): Record<string, number> {
    const counts: Record<string, number> = { error: 0, warning: 0, information: 0, hint: 0 };
    for (const finding of result.entries.flatMap(entry => entry.findings)) {
        counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    }
    return counts;
}

function renderOutput(result: CliAnalysisResult, args: ParsedCliArgs, toolVersion: string): string {
    if (args.format === 'json') {
        return `${JSON.stringify({
            schemaVersion: VARSENSE_JSON_SCHEMA_VERSION,
            tool: { name: 'varsense', version: toolVersion },
            scope: 'workspace',
            command: args.command,
            durationMs: result.durationMs,
            severityCounts: severityCounts(result),
            totalArchivos: result.totalArchivos,
            totalArchivosConHallazgos: result.entries.length,
            entries: result.entries,
        }, null, 2)}\n`;
    }

    return `${generarReporteMarkdown({
        entries: result.entries,
        totalArchivos: result.totalArchivos,
        rutaBase: args.workspacePath,
    })}\n`;
}

async function readPackageVersion(): Promise<string> {
    const packagePath = path.resolve(__dirname, '../../package.json');
    const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8')) as { version?: unknown };
    if (typeof packageJson.version !== 'string') {
        throw new Error('package.json no contiene una version valida');
    }
    return packageJson.version;
}

async function writeOrPrint(output: string, outputPath?: string): Promise<void> {
    if (!outputPath) {
        process.stdout.write(output);
        return;
    }

    const resolved = path.resolve(outputPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, output, 'utf8');
}

export async function runCli(rawArgs: string[]): Promise<number> {
    if (rawArgs.length === 1 && (rawArgs[0] === '--help' || rawArgs[0] === '-h')) {
        process.stdout.write(`${usage()}\n`);
        return 0;
    }
    if (rawArgs.length === 1 && rawArgs[0] === '--version') {
        process.stdout.write(`${await readPackageVersion()}\n`);
        return 0;
    }
    const args = parseCliArgs(rawArgs);
    const result = await analyzeCliTarget(args);
    await writeOrPrint(renderOutput(result, args, await readPackageVersion()), args.outputPath);
    return result.hasErrors ? 1 : 0;
}

if (require.main === module) {
    runCli(process.argv.slice(2))
        .then(code => { process.exitCode = code; })
        .catch(error => {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 2;
        });
}
