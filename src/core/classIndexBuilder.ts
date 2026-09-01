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
/* [318A-7V2] Props que portan clases en los design systems del área:
 * className/class más cualquier prop con nombre clase/Clase al inicio
 * (claseAdicional, claseExtra, claseContenido, claseOverlay, claseContenedor,
 * clase). Verificado repo-wide: en todos los consumidores estas props se
 * concatenan al className del componente; ninguna prop *clase es dato.
 * El patrón se reutiliza en attr/template/jsx-expr para que los tres
 * formularios de valor cubran las mismas props. */
/* Los tres patrones comparten la alternancia de props portadoras:
 * className/class y cualquier prop cuyo nombre empiece por clase/Clase. */
const REGEX_CLASS_ATTR = /(?:className|class|[Cc]lase[\w$]*)\s*=\s*["']([^"']+)["']/g;
const REGEX_CLASS_TEMPLATE = /(?:className|class|[Cc]lase[\w$]*)\s*=\s*\{[`]([^`]+)[`]\}/g;
/* [J-8] JSX/TSX className={expr} con ternarios y literales: cubre
 * className={cond ? 'a' : 'b'} y className={'a b'}. Los identificadores
 * puros se resuelven por indirección de variables (ver recopilarDeclaraciones).
 * [318A-7V2] Ídem para props *clase (claseAdicional={cond ? 'a' : 'b'}). */
const REGEX_CLASS_JSX_EXPR = /(?:className|class|[Cc]lase[\w$]*)\s*=\s*\{([^{}]*)\}/g;
/* Vanilla TS/DOM factories commonly pass classes as object attributes:
 * createEl('div', { className: 'panel panel--active' }). Keep this parser
 * framework-agnostic while covering the project's createEl contract. */
const REGEX_CLASS_OBJECT = /(?:['"]?className['"]?|['"]?class['"]?)\s*:\s*(?:['"]([^'"]+)['"]|[`]([^`]+)[`])/g;
const REGEX_CLASS_FACTORY = /createContainer\s*\(\s*['"]([^'"]+)['"]/g;
const REGEX_EXTERNAL_LINK_CLASS = /createExternalLink\s*\([^,]+,[^,]+,\s*['"]([^'"]+)['"]/g;
/* [J-8] createElement(tag, 'clase') posicional: Glory-Laminal pasa la clase
 * como segundo argumento (helper createElement(tag, className, text)). */
const REGEX_CREATE_ELEMENT_CLASS = /createElement\s*\(\s*['"][^'"]+['"]\s*,\s*([^)]*)\)/g;
/* [J-8] classList.add/toggle/remove: toggle('clase', cond) y remove('clase')
 * son usos reales igual que add. */
const REGEX_CLASS_LIST = /classList\.(?:add|toggle|remove)\s*\(([^)]*)\)/g;
/* [318A-7V2] Cap 240 → 1000: templates largos (DashboardIsland.tsx:300, ~270
 * chars) y ternarios encadenados se truncaban y perdían las clases del final.
 * El tope de tokens del scan (MAX_TOKENS) sigue acotando la memoria total. */
const REGEX_CLASS_DECLARATION = /\b(?:const|let|var)\s+(?:className|contentClass)\s*=\s*([\s\S]{0,1000}?);/g;
/* [J-8] Cualquier declaración de variable cuyo valor sea un literal de clase
 * (string, template, ternario, array/objeto de literales). Permite resolver
 * className={ident} y classList.add(ident) por indirección. */
const REGEX_VAR_CLASS_DECLARATION = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]{0,1000}?);/g;
const REGEX_STRING_LITERAL = /['"`]([^'"`$]+)['"`]/g;
/* [J-8] El cap evita que un workspace enorme agote memoria, pero 10000 deja
 * sin escanear archivos posteriores (MapaV2.tsx etc.) en proyectos medianos.
 * 50k cubre la práctica real con RSS holgado (70MB en workspace-manager). */
const MAX_TOKENS = 50000;

/* [028A-8 tramo 4] Nombres de variables referenciadas con var(--x) en un
 * texto CSS. Permite al índice inverso de variables seleccionar consumidores. */
export function extraerUsoVariablesDeTexto(texto: string): string[] {
    const usos = new Set<string>();
    const regexVar = /var\(\s*(--[\w-]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regexVar.exec(texto)) !== null) {
        usos.add(match[1]);
    }
    return [...usos].sort();
}

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

/* [J-8] Recorta cadenas de métodos al final de un valor para reducir
 * `\`campo ${x}\`.trim()` o `['a','b'].join(' ')` a su literal base. */
function normalizarValorLiteral(value: string): string {
    let current = value.trim();
    for (;;) {
        const recortado = current.replace(/\s*\.\s*\w+\s*\([^)]*\)\s*$/, '');
        if (recortado === current) {
            break;
        }
        current = recortado;
    }
    return current;
}

/* [J-8] Recopila declaraciones cuyo valor es un literal de clases: string,
 * template, ternario con literales o array de literales. Permite resolver
 * className={ident}, classList.add(ident) y createElement(tag, ident) por
 * indirección de variable (const x = 'a b'; ...; className={x}). Solo
 * literales: una llamada a función (helper('clase')) NO resuelve, manteniendo
 * el contrato del test 'unusedPanel'. */
function recopilarDeclaraciones(source: string): Map<string, Set<string>> {
    const variables = new Map<string, Set<string>>();
    let match: RegExpExecArray | null;

    REGEX_VAR_CLASS_DECLARATION.lastIndex = 0;
    while ((match = REGEX_VAR_CLASS_DECLARATION.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {
            continue;
        }
        const previous = previousCodeCharacter(source, match.index);
        if (previous && /[\w'"`]/.test(previous)) {
            continue;
        }
        const nombre = match[1];
        /* className/contentClass ya se resuelven por REGEX_CLASS_DECLARATION. */
        if (nombre === 'className' || nombre === 'contentClass') {
            continue;
        }
        const valor = normalizarValorLiteral(match[2]);
        const tokensVariable = new Set<string>();
        if (/^(['"`])[\s\S]*\1$/.test(valor)) {
            addClassTokens(valor.slice(1, -1), tokensVariable);
            addQuotedClassTokens(valor, tokensVariable);
        } else if (valor.includes('?')) {
            addQuotedClassTokens(valor, tokensVariable);
        } else if (valor.startsWith('[')) {
            addQuotedClassTokens(valor, tokensVariable);
        }
        if (tokensVariable.size > 0) {
            variables.set(nombre, tokensVariable);
        }
    }
    return variables;
}

/* [J-8] Resuelve un identificador puro (className={clases}) contra el mapa de
 * declaraciones; si no es un identificador, extrae los literales embebidos
 * (ternarios, templates). */
function resolverExpresionClase(body: string, variables: Map<string, Set<string>>, tokens: Set<string>): void {
    const trimmed = body.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
        const resuelto = variables.get(trimmed);
        if (resuelto) {
            for (const token of resuelto) {
                tokens.add(token);
            }
        }
        return;
    }
    addQuotedClassTokens(trimmed, tokens);
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
            result += current === '\n' ? '\n' : ' ';
            if (current === '\n') {comment = '';}
            continue;
        }
        if (comment === 'block') {
            result += current === '\n' ? '\n' : ' ';
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
    /* [J-8] La indirección requiere conocer las declaraciones antes de
     * resolver los usos (className={ident}). Se recopila una vez por archivo. */
    const variables = recopilarDeclaraciones(source);

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

    /* [J-8] className={cond ? 'a' : 'b'} y className={'a b'}: expresiones
     * JSX con literales o identificadores indirectos. */
    REGEX_CLASS_JSX_EXPR.lastIndex = 0;
    while ((match = REGEX_CLASS_JSX_EXPR.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        resolverExpresionClase(match[1], variables, tokens);
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

    /* [J-8] createElement(tag, 'clase') posicional: el segundo argumento es
     * la clase (o un ternario de literales / identificador indirecto). */
    REGEX_CREATE_ELEMENT_CLASS.lastIndex = 0;
    while ((match = REGEX_CREATE_ELEMENT_CLASS.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        resolverExpresionClase(match[1], variables, tokens);
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
        resolverExpresionClase(match[1], variables, tokens);
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
        const texto = document.getText();
        const clases = extraerClasesDeTexto(texto, file.fsPath);
        this.cssFileCache.set(file.fsPath, clases);
        if (hash) {
            const previa = store?.getEntry(file.fsPath) ?? {};
            store?.setEntry(file.fsPath, {
                ...previa,
                hash,
                classDefinitions: clases,
                /* [028A-8 tramo 4] Los usos de variables se capturan junto a las
                 * definiciones de clase: ambos salen del mismo texto CSS y el
                 * hash ya validó el contenido. */
                variableUsages: extraerUsoVariablesDeTexto(texto),
            });
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

        /* El provider recibe todos los patrones en una sola pasada. Hacer un
         * recorrido por patrón multiplica el coste de readdir/glob en cada
         * ejecución cold y no aporta deduplicación adicional: el Map ya la
         * garantiza para providers que devuelvan coincidencias repetidas. */
        throwIfCancelled(token);
        const matches = await this.fileProvider.findFiles(patterns, exclude);
        for (const file of matches) {
            throwIfCancelled(token);
            files.set(file.fsPath, file);
        }

        return files;
    }
}
