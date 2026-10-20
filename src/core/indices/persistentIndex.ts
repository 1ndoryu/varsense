/* [028A-8] Índice persistente entre ejecuciones del quality gate.
 * Editor-agnostic y sin Node: este módulo solo define el formato, la identidad
 * lógica del índice y el store en memoria. El disco (carga/guardado, hash de
 * archivos, clave de ruta de Windows) vive en src/node/persistentIndexStore.ts
 * y entra por PersistentIndexAdaptadores.
 * Persiste por archivo los resultados de definiciones CSS, tokens de consumidores
 * y definiciones de variables, validados por hash de contenido y ligados a una
 * identidad toolVersion+configHash+parserVersion. Un cambio de config/parser o de
 * contenido invalida solo las entradas afectadas; la identidad global cambia
 * cuando cambia la configuración efectiva o la versión del parser.
 * Gotcha: el snapshot guarda rutas absolutas normalizadas; el cache vive por
 * rama en el gate (.quality-reports/branches/<branch-key>/cache/varsense/),
 * por lo que un checkout distinto produce hashes/identidad propios y nunca
 * reutiliza PASS ajeno. */

import type { ClaseCssDefinida } from './classIndexBuilder';
import type { CssVariable } from '@/types';

export const PERSISTENT_INDEX_SCHEMA_VERSION = 1;
/* Bump al cambiar la semántica de parseo/extracción que alimenta el índice.
 * 3: [318A-7V14] consumerFamilyPrefixes (template-literal family prefixes).
 * 5: [318A-7V24] consumerCarriers + consumerCarrierCalls (carriers cross-file).
 * 6: [299A-13 F3b] consumerExportedClassMaps + consumerMapReferences (mapas de
 * clases exportados y referencias a mapas importados).
 * 7: [11AA-2] escalares exportados en consumerExportedClassMaps y referencias
 * por identificador importado (`${CLASE}`) en consumerMapReferences.
 * 8: [15A-27] consumerClassFunctions + consumerClassFunctionCalls (funciones
 * que devuelven clases y llamadas a las definidas en otro archivo). */
export const PARSER_VERSION = '9';
export const PERSISTENT_INDEX_FILENAME = 'varsense-index.json';

export interface PersistentIndexEntry {
    hash: string;
    classDefinitions?: ClaseCssDefinida[];
    consumerTokens?: string[];
    /* [318A-7V14] Prefijos de familia de template literal por archivo: el
     * escaneo de claseHuerfana los cruza con las clases definidas. Se exige
     * presente junto a consumerTokens para reusar una entrada; una entrada
     * vieja (sin el campo) se re-parsea (PARSER_VERSION 2→3). */
    consumerFamilyPrefixes?: string[];
    /* [VarSense V5] Prefijos de nombre portador con que se parseo el archivo (unidos por coma):
     * si cambian en la configuracion, la entrada se re-parsea. */
    consumerPrefijos?: string;
    /* [318A-7V24] Carriers propios del archivo (fn → posiciones portadoras) y
     * call-sites con literales ({f, p, l}). Solo lo que el archivo aporta por
     * sí mismo: el cruce cross-file se computa en memoria por ejecución para
     * no acoplar la entrada de B al contenido de A. Se exigen presentes junto
     * a consumerTokens para reusar una entrada (criterio V14). */
    consumerCarriers?: Record<string, number[]>;
    consumerCarrierCalls?: Array<{ fn: string; pos: number; literal: string }>;
    /* [299A-13 F3b] Mapas de clases exportados por el archivo (nombre → valores
     * con forma de clase) y nombres de mapas importados referenciados por
     * subíndice en él. Solo lo que el archivo aporta por sí mismo: la unión
     * cross-file se computa en memoria por ejecución (mismo criterio V14/V24:
     * la entrada de B no depende del contenido de A). Se exigen presentes
     * junto a consumerTokens para reusar una entrada. */
    consumerExportedClassMaps?: Record<string, string[]>;
    consumerMapReferences?: string[];
    /* [15A-27] Funciones del archivo que devuelven literales de clase
     * (nombre → literales) y nombres de funciones invocadas en posición de
     * clase que NO se definen en él (se esperan de otro archivo del
     * workspace). Mismo criterio V14/V24: cada entrada guarda solo lo suyo y
     * la unión cross-file se computa en memoria por ejecución. */
    consumerClassFunctions?: Record<string, string[]>;
    consumerClassFunctionCalls?: string[];
    variables?: CssVariable[];
    /* [028A-8 tramo 4] Usos var(--x) referenciados por este archivo CSS: permite
     * resolver consumidores de una definición sin recorrer el workspace. */
    variableUsages?: string[];
}

export interface PersistentIndexSnapshot {
    schemaVersion: number;
    identity: string;
    generatedAt: string;
    entries: Record<string, PersistentIndexEntry>;
}

/* Contadores de la ejecución actual: permiten al gate reportar cuántos
 * archivos se reutilizaron vs. se re-parsearon. */
export interface PersistentIndexStats {
    reused: number;
    reparsed: number;
    removed: number;
    loaded: number;
}

/* El builder consulta/registra entradas sin conocer el formato en disco. */
export interface PersistentIndexStore {
    getEntry(fsPath: string): PersistentIndexEntry | undefined;
    setEntry(fsPath: string, entry: PersistentIndexEntry): void;
    removeEntry(fsPath: string): void;
    /* Hash de contenido del archivo; null si no se puede leer (el builder re-parsea). */
    hashFile(fsPath: string): Promise<string | null>;
    readonly stats: PersistentIndexStats;
}

/* Piezas que el borde Node inyecta: clave estable por archivo y hash de contenido. */
export interface PersistentIndexAdaptadores {
    claveDe(fsPath: string): string;
    hashArchivo(fsPath: string): Promise<string | null>;
}

/* Sin adaptador de disco el store no puede validar contenido: sin hash el
 * builder re-parsea, que es el camino seguro. */
const ADAPTADORES_POR_DEFECTO: PersistentIndexAdaptadores = {
    claveDe: fsPath => fsPath.replace(/\\/g, '/'),
    hashArchivo: async () => null,
};

export function buildReverseIndex(snapshot: Pick<PersistentIndexSnapshot, 'entries'>): Map<string, string[]> {
    const index = new Map<string, Set<string>>();
    for (const [fsPath, entry] of Object.entries(snapshot.entries)) {
        for (const token of entry.consumerTokens ?? []) {
            let set = index.get(token);
            if (!set) {
                set = new Set();
                index.set(token, set);
            }
            set.add(fsPath);
        }
    }
    return new Map([...index.entries()].map(([token, files]) => [token, [...files].sort()]));
}

/* [028A-8 tramo 4] Índice inverso variable → archivos que la consumen
 * (var(--x)). Permite a token-unused saber si una variable se usa en el
 * workspace consultando el índice, en lugar de escanear el texto completo de
 * todos los documentos por cada variable (el cuello de botella del análisis). */
export function buildVariableReverseIndex(snapshot: Pick<PersistentIndexSnapshot, 'entries'>): Map<string, string[]> {
    const index = new Map<string, Set<string>>();
    for (const [fsPath, entry] of Object.entries(snapshot.entries)) {
        for (const usage of entry.variableUsages ?? []) {
            let set = index.get(usage);
            if (!set) {
                set = new Set();
                index.set(usage, set);
            }
            set.add(fsPath);
        }
    }
    return new Map([...index.entries()].map(([variable, files]) => [variable, [...files].sort()]));
}

/* Implementación en memoria del store: base del store de disco y de los fixtures. */
export class MemoryPersistentIndexStore implements PersistentIndexStore {
    protected readonly entries = new Map<string, PersistentIndexEntry>();
    public readonly stats: PersistentIndexStats = { reused: 0, reparsed: 0, removed: 0, loaded: 0 };

    constructor(protected readonly adaptadores: PersistentIndexAdaptadores = ADAPTADORES_POR_DEFECTO) {}

    public getEntry(fsPath: string): PersistentIndexEntry | undefined {
        return this.entries.get(this.adaptadores.claveDe(fsPath));
    }

    public setEntry(fsPath: string, entry: PersistentIndexEntry): void {
        this.entries.set(this.adaptadores.claveDe(fsPath), entry);
    }

    public removeEntry(fsPath: string): void {
        if (this.entries.delete(this.adaptadores.claveDe(fsPath))) {
            this.stats.removed++;
        }
    }

    public hashFile(fsPath: string): Promise<string | null> {
        return this.adaptadores.hashArchivo(fsPath);
    }

    public get entryCount(): number {
        return this.entries.size;
    }

    public toSnapshot(identity: string): PersistentIndexSnapshot {
        return {
            schemaVersion: PERSISTENT_INDEX_SCHEMA_VERSION,
            identity,
            generatedAt: new Date().toISOString(),
            entries: Object.fromEntries(this.entries.entries()),
        };
    }
}
