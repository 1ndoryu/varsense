/* Render y escritura de la salida (markdown/JSON) y avisos de archivos omitidos. */
import * as fs from 'fs/promises';
import * as path from 'path';
import { countBySeverity, generarReporteMarkdown } from '@/core/analisis/report';
import { TAMANO_MAXIMO_ARCHIVO_BYTES } from '@/core/analisis/limites';
import type { ParsedCliArgs } from './args';
import { CliAnalysisResult, VARSENSE_JSON_SCHEMA_VERSION } from './tipos';

/* [O2] Con recorte, los conteos son los del análisis completo (no solo los hallazgos mostrados). */
export function severityCounts(result: CliAnalysisResult): Record<string, number> {
    return result.truncado?.severityCounts ?? countBySeverity(result.entries);
}

export function renderOutput(result: CliAnalysisResult, args: ParsedCliArgs, toolVersion: string): string {
    if (args.format === 'json') {
        return `${JSON.stringify({
            schemaVersion: VARSENSE_JSON_SCHEMA_VERSION,
            tool: { name: 'varsense', version: toolVersion },
            scope: 'workspace',
            command: args.command,
            durationMs: result.durationMs,
            severityCounts: severityCounts(result),
            totalArchivos: result.totalArchivos,
            totalArchivosConHallazgos: result.truncado?.archivosConHallazgos ?? result.entries.length,
            /* [O2] Campo aditivo: null cuando no hubo recorte por --max-hallazgos. */
            truncado: result.truncado ?? null,
            cache: result.cache ?? null,
            metrics: result.metrics ?? null,
            phaseDurationMs: result.phaseDurationMs ?? null,
            entries: result.entries,
        }, null, 2)}\n`;
    }

    return `${generarReporteMarkdown({
        entries: result.entries,
        totalArchivos: result.totalArchivos,
        truncado: result.truncado,
        relativizar: ruta => (path.relative(args.workspacePath, ruta) || ruta).replace(/\\/g, '/'),
    })}\n`;
}

export async function writeOrPrint(output: string, outputPath?: string): Promise<void> {
    if (!outputPath) {
        process.stdout.write(output);
        return;
    }

    const resolved = path.resolve(outputPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, output, 'utf8');
}

/* [V7] Informa en stderr los archivos omitidos por tamaño; stdout queda intacto para JSON y markdown. */
export function avisarOmitidos(omitidos: string[] | undefined, rutaBase: string): void {
    if (!omitidos || omitidos.length === 0) {
        return;
    }
    const relativos = omitidos.map(ruta => path.relative(rutaBase, ruta).replace(/\\/g, '/')).sort();
    const resto = relativos.length > 5 ? ` y ${relativos.length - 5} más` : '';
    const limiteMb = TAMANO_MAXIMO_ARCHIVO_BYTES / (1024 * 1024);
    process.stderr.write(`varsense: ${relativos.length} archivo(s) omitido(s) por superar ${limiteMb} MiB: ${relativos.slice(0, 5).join(', ')}${resto}\n`);
}
