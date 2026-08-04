#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import { CoreFinding, CoreTextDocument } from '@/core/types';
import { CachedNodeDocumentProvider, NodeDocumentProvider, NodeWorkspaceFileProvider, matchesAnyGlob } from '@/core/nodeProviders';
import { VariableIndexBuilder } from '@/core/variableIndexBuilder';
import { FilePersistentIndexStore, PARSER_VERSION, PERSISTENT_INDEX_FILENAME, buildVariableReverseIndex, configHashFor, indexIdentity } from '@/core/persistentIndex';
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
    filesFromPath?: string;
    indexDir?: string;
}

export type VarsenseCliConfigFile = VarsenseConfigFile;

export interface CliAnalysisResult {
    entries: VarsenseReportEntry[];
    totalArchivos: number;
    hasErrors: boolean;
    durationMs: number;
    cache?: {
        enabled: boolean;
        identity: string;
        loaded: number;
        reused: number;
        reparsed: number;
        removed: number;
        entries: number;
    };
    /* [028A-8 Fase 0] Métricas por etapa publicadas en el JSON. */
    metrics?: {
        filesDiscovered: number;
        filesAnalyzed: number;
        filesReused: number;
        cacheHitRate: number;
        peakRssMb: number;
        scopeExpandedFiles: number;
    };
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
        '  --files-from <path> Limita los archivos reportados a un manifiesto relativo',
        '  --index-dir <path>   Persiste el índice entre ejecuciones (cache por rama)',
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
            case '--files-from':
                parsed.filesFromPath = takeValue(args, index, arg);
                index++;
                break;
            case '--index-dir':
                parsed.indexDir = takeValue(args, index, arg);
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

function pathKey(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readFilesFromManifest(args: ParsedCliArgs): Promise<Set<string> | undefined> {
    if (!args.filesFromPath) {
        return undefined;
    }

    const manifestPath = path.resolve(args.workspacePath, args.filesFromPath);
    const workspaceRealPath = await fs.realpath(args.workspacePath);
    const manifestRealPath = await fs.realpath(manifestPath);
    if (!isPathInside(workspaceRealPath, manifestRealPath)) {
        throw new Error('--files-from debe estar dentro del workspace');
    }

    const raw = await fs.readFile(manifestPath, 'utf8');
    const files = new Set<string>();
    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim().replace(/\\/g, '/');
        if (!line) {
            continue;
        }
        if (path.isAbsolute(line) || /^[A-Za-z]:\//.test(line)) {
            throw new Error('Ruta absoluta no permitida en --files-from: ' + line);
        }
        const resolved = path.resolve(args.workspacePath, line);
        if (!isPathInside(args.workspacePath, resolved)) {
            throw new Error('Ruta fuera del workspace en --files-from: ' + line);
        }
        const key = pathKey(resolved);
        if (files.has(key)) {
            throw new Error('Ruta duplicada en --files-from: ' + line);
        }
        try {
            const stats = await fs.stat(resolved);
            if (stats.isDirectory()) {
                throw new Error('Ruta directorio no permitida en --files-from: ' + line);
            }
            const realPath = await fs.realpath(resolved);
            if (!isPathInside(workspaceRealPath, realPath)) {
                throw new Error('Ruta fuera del workspace en --files-from: ' + line);
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('directorio no permitida')) {
                throw error;
            }
            const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
            if (code !== 'ENOENT') {
                throw error;
            }
        }
        files.add(key);
    }
    return files;
}

function isScopedFile(filePath: string, scopeKeys: Set<string> | undefined): boolean {
    return !scopeKeys || scopeKeys.has(pathKey(filePath));
}

function isFindingScoped(finding: CoreFinding, scopeKeys: Set<string> | undefined): boolean {
    if (!scopeKeys) {
        return true;
    }
    const file = finding.metadata?.file;
    return typeof file === 'string' && isScopedFile(file, scopeKeys);
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
    const scopedFiles = await readFilesFromManifest(args);
    const analysisConfig = buildAnalysisConfig(configFile);
    const includePatterns = configFile.includePatterns ?? DEFAULT_INCLUDE_PATTERNS;
    const excludePatterns = configFile.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
    const fileProvider = new NodeWorkspaceFileProvider(args.workspacePath);
    const documentProvider = new NodeDocumentProvider();
    const persistentStore = await createIndexStore(args, configFile);
    const variableBuilder = new VariableIndexBuilder(fileProvider, documentProvider, persistentStore);
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
    /* --files-from limita findings reportados; los índices globales se mantienen para exactitud. */
    const includedCandidates = candidates.filter(file => isIncluded(file.fsPath, args.workspacePath, includePatterns) && isScopedFile(file.fsPath, scopedFiles));
    const findings: Array<{ ruta: string; finding: CoreFinding }> = [];

    for (const file of includedCandidates) {
        const document = await documentProvider.openTextDocument(file);
        const documentFindings = analyzeVarsenseDocument(document, variableResult.indice, analysisConfig);
        for (const documentFinding of documentFindings) {
            findings.push({ ruta: file.fsPath, finding: documentFinding });
        }
    }

    const entries = groupFindingsByFile(findings);
    const result: CliAnalysisResult = {
        entries,
        totalArchivos: includedCandidates.length,
        hasErrors: entries.some(entry => entry.findings.some(finding => finding.severity === 'error')),
        durationMs: Date.now() - startedAt,
        ...(persistentStore ? { cache: cacheStats(persistentStore) } : {}),
    };
    await persistentStore?.save();
    return result;
}

export async function analyzeOrphanClassesTarget(args: ParsedCliArgs): Promise<CliAnalysisResult> {
    const startedAt = Date.now();
    const configFile = await readConfig(args.configPath, args.workspacePath);
    const scopedFiles = await readFilesFromManifest(args);
    const excludePatterns = configFile.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
    const fileProvider = new NodeWorkspaceFileProvider(args.workspacePath);
    const documentProvider = new NodeDocumentProvider();
    const persistentStore = await createIndexStore(args, configFile);
    const builder = new ClassIndexBuilder(fileProvider, documentProvider, undefined, persistentStore);
    const result = await builder.scan({
        exclude: excludePatterns,
        minLength: configFile.orphanClassDetection?.minClassLength ?? 3,
        excludedClassPatterns: configFile.orphanClassDetection?.excludeClassPatterns ?? [],
    });

    const entries = groupFindingsByFile(result.clasesHuerfanas.filter(clase => isScopedFile(clase.archivo, scopedFiles)).map(clase => ({
        ruta: clase.archivo,
        finding: orphanClassToFinding(clase, configFile.orphanClassDetection?.severity ?? 'warning'),
    })));

    const output: CliAnalysisResult = {
        entries,
        totalArchivos: result.archivosAnalizadosCss + result.archivosAnalizadosConsumo,
        hasErrors: entries.some(entry => entry.findings.some(finding => finding.severity === 'error')),
        durationMs: Date.now() - startedAt,
        ...(persistentStore ? { cache: cacheStats(persistentStore) } : {}),
    };
    await persistentStore?.save();
    return output;
}

export async function analyzeAllTarget(args: ParsedCliArgs): Promise<CliAnalysisResult> {
    const startedAt = Date.now();
    const configFile = await readConfig(args.configPath, args.workspacePath);
    const scopedFiles = await readFilesFromManifest(args);
    const excludePatterns = configFile.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
    const fileProvider = new NodeWorkspaceFileProvider(args.workspacePath);
    const documentProvider = new CachedNodeDocumentProvider();
    const persistentStore = await createIndexStore(args, configFile);
    const variableBuilder = new VariableIndexBuilder(fileProvider, documentProvider, persistentStore);
    const variablePatterns = configFile.scanAllFiles ? DEFAULT_CSS_PATTERNS : (configFile.variableFiles ?? DEFAULT_VARIABLE_PATTERNS);
    const variableResult = await variableBuilder.build({ patterns: variablePatterns, exclude: excludePatterns });
    const classBuilder = new ClassIndexBuilder(fileProvider, documentProvider, documentProvider, persistentStore);
    const classResult = await classBuilder.scan({
        exclude: excludePatterns,
        minLength: configFile.orphanClassDetection?.minClassLength ?? 3,
        excludedClassPatterns: configFile.orphanClassDetection?.excludeClassPatterns ?? [],
    });
    const includePatterns = configFile.includePatterns ?? DEFAULT_INCLUDE_PATTERNS;
    const candidates = await fileProvider.findFiles([...DEFAULT_CSS_PATTERNS, ...DEFAULT_REACT_PATTERNS, ...DEFAULT_SCRIPT_PATTERNS], excludePatterns);
    /* --files-from limita findings reportados; los índices globales se mantienen para exactitud. */
    const includedCandidates = candidates.filter(file => isIncluded(file.fsPath, args.workspacePath, includePatterns));
    const findings: Array<{ ruta: string; finding: CoreFinding }> = [];
    const analysisConfig = buildAnalysisConfig(configFile);
    /* [028A-8 tramo 4] Con índice persistente + alcance scoped, los usos de
     * variables se resuelven desde el índice inverso (sin abrir todos los
     * documentos): token-unused consulta el mapa y el análisis documental solo
     * abre los archivos scoped. Sin índice, se conserva el recorrido completo
     * (exactitud LSP/editor sin persistencia). */
    const usageIndex = persistentStore && scopedFiles
        ? buildVariableReverseIndex(persistentStore.toSnapshot(persistentStore.identity))
        : undefined;
    const analysisTargets = usageIndex
        ? includedCandidates.filter(file => isScopedFile(file.fsPath, scopedFiles))
        : includedCandidates;
    const documents: Array<{ file: string; document: CoreTextDocument }> = [];
    const startedAnalysis = Date.now();
    for (const file of analysisTargets) {
        const document = await documentProvider.openTextDocument(file);
        documents.push({ file: file.fsPath, document });
        for (const documentFinding of analyzeVarsenseDocument(document, variableResult.indice, analysisConfig)) {
            findings.push({ ruta: file.fsPath, finding: documentFinding });
        }
    }
    const analysisDurationMs = Date.now() - startedAnalysis;
    for (const finding of analyzeTokenRules(variableResult.variablesPorArchivo, documents, analysisConfig, usageIndex)) {
        if (isFindingScoped(finding, scopedFiles)) {
            findings.push({ ruta: String(finding.metadata?.file), finding });
        }
    }
    findings.push(...classResult.clasesHuerfanas.filter(clase => isScopedFile(clase.archivo, scopedFiles)).map(clase => ({
        ruta: clase.archivo,
        finding: orphanClassToFinding(clase, configFile.orphanClassDetection?.severity ?? 'warning'),
    })));
    const entries = groupFindingsByFile(findings);
    const result: CliAnalysisResult = {
        entries,
        totalArchivos: includedCandidates.length + classResult.archivosAnalizadosCss + classResult.archivosAnalizadosConsumo,
        hasErrors: entries.some(entry => entry.findings.some(finding => finding.severity === 'error')),
        durationMs: Date.now() - startedAt,
        ...(persistentStore ? { cache: cacheStats(persistentStore) } : {}),
        metrics: buildMetrics({
            filesDiscovered: includedCandidates.length,
            filesAnalyzed: analysisTargets.length,
            reused: persistentStore?.stats.reused ?? 0,
            reparsed: persistentStore?.stats.reparsed ?? 0,
            durationMs: analysisDurationMs,
        }),
    };
    await persistentStore?.save();
    return result;
}

/* [028A-8 Fase 0] Métricas publicables del análisis documental. */
function buildMetrics(input: { filesDiscovered: number; filesAnalyzed: number; reused: number; reparsed: number; durationMs: number }): CliAnalysisResult['metrics'] {
    const reusedTotal = input.reused + input.reparsed;
    return {
        filesDiscovered: input.filesDiscovered,
        filesAnalyzed: input.filesAnalyzed,
        filesReused: input.reused,
        cacheHitRate: reusedTotal > 0 ? Math.round((input.reused / reusedTotal) * 1000) / 1000 : 0,
        peakRssMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
        scopeExpandedFiles: 0,
    };
}

/* [028A-8] Crea el store persistente cuando --index-dir está presente. La
 * identidad liga toolVersion + config efectiva + parser, por lo que un cambio
 * de cualquiera invalida el snapshot completo. */
async function createIndexStore(args: ParsedCliArgs, configFile: VarsenseConfigFile): Promise<FilePersistentIndexStore | undefined> {
    if (!args.indexDir) {
        return undefined;
    }
    const identity = indexIdentity(await readPackageVersion(), configHashFor(configFile), PARSER_VERSION);
    const persistentStore = new FilePersistentIndexStore(
        path.join(path.resolve(args.indexDir), PERSISTENT_INDEX_FILENAME),
        identity
    );
    await persistentStore.load();
    return persistentStore;
}

function cacheStats(store: FilePersistentIndexStore): CliAnalysisResult['cache'] {
    return {
        enabled: true,
        identity: store.identity,
        loaded: store.stats.loaded,
        reused: store.stats.reused,
        reparsed: store.stats.reparsed,
        removed: store.stats.removed,
        entries: store.entryCount,
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
            cache: result.cache ?? null,
            metrics: result.metrics ?? null,
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
