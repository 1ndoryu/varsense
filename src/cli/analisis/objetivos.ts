/* Orquestación del análisis de cada comando (scan, orphan-classes, all) sobre el workspace. */
import { pathToFileURL } from 'url';
import { CoreFinding, CoreTextDocument } from '@/core/types';
import { CachedNodeDocumentProvider, NodeWorkspaceFileProvider } from '@/node/nodeProviders';
import type { CancellationToken, DocumentProvider } from '@/core/proveedores/workspaceProviders';
import { throwIfCancelled } from '@/core/proveedores/workspaceProviders';
import { VariableIndexBuilder } from '@/core/indices/variableIndexBuilder';
import { buildVariableReverseIndex } from '@/core/indices/persistentIndex';
import { ClassIndexBuilder } from '@/core/indices/classIndexBuilder';
import { analyzeVarsenseDocument, orphanClassToFinding, parsearLineasSuprimidas } from '@/core/analisis/analyzeDocument';
import { analyzeCrossFileDuplicates, analyzeTokenRules } from '@/core/analisis/tokenRules';
import { VarsenseReportEntry } from '@/core/analisis/report';
import {
    DEFAULT_CSS_PATTERNS,
    DEFAULT_EXCLUDE_PATTERNS,
    DEFAULT_INCLUDE_PATTERNS,
    DEFAULT_REACT_PATTERNS,
    DEFAULT_SCRIPT_PATTERNS,
    DEFAULT_VARIABLE_PATTERNS,
    EXTENSIONES_CSS_POR_DEFECTO,
    VarsenseConfigFile,
    buildAnalysisConfig,
} from '@/core/configuracion/config';
import { CONVENCION_AREA } from '../../configuracion/convencionArea';
import { parserCssVarsense } from '@/parsers';
import type { ParsedCliArgs } from '../args';
import { CliAnalysisResult } from '../tipos';
import { readConfig } from '../configuracion';
import { isFindingScoped, isIncluded, isScopedFile, readFilesFromManifest } from './rutas';
import { buildMetrics, createPhaseTimer } from './metricas';
import { cacheStats, createIndexStore } from './indiceCache';

/* [VQ5] Decide qué archivos alimentan el índice de variables: extensiones CSS configurables (por defecto `.css`). */
function esArchivoCss(ruta: string, configFile: VarsenseConfigFile): boolean {
    return (configFile.languages?.cssExtensions ?? EXTENSIONES_CSS_POR_DEFECTO).some(extension => ruta.endsWith(extension));
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

/* El token (si llega) se consulta entre archivos: un análisis cancelado por timeout se detiene sin terminar el resto. */
export async function analyzeScanTarget(args: ParsedCliArgs, token?: CancellationToken): Promise<CliAnalysisResult> {
    const startedAt = Date.now();
    const timer = createPhaseTimer();
    const configFile = await readConfig(args.configPath, args.workspacePath);
    const scopedFiles = await readFilesFromManifest(args);
    const analysisConfig = buildAnalysisConfig(configFile, CONVENCION_AREA.estiloBoton);
    const includePatterns = configFile.includePatterns ?? DEFAULT_INCLUDE_PATTERNS;
    const excludePatterns = configFile.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
    const fileProvider = new NodeWorkspaceFileProvider(args.workspacePath);
    /* Caché de documentos: el índice de variables y el análisis leen los mismos
     * archivos; con caché cada uno se lee del disco una sola vez. */
    const documentProvider = new CachedNodeDocumentProvider();
    const persistentStore = await createIndexStore(args, configFile);
    const variableBuilder = new VariableIndexBuilder(fileProvider, documentProvider, parserCssVarsense, persistentStore);
    const variablePatterns = configFile.scanAllFiles
        ? DEFAULT_CSS_PATTERNS
        : (configFile.variableFiles ?? DEFAULT_VARIABLE_PATTERNS);
    timer.mark('configMs');

    const variableResult = await variableBuilder.build({
        patterns: variablePatterns,
        exclude: excludePatterns,
        token,
    });
    timer.mark('variableIndexMs');

    const candidates = await fileProvider.findFiles(
        [...DEFAULT_CSS_PATTERNS, ...DEFAULT_REACT_PATTERNS, ...DEFAULT_SCRIPT_PATTERNS],
        excludePatterns
    );
    /* --files-from limita findings reportados; los índices globales se mantienen para exactitud. */
    const includedCandidates = candidates.filter(file => isIncluded(file.fsPath, args.workspacePath, includePatterns) && isScopedFile(file.fsPath, scopedFiles));
    timer.mark('discoveryMs');
    /* [318A-7V24] Completa el índice de variables ANTES de analizar:
     * 1) definiciones runtime setProperty('--x') de los scripts incluidos;
     * 2) CSS incluidos con scope (:host, #id, .clase) que variableFiles no
     * cubre. Sin esto, var(--sidebar-ancho)/var(--lateral-ancho) y las 12
     * variables setProperty de GH se reportan como variableNoDefinida. */
    await variableBuilder.agregarDefinicionesRuntime(
        includedCandidates,
        variableResult.indice.variables,
        variableResult.variablesPorArchivo
    );
    for (const file of includedCandidates) {
        if (!esArchivoCss(file.fsPath, configFile) || variableResult.variablesPorArchivo.has(file.fsPath)) {
            continue;
        }
        await variableBuilder.addFileToIndex(file, variableResult.indice.variables, variableResult.variablesPorArchivo, token);
    }
    const findings: Array<{ ruta: string; finding: CoreFinding }> = [];

    for (const file of includedCandidates) {
        throwIfCancelled(token);
        const document = await documentProvider.openTextDocument(file);
        const documentFindings = analyzeVarsenseDocument(document, variableResult.indice, analysisConfig, parserCssVarsense);
        for (const documentFinding of documentFindings) {
            findings.push({ ruta: file.fsPath, finding: documentFinding });
        }
    }
    timer.mark('analyzeMs');

    const entries = groupFindingsByFile(findings);
    timer.mark('groupMs');
    const result: CliAnalysisResult = {
        entries,
        totalArchivos: includedCandidates.length,
        omitidosPorTamano: fileProvider.omitidosPorTamano,
        hasErrors: entries.some(entry => entry.findings.some(finding => finding.severity === 'error')),
        durationMs: Date.now() - startedAt,
        ...(persistentStore ? { cache: cacheStats(persistentStore) } : {}),
        metrics: buildMetrics({
            filesDiscovered: candidates.length,
            filesAnalyzed: includedCandidates.length,
            reused: persistentStore?.stats.reused ?? 0,
            reparsed: persistentStore?.stats.reparsed ?? 0,
            durationMs: Date.now() - startedAt,
        }),
        phaseDurationMs: timer.phases,
    };
    await persistentStore?.save();
    timer.mark('saveMs');
    return result;
}

/* [15A-27] El analisis de claseHuerfana sale del indice de clases, que no mira
 * los marcadores de supresion; el resto de reglas si, porque pasan por
 * analyzeVarsenseDocument. Se filtran aqui, con el MISMO parser y leyendo cada
 * hoja una sola vez, para que un marcador sobre la linea de definicion de una
 * clase calle el hallazgo igual que en cualquier otra regla. Sin esto el
 * marcador existia y no hacia nada (un proyecto real: `.prose` y compania).
 * `clase.linea` y el set del parser son ambos 0-based: se comparan tal cual
 * (restar 1 hacia que el marcador callara tambien la linea siguiente). */
async function filtrarClasesSuprimidas<T extends { archivo: string; linea: number }>(
    clases: T[],
    documentProvider: DocumentProvider
): Promise<T[]> {
    const suprimidas = new Map<string, Set<number> | null>();
    const conservadas: T[] = [];
    for (const clase of clases) {
        if (!suprimidas.has(clase.archivo)) {
            /* Pasa por el proveedor (con caché en `all`) para no releer archivos ya leídos. */
            const documento = await documentProvider
                .openTextDocument({ uri: pathToFileURL(clase.archivo).toString(), fsPath: clase.archivo })
                .catch(() => null);
            suprimidas.set(clase.archivo, documento === null ? null : parsearLineasSuprimidas(documento.getText()));
        }
        const lineas = suprimidas.get(clase.archivo);
        if (lineas && lineas.has(clase.linea)) {
            continue;
        }
        conservadas.push(clase);
    }
    return conservadas;
}

export async function analyzeOrphanClassesTarget(args: ParsedCliArgs, token?: CancellationToken): Promise<CliAnalysisResult> {
    const startedAt = Date.now();
    const configFile = await readConfig(args.configPath, args.workspacePath);
    const scopedFiles = await readFilesFromManifest(args);
    const excludePatterns = configFile.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
    const fileProvider = new NodeWorkspaceFileProvider(args.workspacePath);
    const documentProvider = new CachedNodeDocumentProvider();
    const persistentStore = await createIndexStore(args, configFile);
    const builder = new ClassIndexBuilder(fileProvider, documentProvider, undefined, persistentStore);
    const result = await builder.scan({
        exclude: excludePatterns,
        minLength: configFile.orphanClassDetection?.minClassLength ?? 3,
        excludedClassPatterns: configFile.orphanClassDetection?.excludeClassPatterns ?? [],
        prefijosPortadores: configFile.prefijosPortadores ?? CONVENCION_AREA.prefijosPortadores,
        shorthandTailwind: configFile.tokenDetection?.tailwindShorthand ?? true,
        token,
    });

    const clasesHuerfanas = await filtrarClasesSuprimidas(result.clasesHuerfanas, documentProvider);
    const entries = groupFindingsByFile(clasesHuerfanas.filter(clase => isScopedFile(clase.archivo, scopedFiles)).map(clase => ({
        ruta: clase.archivo,
        finding: orphanClassToFinding(clase, configFile.orphanClassDetection?.severity ?? 'warning'),
    })));

    const output: CliAnalysisResult = {
        entries,
        totalArchivos: result.archivosAnalizadosCss + result.archivosAnalizadosConsumo,
        omitidosPorTamano: fileProvider.omitidosPorTamano,
        hasErrors: entries.some(entry => entry.findings.some(finding => finding.severity === 'error')),
        durationMs: Date.now() - startedAt,
        ...(persistentStore ? { cache: cacheStats(persistentStore) } : {}),
    };
    await persistentStore?.save();
    return output;
}

export async function analyzeAllTarget(args: ParsedCliArgs, token?: CancellationToken): Promise<CliAnalysisResult> {
    const startedAt = Date.now();
    const timer = createPhaseTimer();
    const configFile = await readConfig(args.configPath, args.workspacePath);
    const scopedFiles = await readFilesFromManifest(args);
    const excludePatterns = configFile.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
    const fileProvider = new NodeWorkspaceFileProvider(args.workspacePath);
    const documentProvider = new CachedNodeDocumentProvider();
    const persistentStore = await createIndexStore(args, configFile);
    const variableBuilder = new VariableIndexBuilder(fileProvider, documentProvider, parserCssVarsense, persistentStore);
    const variablePatterns = configFile.scanAllFiles ? DEFAULT_CSS_PATTERNS : (configFile.variableFiles ?? DEFAULT_VARIABLE_PATTERNS);
    timer.mark('configMs');
    const variableResult = await variableBuilder.build({ patterns: variablePatterns, exclude: excludePatterns, token });
    timer.mark('variableIndexMs');
    const classBuilder = new ClassIndexBuilder(fileProvider, documentProvider, documentProvider, persistentStore);
    const classResult = await classBuilder.scan({
        exclude: excludePatterns,
        minLength: configFile.orphanClassDetection?.minClassLength ?? 3,
        excludedClassPatterns: configFile.orphanClassDetection?.excludeClassPatterns ?? [],
        prefijosPortadores: configFile.prefijosPortadores ?? CONVENCION_AREA.prefijosPortadores,
        shorthandTailwind: configFile.tokenDetection?.tailwindShorthand ?? true,
        token,
    });
    timer.mark('classIndexMs');
    const includePatterns = configFile.includePatterns ?? DEFAULT_INCLUDE_PATTERNS;
    const candidates = await fileProvider.findFiles([...DEFAULT_CSS_PATTERNS, ...DEFAULT_REACT_PATTERNS, ...DEFAULT_SCRIPT_PATTERNS], excludePatterns);
    /* --files-from limita findings reportados; los índices globales se mantienen para exactitud. */
    const includedCandidates = candidates.filter(file => isIncluded(file.fsPath, args.workspacePath, includePatterns));
    timer.mark('discoveryMs');
    /* [318A-7V24] Igual que en scan: definiciones runtime + CSS con scope
     * antes del análisis (ver comentario en analyzeScanTarget). */
    await variableBuilder.agregarDefinicionesRuntime(
        includedCandidates,
        variableResult.indice.variables,
        variableResult.variablesPorArchivo
    );
    for (const file of includedCandidates) {
        if (!esArchivoCss(file.fsPath, configFile) || variableResult.variablesPorArchivo.has(file.fsPath)) {
            continue;
        }
        await variableBuilder.addFileToIndex(file, variableResult.indice.variables, variableResult.variablesPorArchivo, token);
    }
    const findings: Array<{ ruta: string; finding: CoreFinding }> = [];
    const analysisConfig = buildAnalysisConfig(configFile, CONVENCION_AREA.estiloBoton);
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
        throwIfCancelled(token);
        const document = await documentProvider.openTextDocument(file);
        documents.push({ file: file.fsPath, document });
        /* [028A-8 tramo 4] Los hallazgos documentales solo se reportan para el
         * alcance scoped (con usageIndex activo analysisTargets ya es scoped;
         * sin indice se abren todos para el escaneo de texto de token-unused
         * pero se reportan unicamente los del alcance). */
        if (isScopedFile(file.fsPath, scopedFiles)) {
            for (const documentFinding of analyzeVarsenseDocument(document, variableResult.indice, analysisConfig, parserCssVarsense)) {
                findings.push({ ruta: file.fsPath, finding: documentFinding });
            }
        }
    }
    const analysisDurationMs = Date.now() - startedAnalysis;
    timer.mark('analyzeMs');
    for (const finding of analyzeTokenRules(variableResult.variablesPorArchivo, documents, analysisConfig, usageIndex)) {
        if (isFindingScoped(finding, scopedFiles)) {
            findings.push({ ruta: String(finding.metadata?.file), finding });
        }
    }
    /* [149A-1 F3.15] Duplicados cross-archivo: regla separada con el mismo
     * alcance que token-duplicate; no modifica su semántica same-file. */
    for (const finding of analyzeCrossFileDuplicates(variableResult.variablesPorArchivo, analysisConfig)) {
        if (isFindingScoped(finding, scopedFiles)) {
            findings.push({ ruta: String(finding.metadata?.file), finding });
        }
    }
    timer.mark('tokenRulesMs');
    findings.push(...(await filtrarClasesSuprimidas(classResult.clasesHuerfanas, documentProvider)).filter(clase => isScopedFile(clase.archivo, scopedFiles)).map(clase => ({
        ruta: clase.archivo,
        finding: orphanClassToFinding(clase, configFile.orphanClassDetection?.severity ?? 'warning'),
    })));
    timer.mark('orphanMs');
    const entries = groupFindingsByFile(findings);
    timer.mark('groupMs');
    const result: CliAnalysisResult = {
        entries,
        totalArchivos: includedCandidates.length + classResult.archivosAnalizadosCss + classResult.archivosAnalizadosConsumo,
        omitidosPorTamano: fileProvider.omitidosPorTamano,
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
        phaseDurationMs: timer.phases,
    };
    await persistentStore?.save();
    timer.mark('saveMs');
    return result;
}

export async function analyzeCliTarget(args: ParsedCliArgs, token?: CancellationToken): Promise<CliAnalysisResult> {
    if (args.command === 'scan') {
        return analyzeScanTarget(args, token);
    }
    if (args.command === 'orphan-classes') {
        return analyzeOrphanClassesTarget(args, token);
    }
    return analyzeAllTarget(args, token);
}
