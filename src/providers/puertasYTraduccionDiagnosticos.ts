/*
 * Puertas y traducción de diagnósticos
 * - Decide qué documentos son analizables (CSS o React, según include/exclude)
 * - Convierte hallazgos del core en diagnósticos de VS Code
 */

import * as vscode from 'vscode';
import {DiagnosticType} from '@/types';
import {obtenerConfigService} from '@/services/configService';
import {esLenguajeSoportado, coincideConPatron} from '@/utils/fileUtils';
import { CoreFinding } from '@/core/types';
import { findingToDiagnostic } from '@/vscode/vscodeAdapter';
import { registrarMetadataDiagnostico } from '@/providers/diagnosticMetadata';

/*
 * Lenguajes React para detección de inline CSS
 */
export const LENGUAJES_REACT = ['typescriptreact', 'javascriptreact'];

/*
 * Verifica si el documento es soportado (CSS o React)
 */
export function esDocumentoSoportado(doc: vscode.TextDocument): boolean {
    const lenguajeSoportado = esLenguajeSoportado(doc) || LENGUAJES_REACT.includes(doc.languageId);

    if (!lenguajeSoportado) {
        return false;
    }

    const configService = obtenerConfigService();
    const ruta = doc.uri.fsPath;
    const incluidos = configService.obtenerPatronesIncluidos();
    const excluidos = configService.obtenerPatronesExcluidos();

    if (incluidos.length > 0 && !coincideConPatron(ruta, incluidos)) {
        return false;
    }

    if (coincideConPatron(ruta, excluidos)) {
        return false;
    }

    return true;
}

/*
 * Convierte un hallazgo del core en diagnóstico de VS Code. La fuente debe ser
 * 'CSS Vars Validator': el quick fix filtra por ella.
 */
export function diagnosticoDesdeHallazgo(hallazgo: CoreFinding): vscode.Diagnostic {
    const diagnostic = findingToDiagnostic(hallazgo);
    diagnostic.source = 'CSS Vars Validator';

    /* El quick fix de valores hardcodeados necesita propiedad y valor */
    if (hallazgo.ruleId === DiagnosticType.ValorHardcoded) {
        registrarMetadataDiagnostico(diagnostic, {
            propiedad: String(hallazgo.metadata?.property ?? ''),
            valor: String(hallazgo.metadata?.value ?? ''),
        });
    }

    return diagnostic;
}
