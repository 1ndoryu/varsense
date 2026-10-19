/* Temporizador de fases y métricas publicables del análisis de la CLI. */
import { CliAnalysisResult } from '../tipos';

/* [108A-1 Fase 3] Temporizador de fases: cada mark() acumula los ms desde el
 * mark anterior (o desde el arranque). Publicado como phaseDurationMs para
 * atribuir el coste del análisis a su cuello dominante. */
export function createPhaseTimer(): { mark: (name: string) => void; phases: Record<string, number> } {
    let cursor = Date.now();
    const phases: Record<string, number> = {};
    return {
        mark(name: string): void {
            const now = Date.now();
            phases[name] = now - cursor;
            cursor = now;
        },
        phases,
    };
}

/* [028A-8 Fase 0] Métricas publicables del análisis documental. */
export function buildMetrics(input: { filesDiscovered: number; filesAnalyzed: number; reused: number; reparsed: number; durationMs: number }): CliAnalysisResult['metrics'] {
    const reusedTotal = input.reused + input.reparsed;
    return {
        filesDiscovered: input.filesDiscovered,
        filesAnalyzed: input.filesAnalyzed,
        filesReused: input.reused,
        cacheHitRate: reusedTotal > 0 ? Math.round((input.reused / reusedTotal) * 1000) / 1000 : 0,
        peakRssMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
    };
}
