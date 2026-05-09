#!/usr/bin/env node

import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    createConnection,
    Diagnostic,
    DiagnosticSeverity,
    InitializeParams,
    InitializeResult,
    ProposedFeatures,
    TextDocumentSyncKind,
    TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyzeVarsenseDocument } from '@/core/analyzeDocument';
import { createCoreDocument } from '@/core/types';
import { NodeDocumentProvider, NodeWorkspaceFileProvider } from '@/core/nodeProviders';
import { VariableIndexBuilder } from '@/core/variableIndexBuilder';
import {
    buildAnalysisConfig,
    DEFAULT_EXCLUDE_PATTERNS,
    DEFAULT_VARIABLE_PATTERNS,
} from '@/cli';
import { findingToLspDiagnostic } from './diagnostics';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let workspaceRoot: string | undefined;

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

async function buildVariableIndex(rootPath: string) {
    const fileProvider = new NodeWorkspaceFileProvider(rootPath);
    const documentProvider = new NodeDocumentProvider();
    const builder = new VariableIndexBuilder(fileProvider, documentProvider);

    return builder.build({
        patterns: DEFAULT_VARIABLE_PATTERNS,
        exclude: DEFAULT_EXCLUDE_PATTERNS,
    });
}

async function validateTextDocument(document: TextDocument): Promise<void> {
    const fileName = fsPathFromUri(document.uri);
    const rootPath = workspaceRoot ?? path.dirname(fileName);

    try {
        const variableResult = await buildVariableIndex(rootPath);
        const findings = analyzeVarsenseDocument(
            coreDocumentFromLsp(document),
            variableResult.indice,
            buildAnalysisConfig({})
        );

        connection.sendDiagnostics({
            uri: document.uri,
            diagnostics: findings.map(findingToLspDiagnostic),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        connection.console.error(`[VarSense LSP] ${message}`);
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

documents.onDidOpen(event => {
    void validateTextDocument(event.document);
});

documents.onDidChangeContent(event => {
    void validateTextDocument(event.document);
});

documents.onDidClose(event => {
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
