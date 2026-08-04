import { CancellationError, CancellationToken, DocumentCacheProvider, DocumentProvider, throwIfCancelled, WorkspaceFile, WorkspaceFileProvider } from './workspaceProviders';
import { PersistentIndexStore, sha256File } from './persistentIndex';

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
    token?: CancellationToken;
}

export type ClassScanProgress = (fase: string, actual: number, total: number) => void;

const DEFAULT_CSS_PATTERNS = ['**/*.css'];
const DEFAULT_CONSUMER_PATTERNS = [
    '**/*.tsx', '**/*.jsx',
    '**/*.ts', '**/*.js',
    '**/*.php', '**/*.html'
];
const DEFAULT_MIN_LENGTH = 3;
const REGEX_CLASS_ATTR = /(?:className|class)\s*=\s*["']([^"']+)["']/g;
const REGEX_CLASS_TEMPLATE = /(?:className|class)\s*=\s*\{[`]([^`]+)[`]\}/g;
/* Vanilla TS/DOM factories commonly pass classes as object attributes:
 * createEl('div', { className: 'panel panel--active' }). Keep this parser
 * framework-agnostic while covering the project's createEl contract. */
const REGEX_CLASS_OBJECT = /(?:['"]?className['"]?|['"]?class['"]?)\s*:\s*(?:['"]([^'"]+)['"]|[`]([^`]+)[`])/g;
const REGEX_CLASS_FACTORY = /createContainer\s*\(\s*['"]([^'"]+)['"]/g;
const REGEX_EXTERNAL_LINK_CLASS = /createExternalLink\s*\([^,]+,[^,]+,\s*['"]([^'"]+)['"]/g;
const REGEX_CLASS_LIST = /classList\.add\s*\(([^)]*)\)/g;
const REGEX_CLASS_DECLARATION = /\b(?:const|let|var)\s+(?:className|contentClass)\s*=\s*([\s\S]{0,240}?);/g;
const REGEX_STRING_LITERAL = /['"`]([^'"`$]+)['"`]/g;
const MAX_TOKENS = 10000;

export function extraerClasesDeTexto(texto: string, rutaArchivo: string): ClaseCssDefinida[] {
    const clases: ClaseCssDefinida[] = [];
    const textoLimpio = texto.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
    const lineas = textoLimpio.split('\n');
    const regexClase = /\.([a-zA-Z_][\w-]*)/g;

    for (let numLinea = 0; numLinea < lineas.length; numLinea++) {
        const linea = lineas[numLinea];
        const trimmed = linea.trim();

        if (!trimmed) {
            continue;
        }

        const esPropiedad = /^\s*[\w-]+\s*:(?!:)/.test(linea) && !linea.includes('{');
        if (esPropiedad) {
            continue;
        }

        if (trimmed.startsWith('@') && !trimmed.includes('{')) {
            continue;
        }

        let match: RegExpExecArray | null;
        while ((match = regexClase.exec(linea)) !== null) {
            clases.push({
                nombre: match[1],
                archivo: rutaArchivo,
                linea: numLinea,
                columna: match.index,
                selector: trimmed
            });
        }
        regexClase.lastIndex = 0;
    }

    return clases;
}

function addClassTokens(value: string, tokens: Set<string>): void {
    const withoutInterpolation = value.replace(/\$\{[^}]*\}/g, ' ');
    for (const clase of withoutInterpolation.split(/\s+/)) {
        if (clase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(clase)) {
            tokens.add(clase);
        }
    }

    /* Conserva clases literales dentro de ternarios/template expressions:
     * `campo ${error ? 'campoError' : ''}`. Nunca agrega identificadores. */
    const interpolations = value.match(/\$\{[^}]*\}/g) ?? [];
    for (const interpolation of interpolations) {
        const literals = interpolation.match(/["']([^"']+)["']/g) ?? [];
        for (const literal of literals) {
            addClassTokens(literal.slice(1, -1), tokens);
        }
    }
}

function previousCodeCharacter(source: string, index: number): string {
    let cursor = index - 1;
    while (cursor >= 0 && /\s/.test(source[cursor])) {cursor--;}
    return cursor >= 0 ? source[cursor] : '';
}

function addQuotedClassTokens(value: string, tokens: Set<string>): void {
    REGEX_STRING_LITERAL.lastIndex = 0;
    let literal: RegExpExecArray | null;
    while ((literal = REGEX_STRING_LITERAL.exec(value)) !== null) {
        addClassTokens(literal[1], tokens);
    }
}

function addDeclarationClassTokens(value: string, tokens: Set<string>): void {
    const trimmed = value.trim();
    if (/^(['"`])[\s\S]*\1$/.test(trimmed)) {
        addClassTokens(trimmed.slice(1, -1), tokens);
        addQuotedClassTokens(trimmed, tokens);
        return;
    }
    if (trimmed.includes('?')) {
        addQuotedClassTokens(trimmed, tokens);
    }
}

function removeComments(texto: string): string {
    let result = '';
    let quote = '';
    let escaped = false;
    let comment = '';

    for (let index = 0; index < texto.length; index++) {
        const current = texto[index];
        const next = texto[index + 1] ?? '';

        if (comment === 'line') {
            result += current === '\\n' ? '\\n' : ' ';
            if (current === '\\n') {comment = '';}
            continue;
        }
        if (comment === 'block') {
            result += current === '\\n' ? '\\n' : ' ';
            if (current === '*' && next === '/') {
                result += ' ';
                index++;
                comment = '';
            }
            continue;
        }

        if (quote) {
            result += current;
            if (escaped) {escaped = false;}
            else if (current === '\\\\') {escaped = true;}
            else if (current === quote) {quote = '';}
            continue;
        }

        if (current === '/' && next === '/') {
            result += '  ';
            index++;
            comment = 'line';
            continue;
        }
        if (current === '/' && next === '*') {
            result += '  ';
            index++;
            comment = 'block';
            continue;
        }
        if (current === '"' || current === "'" || current === '`') {quote = current;}
        result += current;
    }
    return result;
}

function isInsideString(source: string, index: number): boolean {
    let quote = '';
    let escaped = false;
    for (let cursor = 0; cursor < index; cursor++) {
        const current = source[cursor];
        if (quote) {
            if (escaped) {escaped = false;}
            else if (current === '\\\\') {escaped = true;}
            else if (current === quote) {quote = '';}
        } else if (current === '"' || current === "'" || current === '`') {
            quote = current;
        }
    }
    return Boolean(quote);
}

function isCodeMatch(source: string, matchIndex: number): boolean {
    return !isInsideString(source, matchIndex);
}

function extraerTokensDeTexto(texto: string, tokens: Set<string>): void {
    const source = removeComments(texto);
    let match: RegExpExecArray | null;

    REGEX_CLASS_ATTR.lastIndex = 0;
    while ((match = REGEX_CLASS_ATTR.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        for (const clase of match[1].split(/\s+/)) {
            if (clase.length > 1) {
                tokens.add(clase);
            }
        }
    }

    REGEX_CLASS_TEMPLATE.lastIndex = 0;
    while ((match = REGEX_CLASS_TEMPLATE.exec(source)) !== null) {
        if (isCodeMatch(source, match.index)) {
            addClassTokens(match[1], tokens);
        }
    }

    REGEX_CLASS_OBJECT.lastIndex = 0;
    while ((match = REGEX_CLASS_OBJECT.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous !== '{' && previous !== ',') {continue;}
        addClassTokens(match[1] ?? match[2] ?? '', tokens);
    }

    REGEX_CLASS_FACTORY.lastIndex = 0;
    while ((match = REGEX_CLASS_FACTORY.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous && !/[=(,:]/.test(previous)) {continue;}
        addClassTokens(match[1], tokens);
    }

    REGEX_EXTERNAL_LINK_CLASS.lastIndex = 0;
    while ((match = REGEX_EXTERNAL_LINK_CLASS.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous && !/[=(,:]/.test(previous)) {continue;}
        addClassTokens(match[1], tokens);
    }

    REGEX_CLASS_LIST.lastIndex = 0;
    while ((match = REGEX_CLASS_LIST.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index) || previousCodeCharacter(source, match.index) !== '.') {continue;}
        addQuotedClassTokens(match[1], tokens);
    }

    REGEX_CLASS_DECLARATION.lastIndex = 0;
    while ((match = REGEX_CLASS_DECLARATION.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous && /[\\w'"`]/.test(previous)) {continue;}
        addDeclarationClassTokens(match[1], tokens);
    }
}

function compilarPatronesExcluidos(patterns: string[]): RegExp[] {
    return patterns
        .filter(pattern => pattern.length > 0)
        .map(pattern => {
            try { return new RegExp(pattern); } catch { return null; }
        })
        .filter((regex): regex is RegExp => regex !== null);
}

/* [085A-2] Escanea clases huerfanas desde providers core, sin vscode.workspace.
 * Gotcha: los adaptadores deciden como abrir archivos; aqui solo se cruzan tokens y selectores. */
export class ClassIndexBuilder {
    private readonly cssFileCache = new Map<string, ClaseCssDefinida[]>();
    private readonly consumerFileCache = new Map<string, Set<string>>();

    constructor(
        private readonly fileProvider: WorkspaceFileProvider,
        private readonly documentProvider: DocumentProvider,
        private readonly documentCacheProvider?: DocumentCacheProvider,
        private readonly persistentStore?: PersistentIndexStore
    ) {}

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

        const { clasesMap, totalArchivos: archivosCss } = await this.scanCssDefinitions(
            cssPatterns,
            options.exclude,
            (actual, total) => onProgress?.('Escaneando CSS', actual, total),
            options.token
        );

        throwIfCancelled(options.token);
        onProgress?.('Extrayendo tokens de consumidores', 0, 1);
        const { tokens, totalArchivos: archivosConsumo } = await this.extractConsumerTokens(
            consumerPatterns,
            options.exclude,
            options.token
        );

        throwIfCancelled(options.token);
        const regexExcluidos = compilarPatronesExcluidos(options.excludedClassPatterns ?? []);
        const clasesHuerfanas: ClaseCssDefinida[] = [];
        const nombresUnicos = Array.from(clasesMap.keys());

        for (let index = 0; index < nombresUnicos.length; index++) {
            throwIfCancelled(options.token);
            const nombre = nombresUnicos[index];

            if (index % 100 === 0) {
                onProgress?.('Verificando uso', index, nombresUnicos.length);
            }

            if (nombre.length < minLength || regexExcluidos.some(regex => regex.test(nombre))) {
                continue;
            }

            if (!tokens.has(nombre)) {
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
                    clases = await this.loadCssDefinitions(file, token);
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
        token?: CancellationToken
    ): Promise<{ tokens: Set<string>; totalArchivos: number }> {
        const files = await this.findUniqueFiles(patterns, exclude, token);
        const tokens = new Set<string>();
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
            if (tokens.size >= MAX_TOKENS) {
                break;
            }

            try {
                let fileTokens = this.consumerFileCache.get(file.fsPath);
                if (!fileTokens) {
                    fileTokens = await this.loadConsumerTokens(file, token);
                }
                for (const tokenValue of fileTokens) {
                    throwIfCancelled(token);
                    if (tokens.size >= MAX_TOKENS) {
                        break;
                    }
                    tokens.add(tokenValue);
                }
            } catch (error) {
                if (error instanceof CancellationError) {
                    throw error;
                }
                /* Mantiene el comportamiento historico: archivos no abribles no bloquean el reporte. */
            }
        }

        return { tokens, totalArchivos: files.size };
    }

    /* [028A-8] Carga las definiciones CSS de un archivo reutilizando el índice
     * persistente cuando el hash de contenido coincide. Store-first: el hash se
     * calcula del contenido real en disco antes de abrir/parsear el documento,
     * por lo que un archivo sin cambios nunca se vuelve a parsear. */
    private async loadCssDefinitions(file: WorkspaceFile, token?: CancellationToken): Promise<ClaseCssDefinida[]> {
        const hash = this.persistentStore ? await sha256File(file.fsPath) : null;
        const store = this.persistentStore;
        const stored = hash ? store?.getEntry(file.fsPath) : undefined;
        if (stored?.hash === hash && stored.classDefinitions) {
            if (store) {store.stats.reused++;}
            this.cssFileCache.set(file.fsPath, stored.classDefinitions);
            return stored.classDefinitions;
        }
        const document = await this.documentProvider.openTextDocument(file);
        throwIfCancelled(token);
        const clases = extraerClasesDeTexto(document.getText(), file.fsPath);
        this.cssFileCache.set(file.fsPath, clases);
        if (hash) {
            const previa = store?.getEntry(file.fsPath) ?? {};
            store?.setEntry(file.fsPath, { ...previa, hash, classDefinitions: clases });
            if (store) {store.stats.reparsed++;}
        }
        return clases;
    }

    /* [028A-8] Ídem para tokens de consumo: store-first, reutiliza la entrada
     * persistente cuando el hash coincide y registra la nueva al cambiar. */
    private async loadConsumerTokens(file: WorkspaceFile, token?: CancellationToken): Promise<Set<string>> {
        const hash = this.persistentStore ? await sha256File(file.fsPath) : null;
        const store = this.persistentStore;
        const stored = hash ? store?.getEntry(file.fsPath) : undefined;
        if (stored?.hash === hash && stored.consumerTokens) {
            if (store) {store.stats.reused++;}
            const fileTokens = new Set<string>(stored.consumerTokens);
            this.consumerFileCache.set(file.fsPath, fileTokens);
            return fileTokens;
        }
        const document = await this.documentProvider.openTextDocument(file);
        throwIfCancelled(token);
        const fileTokens = new Set<string>();
        extraerTokensDeTexto(document.getText(), fileTokens);
        this.consumerFileCache.set(file.fsPath, fileTokens);
        if (hash) {
            const previa = store?.getEntry(file.fsPath) ?? {};
            store?.setEntry(file.fsPath, { ...previa, hash, consumerTokens: [...fileTokens] });
            if (store) {store.stats.reparsed++;}
        }
        return fileTokens;
    }

    private async findUniqueFiles(patterns: string[], exclude: string[], token?: CancellationToken): Promise<Map<string, WorkspaceFile>> {
        const files = new Map<string, { uri: string; fsPath: string }>();

        for (const pattern of patterns) {
            throwIfCancelled(token);
            const matches = await this.fileProvider.findFiles([pattern], exclude);
            for (const file of matches) {
                throwIfCancelled(token);
                files.set(file.fsPath, file);
            }
        }

        return files;
    }
}
