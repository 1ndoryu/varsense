/* [V6] Carga con caché de archivos para el índice de clases: CSS, tokens de consumo y listado. Sin cambio de comportamiento. */
import { PersistentIndexStore } from '../persistentIndex';
import { extraerUsoVariablesDeTexto } from '../../analisis/usoVariables';
import { CancellationToken, DocumentProvider, WorkspaceFile, WorkspaceFileProvider, throwIfCancelled } from '../../proveedores/workspaceProviders';
import { extraerTokensDeTexto } from './consumo/consumidores';
import { extraerFuncionesQueDevuelvenClases } from './consumo/llamadas';
import { CarrierCallSite, extraerCarriersYLlamadas } from './fuentes/carriers';
import { extraerClasesDeTexto } from './fuentes/cssClases';
import { extraerMapasExportados } from './fuentes/mapasJs';
import { ClaseCssDefinida, EntradaConsumo } from './tipos';

/* Estado que comparten las cargas: caché en memoria, índice persistente y proveedores. */
export interface ContextoCarga {
    fileProvider: WorkspaceFileProvider;
    documentProvider: DocumentProvider;
    persistentStore?: PersistentIndexStore;
    cssFileCache: Map<string, ClaseCssDefinida[]>;
    consumerFileCache: Map<string, EntradaConsumo>;
    /* [AG-1] Fija si `bg-(--x)` cuenta como uso de variable; lo fija cada scan (ver ClassIndexBuilder). */
    shorthandTailwind?: boolean;
}

/* [028A-8] Carga las definiciones CSS de un archivo reutilizando el índice
 * persistente cuando el hash de contenido coincide. Store-first: el hash se
 * calcula del contenido real en disco antes de abrir/parsear el documento,
 * por lo que un archivo sin cambios nunca se vuelve a parsear. */
export async function cargarDefinicionesCss(ctx: ContextoCarga, file: WorkspaceFile, token?: CancellationToken): Promise<ClaseCssDefinida[]> {
    const hash = ctx.persistentStore ? await ctx.persistentStore.hashFile(file.fsPath) : null;
    const store = ctx.persistentStore;
    const stored = hash ? store?.getEntry(file.fsPath) : undefined;
    if (stored?.hash === hash && stored.classDefinitions) {
        if (store) {store.stats.reused++;}
        ctx.cssFileCache.set(file.fsPath, stored.classDefinitions);
        return stored.classDefinitions;
    }
    const document = await ctx.documentProvider.openTextDocument(file);
    throwIfCancelled(token);
    const texto = document.getText();
    const clases = extraerClasesDeTexto(texto, file.fsPath);
    ctx.cssFileCache.set(file.fsPath, clases);
    if (hash) {
        const previa = store?.getEntry(file.fsPath) ?? {};
        store?.setEntry(file.fsPath, {
            ...previa,
            hash,
            classDefinitions: clases,
            /* [028A-8 tramo 4] Los usos de variables se capturan junto a las
             * definiciones de clase: ambos salen del mismo texto CSS y el
             * hash ya validó el contenido. */
            variableUsages: extraerUsoVariablesDeTexto(texto, { shorthandTailwind: ctx.shorthandTailwind }),
        });
        if (store) {store.stats.reparsed++;}
    }
    return clases;
}

/* [028A-8] Ídem para tokens de consumo: store-first, reutiliza la entrada
 * persistente cuando el hash coincide y registra la nueva al cambiar.
 * [318A-7V24] Además persiste carriers + llamadas con literales (mismo
 * criterio V14: entrada vieja sin los campos se re-parsea). Solo archivos
 * script aportan carriers/llamadas (los carriers son un idioma JS/TS). */
export async function cargarTokensConsumo(ctx: ContextoCarga, file: WorkspaceFile, prefijos: readonly string[], token?: CancellationToken): Promise<EntradaConsumo> {
    const hash = ctx.persistentStore ? await ctx.persistentStore.hashFile(file.fsPath) : null;
    const store = ctx.persistentStore;
    const stored = hash ? store?.getEntry(file.fsPath) : undefined;
    /* [318A-7V14] La familia se exige persistida: una entrada vieja (sin
     * consumerFamilyPrefixes) se re-parsea aunque el hash coincida.
     * [299A-13 F3b] Ídem para mapas exportados + referencias (entradas de
     * PARSER_VERSION 5 se re-parsean aunque el schema no haya cambiado).
     * [15A-27] Ídem para funciones que devuelven clases + llamadas. */
    if (stored?.hash === hash && stored.consumerTokens && stored.consumerFamilyPrefixes
        && stored.consumerCarriers && stored.consumerCarrierCalls
        && stored.consumerExportedClassMaps && stored.consumerMapReferences
        && stored.consumerClassFunctions && stored.consumerClassFunctionCalls
        && stored.consumerPrefijos === prefijos.join(',')) {
        if (store) {store.stats.reused++;}
        const cached = {
            tokens: new Set<string>(stored.consumerTokens),
            familyPrefixes: new Set<string>(stored.consumerFamilyPrefixes),
            carriers: new Map<string, Set<number>>(
                Object.entries(stored.consumerCarriers).map(([fn, poss]) => [fn, new Set<number>(poss)])
            ),
            llamadas: stored.consumerCarrierCalls.map(llamada => ({ ...llamada })),
            mapasExportados: stored.consumerExportedClassMaps,
            referenciasMapa: new Set<string>(stored.consumerMapReferences),
            funcionesClase: new Map<string, Set<string>>(
                Object.entries(stored.consumerClassFunctions).map(([fn, literales]) => [fn, new Set<string>(literales)])
            ),
            llamadasClase: new Set<string>(stored.consumerClassFunctionCalls),
        };
        ctx.consumerFileCache.set(file.fsPath, cached);
        return cached;
    }
    const document = await ctx.documentProvider.openTextDocument(file);
    throwIfCancelled(token);
    const texto = document.getText();
    const fileTokens = new Set<string>();
    const fileFamilyPrefixes = new Set<string>();
    const fileReferenciasMapa = new Set<string>();
    const fileLlamadasClase = new Set<string>();
    extraerTokensDeTexto(texto, fileTokens, fileFamilyPrefixes, fileReferenciasMapa, fileLlamadasClase, prefijos);
    /* [299A-13 F3b] Mapas de clases exportados (`export const
     * PAYMENT_STATUS_CLASS: Record<...> = {...}`). Solo scripts: el
     * `export const` es un idioma JS/TS (mismo gate que carriers). */
    let mapasExportados: Record<string, string[]> = {};
    if (/\.(ts|tsx|jsx|js|mjs|cjs)$/.test(file.fsPath)) {
        mapasExportados = extraerMapasExportados(texto);
    }
    let carriers = new Map<string, Set<number>>();
    let llamadas: CarrierCallSite[] = [];
    if (/\.(ts|tsx|jsx|js|mjs|cjs)$/.test(file.fsPath)) {
        const extraccion = extraerCarriersYLlamadas(texto);
        carriers = new Map<string, Set<number>>(
            Object.entries(extraccion.carriers).map(([fn, poss]) => [fn, new Set<number>(poss)])
        );
        llamadas = extraccion.llamadas;
    }
    /* [15A-27] Funciones que devuelven clases: solo scripts (mismo gate que
     * carriers y mapas exportados). */
    let funcionesClase = new Map<string, Set<string>>();
    if (/\.(ts|tsx|jsx|js|mjs|cjs)$/.test(file.fsPath)) {
        funcionesClase = extraerFuncionesQueDevuelvenClases(texto);
    }
    const cached = { tokens: fileTokens, familyPrefixes: fileFamilyPrefixes, carriers, llamadas, mapasExportados, referenciasMapa: fileReferenciasMapa, funcionesClase, llamadasClase: fileLlamadasClase };
    ctx.consumerFileCache.set(file.fsPath, cached);
    if (hash) {
        const previa = store?.getEntry(file.fsPath) ?? {};
        store?.setEntry(file.fsPath, {
            ...previa,
            hash,
            consumerTokens: [...fileTokens],
            /* [usos] Tailwind (`bg-(--x)`) y `var(--x)` en TSX/JS también cuentan para token-unused. */
            variableUsages: extraerUsoVariablesDeTexto(texto, { shorthandTailwind: ctx.shorthandTailwind }),
            consumerFamilyPrefixes: [...fileFamilyPrefixes],
            consumerCarriers: Object.fromEntries([...carriers].map(([fn, poss]) => [fn, [...poss]])),
            consumerCarrierCalls: llamadas,
            consumerExportedClassMaps: mapasExportados,
            consumerMapReferences: [...fileReferenciasMapa],
            consumerClassFunctions: Object.fromEntries([...funcionesClase].map(([fn, literales]) => [fn, [...literales]])),
            consumerClassFunctionCalls: [...fileLlamadasClase],
            consumerPrefijos: prefijos.join(','),
        });
        if (store) {store.stats.reparsed++;}
    }
    return cached;
}

export async function buscarArchivosUnicos(ctx: ContextoCarga, patterns: string[], exclude: string[], token?: CancellationToken): Promise<Map<string, WorkspaceFile>> {
    const files = new Map<string, { uri: string; fsPath: string }>();

    /* El provider recibe todos los patrones en una sola pasada. Hacer un
     * recorrido por patrón multiplica el coste de readdir/glob en cada
     * ejecución cold y no aporta deduplicación adicional: el Map ya la
     * garantiza para providers que devuelvan coincidencias repetidas. */
    throwIfCancelled(token);
    const matches = await ctx.fileProvider.findFiles(patterns, exclude);
    for (const file of matches) {
        throwIfCancelled(token);
        files.set(file.fsPath, file);
    }

    return files;
}
