/* [028A-8] Índice persistente entre ejecuciones del quality gate.
 * Editor-agnostic (sin vscode): persiste por archivo los resultados de
 * definiciones CSS, tokens de consumidores y definiciones de variables,
 * validados por hash de contenido y ligados a una identidad
 * toolVersion+configHash+parserVersion. Un cambio de config/parser o de
 * contenido invalida solo las entradas afectadas; la identidad global cambia
 * cuando cambia la configuración efectiva o la versión del parser.
 * Gotcha: el snapshot guarda rutas absolutas normalizadas; el cache vive por
 * rama en el gate (.quality-reports/branches/<branch-key>/cache/varsense/),
 * por lo que un checkout distinto produce hashes/identidad propios y nunca
 * reutiliza PASS ajeno. */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { ClaseCssDefinida } from './classIndexBuilder';
import type { CssVariable } from '@/types';
import type { VarsenseConfigFile } from './config';

export const PERSISTENT_INDEX_SCHEMA_VERSION = 1;
/* Bump al cambiar la semántica de parseo/extracción que alimenta el índice. */
export const PARSER_VERSION = '1';
export const PERSISTENT_INDEX_FILENAME = 'varsense-index.json';

export interface PersistentIndexEntry {
    hash: string;
    classDefinitions?: ClaseCssDefinida[];
    consumerTokens?: string[];
    variables?: CssVariable[];
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
    readonly stats: PersistentIndexStats;
}

export function indexIdentity(toolVersion: string, configHash: string, parserVersion: string): string {
    return createHash('sha256')
        .update(`varsense-index:${toolVersion}:${configHash}:${parserVersion}`)
        .digest('hex');
}

/* Hash estable de la config efectiva (claves ordenadas): un cambio en
 * varsense.config.json cambia la identidad y obliga a re-parsear todo. */
export function configHashFor(config: VarsenseConfigFile): string {
    const stable: Record<string, unknown> = {};
    for (const key of Object.keys(config).sort()) {
        stable[key] = (config as Record<string, unknown>)[key];
    }
    return createHash('sha256')
        .update(`varsense-config:${JSON.stringify(stable)}`)
        .digest('hex');
}

export function pathKeyForIndex(fsPath: string): string {
    const normalized = path.normalize(fsPath).replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export async function sha256File(fsPath: string): Promise<string | null> {
    try {
        return createHash('sha256').update(await fs.readFile(fsPath)).digest('hex');
    } catch {
        return null;
    }
}

export async function loadPersistentIndex(indexPath: string, identity: string): Promise<PersistentIndexSnapshot | null> {
    try {
        const parsed: unknown = JSON.parse(await fs.readFile(indexPath, 'utf8'));
        if (!parsed || typeof parsed !== 'object') {return null;}
        const snapshot = parsed as PersistentIndexSnapshot;
        if (snapshot.schemaVersion !== PERSISTENT_INDEX_SCHEMA_VERSION) {return null;}
        if (snapshot.identity !== identity) {return null;}
        if (!snapshot.entries || typeof snapshot.entries !== 'object') {return null;}
        return snapshot;
    } catch {
        return null;
    }
}

export async function savePersistentIndex(indexPath: string, snapshot: PersistentIndexSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    const temporary = `${indexPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    try {
        await fs.rename(temporary, indexPath);
    } catch (error) {
        await fs.unlink(temporary).catch(() => {});
        throw error;
    }
}

/* Índice inverso token/class → archivos consumidores: permite seleccionar
 * dependencias de un token sin recorrer todo el workspace. Las rutas se
 * ordenan de forma estable para que el JSON sea comparable entre ejecuciones. */
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

/* Implementación en memoria del store: base para el CLI y para los fixtures. */
export class MemoryPersistentIndexStore implements PersistentIndexStore {
    protected readonly entries = new Map<string, PersistentIndexEntry>();
    public readonly stats: PersistentIndexStats = { reused: 0, reparsed: 0, removed: 0, loaded: 0 };

    public getEntry(fsPath: string): PersistentIndexEntry | undefined {
        return this.entries.get(pathKeyForIndex(fsPath));
    }

    public setEntry(fsPath: string, entry: PersistentIndexEntry): void {
        this.entries.set(pathKeyForIndex(fsPath), entry);
    }

    public removeEntry(fsPath: string): void {
        if (this.entries.delete(pathKeyForIndex(fsPath))) {
            this.stats.removed++;
        }
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

/* Store respaldado por disco: carga el snapshot solo si la identidad coincide
 * y lo guarda de forma atómica al finalizar la ejecución. */
export class FilePersistentIndexStore extends MemoryPersistentIndexStore {
    constructor(
        public readonly indexPath: string,
        public readonly identity: string
    ) {
        super();
    }

    public async load(): Promise<boolean> {
        const snapshot = await loadPersistentIndex(this.indexPath, this.identity);
        if (!snapshot) {
            return false;
        }
        /* [028A-8] Reconciliación con disco: en un proceso nuevo las caches en
         * memoria están vacías, por lo que la poda del builder (que solo mira
         * su caché) no alcanza a las entradas de archivos eliminados entre
         * ejecuciones. Sin esta reconciliación el snapshot crecería sin límite
         * por rama y el índice inverso referenciaría consumidores inexistentes.
         * El stat es O(1) por entrada y mucho más barato que re-parsear. */
        const missing: string[] = [];
        for (const [key, entry] of Object.entries(snapshot.entries)) {
            try {
                await fs.stat(key);
                this.entries.set(key, entry);
                this.stats.loaded++;
            } catch {
                missing.push(key);
            }
        }
        this.stats.removed += missing.length;
        return true;
    }

    public async save(): Promise<void> {
        await savePersistentIndex(this.indexPath, this.toSnapshot(this.identity));
    }
}
