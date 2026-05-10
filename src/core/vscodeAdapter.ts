/* [045A-1] Adaptador entre los hallazgos core de VarSense y diagnosticos VS Code.
 * Pendiente: los providers seguiran usando VS Code hasta mover parser y scanners al core. */

import * as vscode from 'vscode';
import { CoreFinding, CoreRange, CoreSeverity, CoreTextDocument, createCoreDocument } from './types';
import { buscarArchivos } from '@/utils/fileUtils';
import { DocumentProvider, FileWatcher, FileWatcherCallbacks, FileWatcherProvider, WorkspaceFile, WorkspaceFileProvider } from './workspaceProviders';

export function documentFromVsCode(document: vscode.TextDocument): CoreTextDocument {
  return createCoreDocument({
    uri: document.uri.toString(),
    fileName: document.fileName,
    languageId: document.languageId,
    content: document.getText(),
  });
}

export function workspaceFileFromVsCodeUri(uri: vscode.Uri): WorkspaceFile {
  return {
    uri: uri.toString(),
    fsPath: uri.fsPath,
  };
}

export class VscodeWorkspaceFileProvider implements WorkspaceFileProvider {
  public async findFiles(patterns: string[], exclude: string[]): Promise<WorkspaceFile[]> {
    const archivos = await buscarArchivos(patterns, exclude);
    return archivos.map(workspaceFileFromVsCodeUri);
  }
}

export class VscodeDocumentProvider implements DocumentProvider {
  public async openTextDocument(file: WorkspaceFile): Promise<CoreTextDocument> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file.fsPath));
    return documentFromVsCode(document);
  }
}

export class VscodeFileWatcherProvider implements FileWatcherProvider {
  public createWatchers(patterns: string[], callbacks: FileWatcherCallbacks): FileWatcher[] {
    const watchers: vscode.Disposable[] = [];

    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      if (callbacks.onCreate) {
        watchers.push(watcher.onDidCreate(uri => callbacks.onCreate?.(workspaceFileFromVsCodeUri(uri))));
      }
      if (callbacks.onChange) {
        watchers.push(watcher.onDidChange(uri => callbacks.onChange?.(workspaceFileFromVsCodeUri(uri))));
      }
      if (callbacks.onDelete) {
        watchers.push(watcher.onDidDelete(uri => callbacks.onDelete?.(workspaceFileFromVsCodeUri(uri))));
      }

      watchers.push(watcher);
    }

    return watchers;
  }
}

export function severityToDiagnosticSeverity(severity: CoreSeverity): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'error': return vscode.DiagnosticSeverity.Error;
    case 'warning': return vscode.DiagnosticSeverity.Warning;
    case 'information': return vscode.DiagnosticSeverity.Information;
    case 'hint': return vscode.DiagnosticSeverity.Hint;
  }
}

export function rangeToVsCodeRange(range: CoreRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
}

export function findingToDiagnostic(finding: CoreFinding): vscode.Diagnostic {
  const message = finding.suggestion
    ? `${finding.message}\nSugerencia: ${finding.suggestion}`
    : finding.message;
  const diagnostic = new vscode.Diagnostic(
    rangeToVsCodeRange(finding.range),
    message,
    severityToDiagnosticSeverity(finding.severity)
  );
  diagnostic.source = finding.source;
  diagnostic.code = finding.ruleId;
  return diagnostic;
}
