/* [V6] Partición de classIndexBuilder.ts: clase ClassIndexBuilder (escaneo de clases huérfanas). Sin cambio de comportamiento. */
import { PersistentIndexStore } from '../persistentIndex';
import { CancellationError, CancellationToken, DocumentCacheProvider, DocumentProvider, WorkspaceFileProvider, throwIfCancelled } from '../../proveedores/workspaceProviders';
import { ContextoCarga, buscarArchivosUnicos, cargarDefinicionesCss, cargarTokensConsumo } from './carga';
import { DEFAULT_CONSUMER_PATTERNS, DEFAULT_CSS_PATTERNS, DEFAULT_MIN_LENGTH } from './constantes';
import { compilarPatronesExcluidos } from './consumo/htmlYExclusiones';
import { CarrierCallSite } from './fuentes/carriers';
import { MAX_TOKENS } from './fuentes/cssClases';
import { CacheAcotada } from '../../cacheAcotada';
import { MAX_ENTRADAS_CACHE_ARCHIVOS } from '../../analisis/limites';
import { ClaseCssDefinida, ClassIndexScanOptions, ClassScanProgress, EntradaConsumo, ResultadoClasesHuerfanas } from './tipos';

/* [085A-2] Escanea clases huerfanas desde providers core, sin vscode.workspace.
 * Gotcha: los adaptadores deciden como abrir archivos; aqui solo se cruzan tokens y selectores. */
export class ClassIndexBuilder {
    private readonly cssFileCache = new CacheAcotada<string, ClaseCssDefinida[]>(MAX_ENTRADAS_CACHE_ARCHIVOS);
    /* [318A-7V24] carriers propios + call-sites con literales por archivo: el
     * cruce cross-file (unión global) se computa en scan() en memoria. */
    /* Firma (prefijos unidos por coma) con la que se lleno consumerFileCache: si cambia, se vacia. */
    private firmaPrefijosConsumo = '';
    private readonly consumerFileCache = new CacheAcotada<string, EntradaConsumo>(MAX_ENTRADAS_CACHE_ARCHIVOS);
    private readonly contexto: ContextoCarga;

    constructor(
        private readonly fileProvider: WorkspaceFileProvider,
        private readonly documentProvider: DocumentProvider,
        private readonly documentCacheProvider?: DocumentCacheProvider,
        private readonly persistentStore?: PersistentIndexStore
    ) {
        /* Las cargas usan las mismas cachés que la clase: se pasan las referencias, no copias. */
        this.contexto = { fileProvider, documentProvider, persistentStore, cssFileCache: this.cssFileCache, consumerFileCache: this.consumerFileCache };
    }

    /* The file cache is caller-driven: watchers/adapters must call this before
     * rescanning a changed or deleted file. A scan does not stat/hash content. */
    public invalidateFile(fsPath: string): void {
        this.cssFileCache.delete(fsPath);
        this.consumerFileCache.delete(fsPath);
        this.documentCacheProvider?.invalidate(fsPath);
        /* [028A-8] La invalidación del caché en memoria también expulsa la
         * entrada persistente del índice entre ejecuciones. */
        this.persistentStore?.removeEntry(fsPath);
    }

    public clearCache(): void {
        this.cssFileCache.clear();
        this.consumerFileCache.clear();
        this.documentCacheProvider?.clear();
    }

    public async scan(
        options: ClassIndexScanOptions,
        onProgress?: ClassScanProgress
    ): Promise<ResultadoClasesHuerfanas> {
        throwIfCancelled(options.token);
        const inicio = Date.now();
        const cssPatterns = options.cssPatterns ?? DEFAULT_CSS_PATTERNS;
        const consumerPatterns = options.consumerPatterns ?? DEFAULT_CONSUMER_PATTERNS;
        const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;
        const prefijos = options.prefijosPortadores;
        this.contexto.shorthandTailwind = options.shorthandTailwind ?? true;
        if (this.firmaPrefijosConsumo !== prefijos.join(',')) {
            this.consumerFileCache.clear();
            this.firmaPrefijosConsumo = prefijos.join(',');
        }

        const { clasesMap, totalArchivos: archivosCss } = await this.scanCssDefinitions(
            cssPatterns,
            options.exclude,
            (actual, total) => onProgress?.('Escaneando CSS', actual, total),
            options.token
        );

        throwIfCancelled(options.token);
        onProgress?.('Extrayendo tokens de consumidores', 0, 1);
        const { filesTokens, filesFamilyPrefixes, filesCarriers, filesLlamadas, filesMapasExportados, filesReferenciasMapa, filesFuncionesClase, filesLlamadasClase, totalArchivos: archivosConsumo } = await this.extractConsumerTokens(
            consumerPatterns,
            options.exclude,
            prefijos,
            options.token
        );
        /* [318A-7V24] Unión global de carriers: fn → posiciones portadoras en
         * CUALQUIER archivo (la definición vive en un módulo y la llamada en
         * otro). Los literales de call-sites en esas posiciones son clases que
         * el runtime aplica: literal → archivos donde se llama. */
        const carriersUnion = new Map<string, Set<number>>();
        for (const carriers of filesCarriers.values()) {
            for (const [fn, posiciones] of carriers) {
                const union = carriersUnion.get(fn) ?? new Set<number>();
                for (const pos of posiciones) {union.add(pos);}
                carriersUnion.set(fn, union);
            }
        }
        const llamadasCrossCarrier = new Map<string, Set<string>>();
        for (const [fsPath, llamadas] of filesLlamadas) {
            for (const { fn, pos, literal } of llamadas) {
                if (!carriersUnion.get(fn)?.has(pos)) {continue;}
                for (const clase of literal.split(/\s+/)) {
                    if (clase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(clase)) {
                        const archivos = llamadasCrossCarrier.get(clase) ?? new Set<string>();
                        archivos.add(fsPath);
                        llamadasCrossCarrier.set(clase, archivos);
                    }
                }
            }
        }
        /* [299A-13 F3b] Unión global de mapas de clases exportados (nombre →
         * valores con forma de clase de TodoS los archivos que lo exportan) y
         * resolución post-hoc de referencias: un archivo que referencia por
         * subíndice un mapa importado (`STATUS_CLASS[order.status]` en
         * UsuariosFila.tsx, exportado por api/admin-users.ts) recibe los
         * valores del mapa como tokens propios. La referencia al mapa que el
         * propio archivo exporta se ignora (ya está cubierta por la vía local
         * M1: el export también es declaración local). */
        const mapasUnion = new Map<string, Set<string>>();
        for (const mapas of filesMapasExportados.values()) {
            for (const [nombre, valores] of Object.entries(mapas)) {
                const union = mapasUnion.get(nombre) ?? new Set<string>();
                for (const valor of valores) {union.add(valor);}
                mapasUnion.set(nombre, union);
            }
        }
        for (const [fsPath, referencias] of filesReferenciasMapa) {
            if (referencias.size === 0) {continue;}
            const propios = filesMapasExportados.get(fsPath);
            const tokensArchivo = filesTokens.get(fsPath);
            if (!tokensArchivo) {continue;}
            for (const nombre of referencias) {
                if (propios?.[nombre]) {continue;}
                const valores = mapasUnion.get(nombre);
                if (!valores) {continue;}
                for (const valor of valores) {tokensArchivo.add(valor);}
            }
        }

        /* [15A-27] Unión global de funciones que devuelven clases: la definición
         * vive en un módulo (`claseEstadoSample` en estadoVisual.tsx) y la
         * llamada en otro, dentro de una plantilla de className
         * (ListaHistorialSync.tsx:85). Se cruzan las dos mitades: el archivo
         * que llama recibe los literales del que define. La referencia a una
         * función que el propio archivo define se ignora (ya la cubre
         * resolverLlamadaMapper en local). */
        const funcionesUnion = new Map<string, Set<string>>();
        const archivosPorFuncion = new Map<string, number>();
        for (const funciones of filesFuncionesClase.values()) {
            for (const [nombre, literales] of funciones) {
                const union = funcionesUnion.get(nombre) ?? new Set<string>();
                for (const literal of literales) {union.add(literal);}
                funcionesUnion.set(nombre, union);
                archivosPorFuncion.set(nombre, (archivosPorFuncion.get(nombre) ?? 0) + 1);
            }
        }
        for (const [fsPath, llamadas] of filesLlamadasClase) {
            if (llamadas.size === 0) {continue;}
            const propios = filesFuncionesClase.get(fsPath);
            const tokensArchivo = filesTokens.get(fsPath);
            if (!tokensArchivo) {continue;}
            for (const nombre of llamadas) {
                if (propios?.has(nombre)) {continue;}
                /* Homónimos: si el nombre lo define más de un archivo no se sabe
                 * cuál resuelve el import, y unir los literales de todos
                 * ocultaría huérfanas reales. Fail-closed: se ignora. Mismo
                 * criterio que el resto de uniones cross-file. */
                if (archivosPorFuncion.get(nombre) !== 1) {continue;}
                const literales = funcionesUnion.get(nombre);
                if (!literales) {continue;}
                for (const literal of literales) {tokensArchivo.add(literal);}
            }
        }

        throwIfCancelled(options.token);
        const regexExcluidos = compilarPatronesExcluidos(options.excludedClassPatterns ?? []);
        const clasesHuerfanas: ClaseCssDefinida[] = [];
        const nombresUnicos = Array.from(clasesMap.keys());
        /* [318A-7V3] Con los CSS ahora en el barrido de consumo, cada clase
         * debe excluir su(s) archivo(s) de definición: un selector compuesto
         * en el mismo archivo (`.padre .hija` junto a la definición) no es
         * uso; en OTRO archivo sí lo es. */
        const archivosDefinicion = new Map<string, Set<string>>();
        for (const [nombre, definiciones] of clasesMap) {
            archivosDefinicion.set(nombre, new Set(definiciones.map(def => def.archivo)));
        }

        for (let index = 0; index < nombresUnicos.length; index++) {
            throwIfCancelled(options.token);
            const nombre = nombresUnicos[index];

            if (index % 100 === 0) {
                onProgress?.('Verificando uso', index, nombresUnicos.length);
            }

            if (nombre.length < minLength || regexExcluidos.some(regex => regex.test(nombre))) {
                continue;
            }

            const definicion = archivosDefinicion.get(nombre) ?? new Set<string>();
            /* [318A-7V14] Uso por familia: un prefijo de template literal
             * (badgeInfo-- / selectorNivelBoton / boton--) alcanza a toda la
             * familia de clases definidas, porque el sufijo se emite en
             * runtime desde el componente. No aplica al archivo de definición
             * (un selector compuesto en el mismo CSS no es uso). */
            let usado = false;
            for (const [fsPath, tokensArchivo] of filesTokens) {
                if (definicion.has(fsPath)) {
                    continue;
                }
                if (tokensArchivo.has(nombre)) {
                    usado = true;
                    break;
                }
                const prefijos = filesFamilyPrefixes.get(fsPath);
                if (prefijos) {
                    for (const prefijo of prefijos) {
                        if (nombre.startsWith(prefijo)) {
                            usado = true;
                            break;
                        }
                    }
                }
                if (usado) {
                    break;
                }
            }
            /* [318A-7V24] Uso por carrier cross-file (ver construcción de
             * llamadasCrossCarrier arriba): el literal se llamó en una
             * posición portadora. Aplica fuera del archivo de definición
             * (un call-site en el mismo CSS no es uso, igual que V3). */
            if (!usado) {
                const archivosLlamada = llamadasCrossCarrier.get(nombre);
                if (archivosLlamada) {
                    for (const archivo of archivosLlamada) {
                        if (!definicion.has(archivo)) {
                            usado = true;
                            break;
                        }
                    }
                }
            }

            if (!usado) {
                const definiciones = clasesMap.get(nombre) ?? [];
                if (definiciones.length > 0) {
                    clasesHuerfanas.push(definiciones[0]);
                }
            }
        }

        clasesHuerfanas.sort((a, b) => {
            if (a.archivo !== b.archivo) {
                return a.archivo.localeCompare(b.archivo);
            }
            return a.linea - b.linea;
        });

        return {
            totalClasesDefinidas: nombresUnicos.length,
            totalClasesUsadas: nombresUnicos.length - clasesHuerfanas.length,
            totalClasesHuerfanas: clasesHuerfanas.length,
            clasesHuerfanas,
            archivosAnalizadosCss: archivosCss,
            archivosAnalizadosConsumo: archivosConsumo,
            tiempoMs: Date.now() - inicio
        };
    }

    private async scanCssDefinitions(
        patterns: string[],
        exclude: string[],
        onProgress?: (actual: number, total: number) => void,
        token?: CancellationToken
    ): Promise<{ clasesMap: Map<string, ClaseCssDefinida[]>; totalArchivos: number }> {
        const files = await this.fileProvider.findFiles(patterns, exclude);
        const clasesMap = new Map<string, ClaseCssDefinida[]>();
        const currentFiles = new Set(files.map(file => file.fsPath));
        for (const fsPath of this.cssFileCache.keys()) {
            if (!currentFiles.has(fsPath)) {
                this.cssFileCache.delete(fsPath);
                /* [028A-8] El archivo desapareció: la entrada persistente queda
                 * obsoleta y no debe reutilizarse en la siguiente ejecución. */
                this.persistentStore?.removeEntry(fsPath);
            }
        }

        for (let index = 0; index < files.length; index++) {
            throwIfCancelled(token);
            const file = files[index];
            try {
                let clases = this.cssFileCache.get(file.fsPath);
                if (!clases) {
                    clases = await cargarDefinicionesCss(this.contexto, file, token);
                }
                for (const clase of clases) {
                    const existentes = clasesMap.get(clase.nombre) ?? [];
                    const duplicado = existentes.some(item => item.archivo === clase.archivo && item.linea === clase.linea);
                    if (!duplicado) {
                        existentes.push(clase);
                        clasesMap.set(clase.nombre, existentes);
                    }
                }
            } catch (error) {
                if (error instanceof CancellationError) {
                    throw error;
                }
                /* Mantiene el comportamiento historico: archivos no abribles no bloquean el reporte. */
            }

            onProgress?.(index + 1, files.length);
        }

        return { clasesMap, totalArchivos: files.length };
    }

    private async extractConsumerTokens(
        patterns: string[],
        exclude: string[],
        prefijos: readonly string[],
        token?: CancellationToken
    ): Promise<{
        filesTokens: Map<string, Set<string>>;
        filesFamilyPrefixes: Map<string, Set<string>>;
        filesCarriers: Map<string, Map<string, Set<number>>>;
        filesLlamadas: Map<string, CarrierCallSite[]>;
        filesMapasExportados: Map<string, Record<string, string[]>>;
        filesReferenciasMapa: Map<string, Set<string>>;
        filesFuncionesClase: Map<string, Map<string, Set<string>>>;
        filesLlamadasClase: Map<string, Set<string>>;
        totalArchivos: number;
    }> {
        const files = await buscarArchivosUnicos(this.contexto, patterns, exclude, token);
        const filesTokens = new Map<string, Set<string>>();
        const filesFamilyPrefixes = new Map<string, Set<string>>();
        const filesCarriers = new Map<string, Map<string, Set<number>>>();
        const filesLlamadas = new Map<string, CarrierCallSite[]>();
        const filesMapasExportados = new Map<string, Record<string, string[]>>();
        const filesReferenciasMapa = new Map<string, Set<string>>();
        const filesFuncionesClase = new Map<string, Map<string, Set<string>>>();
        const filesLlamadasClase = new Map<string, Set<string>>();
        let totalTokens = 0;
        for (const fsPath of this.consumerFileCache.keys()) {
            if (!files.has(fsPath)) {
                this.consumerFileCache.delete(fsPath);
                /* [028A-8] Ídem: consumidor eliminado no puede reutilizar su
                 * entrada persistente. */
                this.persistentStore?.removeEntry(fsPath);
            }
        }

        for (const file of files.values()) {
            throwIfCancelled(token);
            if (totalTokens >= MAX_TOKENS) {
                break;
            }

            try {
                let cached = this.consumerFileCache.get(file.fsPath);
                if (!cached) {
                    cached = await cargarTokensConsumo(this.contexto, file, prefijos, token);
                }
                filesTokens.set(file.fsPath, cached.tokens);
                filesFamilyPrefixes.set(file.fsPath, cached.familyPrefixes);
                filesCarriers.set(file.fsPath, cached.carriers);
                filesLlamadas.set(file.fsPath, cached.llamadas);
                filesMapasExportados.set(file.fsPath, cached.mapasExportados);
                filesReferenciasMapa.set(file.fsPath, cached.referenciasMapa);
                filesFuncionesClase.set(file.fsPath, cached.funcionesClase);
                filesLlamadasClase.set(file.fsPath, cached.llamadasClase);
                totalTokens += cached.tokens.size;
            } catch (error) {
                if (error instanceof CancellationError) {
                    throw error;
                }
                /* Mantiene el comportamiento historico: archivos no abribles no bloquean el reporte. */
            }
        }

        return { filesTokens, filesFamilyPrefixes, filesCarriers, filesLlamadas, filesMapasExportados, filesReferenciasMapa, filesFuncionesClase, filesLlamadasClase, totalArchivos: files.size };
    }
}
