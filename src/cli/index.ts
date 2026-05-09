#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import { CoreFinding, CoreSeverity } from '@/core/types';
import { NodeDocumentProvider, NodeWorkspaceFileProvider, matchesAnyGlob } from '@/core/nodeProviders';
import { VariableIndexBuilder } from '@/core/variableIndexBuilder';
import { ClassIndexBuilder } from '@/core/classIndexBuilder';
import { VarsenseDocumentAnalysisConfig, analyzeVarsenseDocument, orphanClassToFinding } from '@/core/analyzeDocument';
import { VarsenseReportEntry, generarReporteMarkdown } from '@/core/report';

export type VarsenseCliCommand = 'scan' | 'orphan-classes';
export type VarsenseCliFormat = 'markdown' | 'json';

export interface ParsedCliArgs {
    command: VarsenseCliCommand;
    workspacePath: string;
    format: VarsenseCliFormat;
    outputPath?: string;
    configPath?: string;
}

export interface VarsenseCliConfigFile {
    variableFiles?: string[];
    includePatterns?: string[];
    excludePatterns?: string[];
    scanAllFiles?: boolean;
    hardcodedDetection?: {
        enabled?: boolean;
        severity?: CoreSeverity;
        properties?: Record<string, boolean>;
        allowedValues?: string[];
    };
    inlineDetection?: {
        enabled?: boolean;
        severity?: CoreSeverity;
    };
    bannedProperties?: {
        enabled?: boolean;
        severity?: CoreSeverity;
        properties?: string[];
    };
    orphanClassDetection?: {
        minClassLength?: number;
        excludeClassPatterns?: string[];
    };
}

export interface CliAnalysisResult {
    entries: VarsenseReportEntry[];
    totalArchivos: number;
    hasErrors: boolean;
}

const DEFAULT_VARIABLE_PATTERNS = [
    '**/variables.css',
    '**/vars.css',
    '**/_variables.scss',
    '**/tokens.css',
];
const DEFAULT_CSS_PATTERNS = ['**/*.css', '**/*.scss', '**/*.less'];
const DEFAULT_REACT_PATTERNS = ['**/*.tsx', '**/*.jsx'];
const DEFAULT_INCLUDE_PATTERNS = ['**/*'];
const DEFAULT_EXCLUDE_PATTERNS = [
    '**/node_modules/**',
    '**/vendor/**',
    '**/*.min.css',
    '**/dist/**',
    '**/build/**',
];
const DEFAULT_ALLOWED_VALUES = [
    '0', 'auto', 'inherit', 'initial', 'unset', 'none',
    '100%', '50%', 'transparent', 'currentColor',
];
const DEFAULT_HARDCODED_PROPERTIES: Record<string, boolean> = {
    'font-size': true,
    color: true,
    'background-color': true,
    background: true,
    'border-color': true,
    margin: false,
    padding: false,
    gap: false,
    'border-radius': false,
};
const VALID_SEVERITIES = new Set<CoreSeverity>(['error', 'warning', 'information', 'hint']);

function usage(): string {
    return [
        'Uso:',
        '  varsense scan --workspace . --format markdown --output .varsense-report.md',
        '  varsense orphan-classes --workspace . --format json',
        '',
        'Opciones:',
        '  --workspace <path>  Analiza un workspace. Por defecto: cwd',
        '  --format <type>     markdown | json. Por defecto: markdown',
        '  --output <path>     Escribe salida en archivo; si falta, imprime en stdout',
        '  --config <path>     Carga varsense.config.json',
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
    if (command !== 'scan' && command !== 'orphan-classes') {
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

async function readConfig(configPath: string | undefined, workspacePath: string): Promise<VarsenseCliConfigFile> {
    const candidate = configPath
        ? path.resolve(configPath)
        : path.resolve(workspacePath, 'varsense.config.json');

    if (!await fileExists(candidate)) {
        return {};
    }

    const raw = await fs.readFile(candidate, 'utf8');
    return JSON.parse(raw) as VarsenseCliConfigFile;
}

function severityOrDefault(value: CoreSeverity | undefined, fallback: CoreSeverity): CoreSeverity {
    return value && VALID_SEVERITIES.has(value) ? value : fallback;
}

function buildAnalysisConfig(config: VarsenseCliConfigFile): VarsenseDocumentAnalysisConfig {
    return {
        hardcoded: {
            habilitado: config.hardcodedDetection?.enabled ?? true,
            severidad: severityOrDefault(config.hardcodedDetection?.severity, 'warning'),
            propiedades: config.hardcodedDetection?.properties ?? DEFAULT_HARDCODED_PROPERTIES,
            valoresPermitidos: config.hardcodedDetection?.allowedValues ?? DEFAULT_ALLOWED_VALUES,
        },
        inline: {
            habilitado: config.inlineDetection?.enabled ?? true,
            severidad: severityOrDefault(config.inlineDetection?.severity, 'error'),
        },
        bannedProperties: {
            habilitado: config.bannedProperties?.enabled ?? true,
            severidad: severityOrDefault(config.bannedProperties?.severity, 'warning'),
            propiedades: config.bannedProperties?.properties ?? ['box-shadow'],
        },
    };
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

    const candidates = await fileProvider.findFiles([...DEFAULT_CSS_PATTERNS, ...DEFAULT_REACT_PATTERNS], excludePatterns);
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
    };
}

export async function analyzeOrphanClassesTarget(args: ParsedCliArgs): Promise<CliAnalysisResult> {
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
        finding: orphanClassToFinding(clase),
    })));

    return {
        entries,
        totalArchivos: result.archivosAnalizadosCss + result.archivosAnalizadosConsumo,
        hasErrors: false,
    };
}

export async function analyzeCliTarget(args: ParsedCliArgs): Promise<CliAnalysisResult> {
    return args.command === 'scan'
        ? analyzeScanTarget(args)
        : analyzeOrphanClassesTarget(args);
}

function renderOutput(result: CliAnalysisResult, args: ParsedCliArgs): string {
    if (args.format === 'json') {
        return `${JSON.stringify({
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
    const args = parseCliArgs(rawArgs);
    const result = await analyzeCliTarget(args);
    await writeOrPrint(renderOutput(result, args), args.outputPath);
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
