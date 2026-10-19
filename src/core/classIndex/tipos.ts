/* [V6] Partición de classIndexBuilder.ts: tipos del índice de clases. Sin cambio de comportamiento. */
import { CancellationToken } from '../workspaceProviders';
import type { CarrierCallSite } from './fuentes/carriers';

export interface ClaseCssDefinida {
    nombre: string;
    archivo: string;
    linea: number;
    columna: number;
    selector: string;
}

export interface ResultadoClasesHuerfanas {
    totalClasesDefinidas: number;
    totalClasesUsadas: number;
    totalClasesHuerfanas: number;
    clasesHuerfanas: ClaseCssDefinida[];
    archivosAnalizadosCss: number;
    archivosAnalizadosConsumo: number;
    tiempoMs: number;
}

export interface ClassIndexScanOptions {
    exclude: string[];
    minLength?: number;
    excludedClassPatterns?: string[];
    cssPatterns?: string[];
    consumerPatterns?: string[];
    /* Prefijos (ademas de className/contentClass) que marcan un nombre portador de
     * clases. El core no asume convencion: sin valor, solo cuentan className/contentClass. */
    prefijosPortadores?: string[];
    token?: CancellationToken;
}

export type ClassScanProgress = (fase: string, actual: number, total: number) => void;

/* Caché de tokens de consumo por archivo (V6: tipo compartido por builder y carga). */
export interface EntradaConsumo {
    tokens: Set<string>;
    familyPrefixes: Set<string>;
    carriers: Map<string, Set<number>>;
    llamadas: CarrierCallSite[];
    mapasExportados: Record<string, string[]>;
    referenciasMapa: Set<string>;
    funcionesClase: Map<string, Set<string>>;
    llamadasClase: Set<string>;
}
