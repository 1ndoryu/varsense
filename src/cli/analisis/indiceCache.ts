/* Almacén persistente del índice (--index-dir) y estadísticas de caché para la salida. */
import * as path from 'path';
import { VarsenseConfigFile } from '@/core/configuracion/config';
import { FilePersistentIndexStore, PARSER_VERSION, PERSISTENT_INDEX_FILENAME, configHashFor, indexIdentity } from '@/core/indices/persistentIndex';
import type { ParsedCliArgs } from '../args';
import { CliAnalysisResult } from '../tipos';
import { readPackageVersion } from '../version';

/* [028A-8] Crea el store persistente cuando --index-dir está presente. La
 * identidad liga toolVersion + config efectiva + parser, por lo que un cambio
 * de cualquiera invalida el snapshot completo. */
export async function createIndexStore(args: ParsedCliArgs, configFile: VarsenseConfigFile): Promise<FilePersistentIndexStore | undefined> {
    if (!args.indexDir) {
        return undefined;
    }
    const identity = indexIdentity(await readPackageVersion(), configHashFor(configFile), PARSER_VERSION);
    const persistentStore = new FilePersistentIndexStore(
        path.join(path.resolve(args.indexDir), PERSISTENT_INDEX_FILENAME),
        identity
    );
    await persistentStore.load();
    return persistentStore;
}

export function cacheStats(store: FilePersistentIndexStore): CliAnalysisResult['cache'] {
    return {
        enabled: true,
        identity: store.identity,
        loaded: store.stats.loaded,
        reused: store.stats.reused,
        reparsed: store.stats.reparsed,
        removed: store.stats.removed,
        entries: store.entryCount,
    };
}
