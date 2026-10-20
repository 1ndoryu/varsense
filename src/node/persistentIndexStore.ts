/* Borde Node del índice persistente: disco, hash de archivos e identidad.
 * El formato y el store en memoria viven en core/indices/persistentIndex.ts
 * (sin Node); aquí solo se conecta con fs y crypto. */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
    MemoryPersistentIndexStore,
    PERSISTENT_INDEX_SCHEMA_VERSION,
    type PersistentIndexSnapshot,
} from '@/core/indices/persistentIndex';
import type { VarsenseConfigFile } from '@/core/configuracion/config';

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

/* En Windows la clave ignora mayúsculas: C:\Foo y c:\foo son el mismo archivo. */
export function pathKeyForIndex(fsPath: string): string {
    const normalized = path.normalize(fsPath).replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/* Hash del contenido en disco; null si no se puede leer (el builder re-parsea). */
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

/* Escritura atómica: se escribe a un temporal y se renombra; un fallo no deja
 * un índice a medias. */
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

/* Store respaldado por disco: carga el snapshot solo si la identidad coincide
 * y lo guarda de forma atómica al finalizar la ejecución. */
export class FilePersistentIndexStore extends MemoryPersistentIndexStore {
    constructor(
        public readonly indexPath: string,
        public readonly identity: string
    ) {
        super({ claveDe: pathKeyForIndex, hashArchivo: sha256File });
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
