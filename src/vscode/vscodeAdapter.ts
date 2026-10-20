/* [045A-1] Adaptador entre el core de VarSense y VS Code: traduce documentos, rangos
 * y hallazgos. Vive fuera de src/core para que el core no dependa de vscode. */

import * as vscode from 'vscode';
import { CoreFinding, CoreRange, CoreSeverity, CoreTextDocument, createCoreDocument } from '@/core/types';
import { VarsenseDocumentAnalysisConfig } from '@/core/analisis/analyzeDocument';
import { buildAnalysisConfig } from '@/core/configuracion/config';
import { CONVENCION_AREA } from '../configuracion/convencionArea';
import { DiagnosticSeverityValue, ExtensionConfig } from '@/types';
import { buscarArchivos } from '@/utils/fileUtils';
import { DocumentProvider, FileWatcher, FileWatcherCallbacks, FileWatcherProvider, WorkspaceFile, WorkspaceFileProvider } from '@/core/proveedores/workspaceProviders';

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

/*
 * Severidad numérica de la extensión (valores de vscode.DiagnosticSeverity) a la del core
 */
const SEVERIDAD_CORE: Record<DiagnosticSeverityValue, CoreSeverity> = {
  0: 'error',
  1: 'warning',
  2: 'information',
  3: 'hint',
};

/*
 * Traduce la configuración de la extensión al formato de análisis del core.
 * La extensión no lee tokens ni la regla de botón: van con los defaults del core.
 */
export function configuracionAnalisisDesdeExtension(config: ExtensionConfig): VarsenseDocumentAnalysisConfig {
  const { deteccionHardcoded: hardcoded, deteccionInline: inline, deteccionPropiedadesProhibidas: prohibidas } = config;
  return {
    hardcoded: {
      habilitado: hardcoded.habilitado,
      severidad: SEVERIDAD_CORE[hardcoded.severidad],
      propiedades: hardcoded.propiedades,
      valoresPermitidos: hardcoded.valoresPermitidos,
    },
    inline: {
      habilitado: inline.habilitado,
      severidad: SEVERIDAD_CORE[inline.severidad],
    },
    bannedProperties: {
      habilitado: prohibidas.habilitado,
      severidad: SEVERIDAD_CORE[prohibidas.severidad],
      propiedades: prohibidas.propiedades,
    },
    tokens: buildAnalysisConfig({}, CONVENCION_AREA.estiloBoton).tokens,
    estiloBoton: buildAnalysisConfig({}, CONVENCION_AREA.estiloBoton).estiloBoton,
    lenguajes: buildAnalysisConfig({}, CONVENCION_AREA.estiloBoton).lenguajes,
  };
}
