/* Tipos y constantes públicas del resultado de la CLI (contrato del JSON). */
import { VarsenseReportEntry } from '@/core/analisis/report';
import type { TruncadoHallazgos } from '@/core/analisis/report';

export interface CliAnalysisResult {
    entries: VarsenseReportEntry[];
    totalArchivos: number;
    hasErrors: boolean;
    /* [O2] Presente solo si --max-hallazgos recortó la salida; `hasErrors` sigue calculado sobre el total. */
    truncado?: TruncadoHallazgos;
    /* [V7] Archivos que superaron el tamaño máximo; se informan en stderr y no cambian la salida. */
    omitidosPorTamano?: string[];
    durationMs: number;
    cache?: {
        enabled: boolean;
        identity: string;
        loaded: number;
        reused: number;
        reparsed: number;
        removed: number;
        entries: number;
    };
    /* [028A-8 Fase 0] Métricas por etapa publicadas en el JSON. */
    metrics?: {
        filesDiscovered: number;
        filesAnalyzed: number;
        filesReused: number;
        cacheHitRate: number;
        peakRssMb: number;
    };
    /* [108A-1 Fase 3] Duración por fase (ms) atribuible al cuello dominante:
     * configMs, variableIndexMs, classIndexMs, discoveryMs, analyzeMs,
     * tokenRulesMs, orphanMs, groupMs, saveMs. Las fases que no aplican al
     * comando no aparecen (scan no tiene classIndexMs/orphanMs). */
    phaseDurationMs?: Record<string, number>;
}

export const VARSENSE_JSON_SCHEMA_VERSION = '1';
