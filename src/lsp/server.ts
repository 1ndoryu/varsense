#!/usr/bin/env node

import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    createConnection,
    Diagnostic,
    DiagnosticSeverity,
    MessageType,
    InitializeParams,
    InitializeResult,
    ProposedFeatures,
    TextDocumentSyncKind,
    TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyzeVarsenseDocument } from '@/core/analisis/analyzeDocument';
import { createCoreDocument } from '@/core/types';
import { NodeDocumentProvider, NodeWorkspaceFileProvider } from '@/node/nodeProviders';
import { VariableIndexBuilder } from '@/core/indices/variableIndexBuilder';
import {
    buildAnalysisConfig,
    DEFAULT_CSS_PATTERNS,
    DEFAULT_EXCLUDE_PATTERNS,
    DEFAULT_VARIABLE_PATTERNS,
    VarsenseConfigFile,
} from '@/core/configuracion/config';
import { cargarVarsenseConfig } from '@/node/configArchivo';
import { conTiempoLimite, TAMANO_MAXIMO_ARCHIVO_BYTES, TIMEOUT_LSP_MS } from '@/core/analisis/limites';
import { findingToLspDiagnostic } from './diagnostics';
import { crearCacheIndice } from './cacheIndice';
import { parserCssVarsense } from '@/parsers';

/* Un editor con miles de avisos se vuelve lento de pintar: se muestran los primeros. */
const MAX_DIAGNOSTICOS = 500;
/* Tecleo seguido: se valida al pausar, no en cada pulsación. */
const DEBOUNCE_VALIDACION_MS = 150;
/* Cambios fuera del editor (checkout, otra herramienta) se detectan al caducar la caché. */
const TTL_INDICE_MS = 30_000;

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let workspaceRoot: string | undefined;
const pendientes = new Map<string, ReturnType<typeof setTimeout>>();

function fsPathFromUri(uri: string): string {
    try {
        return fileURLToPath(uri);
    } catch {
        return uri;
    }
}

function workspaceRootFromParams(params: InitializeParams): string | undefined {
    const folderUri = params.workspaceFolders?.[0]?.uri;
    const rootUri = folderUri ?? params.rootUri;

    return rootUri ? fsPathFromUri(rootUri) : undefined;
}

function coreDocumentFromLsp(document: TextDocument) {
    const fileName = fsPathFromUri(document.uri);

    return createCoreDocument({
        uri: document.uri,
        fileName,
        languageId: document.languageId,
        content: document.getText(),
    });
}

function analysisErrorDiagnostic(message: string): Diagnostic {
    return {
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        severity: DiagnosticSeverity.Error,
        code: 'lsp-analysis-error',
        source: 'VarSense',
        message: `VarSense LSP analysis failed: ${message}`,
    };
}

/* Informativo, no error: el archivo es válido, solo queda fuera del análisis por tamaño. */
function archivoGrandeDiagnostic(): Diagnostic {
    return {
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        severity: DiagnosticSeverity.Information,
        code: 'lsp-archivo-grande',
        source: 'VarSense',
        message: `Archivo omitido del análisis: supera ${TAMANO_MAXIMO_ARCHIVO_BYTES / (1024 * 1024)} MiB`,
    };
}

interface ContextoAnalisis {
    config: VarsenseConfigFile;
    indice: Awaited<ReturnType<VariableIndexBuilder['build']>>['indice'];
}

/* Mismo varsense.config.json y mismos patrones que la CLI: el LSP no decide por su cuenta. */
async function construirContexto(rootPath: string): Promise<ContextoAnalisis> {
    const config = await cargarVarsenseConfig(path.resolve(rootPath, 'varsense.config.json'));
    const builder = new VariableIndexBuilder(
        new NodeWorkspaceFileProvider(rootPath),
        new NodeDocumentProvider(), parserCssVarsense
    );
    const resultado = await builder.build({
        patterns: config.scanAllFiles ? DEFAULT_CSS_PATTERNS : (config.variableFiles ?? DEFAULT_VARIABLE_PATTERNS),
        exclude: config.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS,
    });

    return { config, indice: resultado.indice };
}

const cacheContexto = crearCacheIndice({ construir: construirContexto, ttlMs: TTL_INDICE_MS });

async function diagnosticosDelDocumento(document: TextDocument, rootPath: string): Promise<Diagnostic[]> {
    // Medir en bytes UTF-8: el mismo criterio que el límite de la CLI sobre el archivo en disco.
    if (Buffer.byteLength(document.getText(), 'utf8') > TAMANO_MAXIMO_ARCHIVO_BYTES) {
        return [archivoGrandeDiagnostic()];
    }

    const { config, indice } = await cacheContexto.obtener(rootPath);
    const findings = analyzeVarsenseDocument(
        coreDocumentFromLsp(document),
        indice,
        buildAnalysisConfig(config), parserCssVarsense
    );

    if (findings.length > MAX_DIAGNOSTICOS) {
        connection.sendNotification('window/logMessage', { type: MessageType.Warning, message: `[VarSense LSP] ${document.uri}: ${findings.length} hallazgos; se muestran ${MAX_DIAGNOSTICOS}` });
    }

    return findings.slice(0, MAX_DIAGNOSTICOS).map(findingToLspDiagnostic);
}

async function validateTextDocument(document: TextDocument): Promise<void> {
    const version = document.version;
    const fileName = fsPathFromUri(document.uri);
    const rootPath = workspaceRoot ?? path.dirname(fileName);
    // Un análisis lento puede acabar después de una edición más reciente: su resultado ya no describe el texto.
    const esObsoleto = () => documents.get(document.uri)?.version !== version;

    try {
        const diagnostics = await conTiempoLimite(diagnosticosDelDocumento(document, rootPath), TIMEOUT_LSP_MS);
        if (esObsoleto()) {
            return;
        }

        connection.sendDiagnostics({ uri: document.uri, diagnostics });
    } catch (error) {
        if (esObsoleto()) {
            return;
        }

        const message = error instanceof Error ? error.message : String(error);
        connection.sendNotification('window/logMessage', { type: MessageType.Error, message: `[VarSense LSP] ${message}` });
        connection.sendDiagnostics({
            uri: document.uri,
            diagnostics: [analysisErrorDiagnostic(message)],
        });
    }
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
    workspaceRoot = workspaceRootFromParams(params);

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
        },
    };
});

function programarValidacion(uri: string): void {
    clearTimeout(pendientes.get(uri));
    pendientes.set(uri, setTimeout(() => {
        pendientes.delete(uri);
        const document = documents.get(uri);
        if (document) {
            void validateTextDocument(document);
        }
    }, DEBOUNCE_VALIDACION_MS));
}

documents.onDidOpen(event => {
    void validateTextDocument(event.document);
});

documents.onDidChangeContent(event => {
    programarValidacion(event.document.uri);
});

// Un guardado puede cambiar variables o la configuración: la caché del índice deja de valer.
documents.onDidSave(() => {
    cacheContexto.invalidar();
});

documents.onDidClose(event => {
    clearTimeout(pendientes.get(event.document.uri));
    pendientes.delete(event.document.uri);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
