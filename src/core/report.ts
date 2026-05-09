import * as path from 'path';
import { CoreFinding } from './types';

export interface VarsenseReportEntry {
    ruta: string;
    findings: CoreFinding[];
}

export interface VarsenseReportInput {
    entries: VarsenseReportEntry[];
    totalArchivos: number;
    rutaBase: string;
    fecha?: Date;
}

function escapeMarkdown(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function relativePath(basePath: string, filePath: string): string {
    const relative = path.relative(basePath, filePath);
    return (relative || filePath).replace(/\\/g, '/');
}

function countBySeverity(entries: VarsenseReportEntry[]): Record<string, number> {
    const counts = { error: 0, warning: 0, information: 0, hint: 0 };

    for (const entry of entries) {
        for (const finding of entry.findings) {
            counts[finding.severity]++;
        }
    }

    return counts;
}

export function generarReporteMarkdown(input: VarsenseReportInput): string {
    const fecha = input.fecha ?? new Date();
    const counts = countBySeverity(input.entries);
    const totalFindings = input.entries.reduce((total, entry) => total + entry.findings.length, 0);
    const lines: string[] = [];

    lines.push('# VarSense Report');
    lines.push('');
    lines.push(`- **Fecha:** ${fecha.toISOString()}`);
    lines.push(`- **Archivos analizados:** ${input.totalArchivos}`);
    lines.push(`- **Archivos con hallazgos:** ${input.entries.length}`);
    lines.push(`- **Total hallazgos:** ${totalFindings}`);
    lines.push(`- **Errores:** ${counts.error}`);
    lines.push(`- **Warnings:** ${counts.warning}`);
    lines.push(`- **Information:** ${counts.information}`);
    lines.push(`- **Hints:** ${counts.hint}`);
    lines.push('');

    for (const entry of input.entries) {
        lines.push(`## ${relativePath(input.rutaBase, entry.ruta)} (${entry.findings.length} hallazgos)`);
        lines.push('');
        lines.push('| Regla | Severidad | Linea | Mensaje |');
        lines.push('|---|---|---:|---|');

        for (const finding of entry.findings) {
            lines.push(`| ${escapeMarkdown(finding.ruleId)} | ${finding.severity} | ${finding.range.start.line + 1} | ${escapeMarkdown(finding.message)} |`);
        }

        lines.push('');
    }

    return lines.join('\n');
}
