/*
 * Quick fixes (code actions) para los diagnósticos de CSS Vars Validator
 * - Valores y fallbacks hardcodeados: sustituir por var() de variables similares
 * - Variables no definidas: corregir el nombre a una variable parecida
 */

import * as vscode from 'vscode';
import {DiagnosticType} from '@/types';
import {VariableScanner} from '@/vscode/services/variableScanner';
import {obtenerResolver} from '@/vscode/services/variableResolver';
import {obtenerMetadataDiagnostico} from '@/vscode/providers/diagnosticMetadata';

/*
 * Provider de código de acciones (quick fixes)
 */
export class DiagnosticCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    public provideCodeActions(documento: vscode.TextDocument, rango: vscode.Range | vscode.Selection, contexto: vscode.CodeActionContext, _token: vscode.CancellationToken): vscode.CodeAction[] | undefined {
        const acciones: vscode.CodeAction[] = [];

        for (const diagnostic of contexto.diagnostics) {
            /* Solo procesar diagnósticos de nuestra extensión */
            if (diagnostic.source !== 'CSS Vars Validator') {
                continue;
            }

            switch (diagnostic.code) {
                case DiagnosticType.ValorHardcoded:
                case DiagnosticType.FallbackHardcoded:
                    acciones.push(...this.crearAccionesHardcoded(documento, diagnostic));
                    break;

                case DiagnosticType.VariableNoDefinida:
                    acciones.push(...this.crearAccionesVariableNoDefinida(documento, diagnostic));
                    break;
            }
        }

        return acciones;
    }

    /*
     * Crea acciones para valores hardcodeados
     */
    private crearAccionesHardcoded(documento: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction[] {
        const acciones: vscode.CodeAction[] = [];

        /* Obtener metadatos (propiedad y valor) registrados al crear el diagnóstico */
        const data = obtenerMetadataDiagnostico(diagnostic);

        if (!data) {
            return acciones;
        }

        /* Buscar variables sugeridas (import estático: variableResolver no depende de este provider, sin ciclo) */
        const sugerencias = obtenerResolver().sugerirVariablesParaValor(data.valor, 3);

        for (const variable of sugerencias) {
            const accion = new vscode.CodeAction(`Reemplazar con var(${variable.nombre})`, vscode.CodeActionKind.QuickFix);

            accion.diagnostics = [diagnostic];
            accion.edit = new vscode.WorkspaceEdit();
            accion.edit.replace(documento.uri, diagnostic.range, `var(${variable.nombre})`);

            accion.isPreferred = sugerencias.indexOf(variable) === 0;
            acciones.push(accion);
        }

        return acciones;
    }

    /*
     * Crea acciones para variables no definidas
     */
    private crearAccionesVariableNoDefinida(documento: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction[] {
        const acciones: vscode.CodeAction[] = [];

        /* Extraer nombre de variable del mensaje */
        const nombreMatch = /Variable '(--[\w-]+)'/.exec(diagnostic.message);
        if (!nombreMatch) {
            return acciones;
        }

        const nombreVariable = nombreMatch[1];

        /* Buscar variables similares */
        const scanner = VariableScanner.obtenerInstancia();
        const todasVariables = scanner.obtenerTodasVariables();

        /* Encontrar variables con nombres similares */
        const similares = todasVariables
            .filter(v => {
                const similitud = calcularSimilitud(v.nombre, nombreVariable);
                return similitud > 0.5;
            })
            .sort((a, b) => {
                const simA = calcularSimilitud(a.nombre, nombreVariable);
                const simB = calcularSimilitud(b.nombre, nombreVariable);
                return simB - simA;
            })
            .slice(0, 3);

        for (const variable of similares) {
            const accion = new vscode.CodeAction(`¿Quisiste decir var(${variable.nombre})?`, vscode.CodeActionKind.QuickFix);

            accion.diagnostics = [diagnostic];
            accion.edit = new vscode.WorkspaceEdit();

            /* Reemplazar el nombre de la variable en var() */
            const textoLinea = documento.lineAt(diagnostic.range.start.line).text;
            const varRegex = new RegExp(`var\\(\\s*${nombreVariable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`);
            const match = varRegex.exec(textoLinea);

            if (match) {
                const inicioReemplazo = textoLinea.indexOf(match[0]);
                const finReemplazo = inicioReemplazo + match[0].length;

                accion.edit.replace(documento.uri, new vscode.Range(diagnostic.range.start.line, inicioReemplazo, diagnostic.range.start.line, finReemplazo), `var(${variable.nombre}`);
            }

            acciones.push(accion);
        }

        return acciones;
    }
}

/*
 * Calcula similitud entre dos strings (algoritmo simple)
 */
function calcularSimilitud(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
        return 1.0;
    }

    const editDistance = calcularDistanciaEdicion(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

/*
 * Calcula la distancia de edición (Levenshtein)
 */
function calcularDistanciaEdicion(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = [];

    for (let i = 0; i <= m; i++) {
        dp[i] = [i];
    }

    for (let j = 0; j <= n; j++) {
        dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(dp[i - 1][j - 1] + 1, dp[i][j - 1] + 1, dp[i - 1][j] + 1);
            }
        }
    }

    return dp[m][n];
}
