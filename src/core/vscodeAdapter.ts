/* [045A-1] Adaptador entre los hallazgos core de VarSense y diagnosticos VS Code.
 * Pendiente: los providers seguiran usando VS Code hasta mover parser y scanners al core. */

import * as vscode from 'vscode';
import { CoreFinding, CoreRange, CoreSeverity, CoreTextDocument, createCoreDocument } from './types';

export function documentFromVsCode(document: vscode.TextDocument): CoreTextDocument {
  return createCoreDocument({
    uri: document.uri.toString(),
    fileName: document.fileName,
    languageId: document.languageId,
    content: document.getText(),
  });
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
