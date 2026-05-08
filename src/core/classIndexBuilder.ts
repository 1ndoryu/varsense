import { DocumentProvider, WorkspaceFileProvider } from './workspaceProviders';

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
const REGEX_TOKEN = /[a-zA-Z_][\w-]+/g;
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

function extraerTokensDeTexto(texto: string, tokens: Set<string>): void {
    let match: RegExpExecArray | null;

    REGEX_CLASS_ATTR.lastIndex = 0;
    while ((match = REGEX_CLASS_ATTR.exec(texto)) !== null) {
        for (const clase of match[1].split(/\s+/)) {
            if (clase.length > 1) {
                tokens.add(clase);
            }
        }
    }

    REGEX_CLASS_TEMPLATE.lastIndex = 0;
    while ((match = REGEX_CLASS_TEMPLATE.exec(texto)) !== null) {
        REGEX_TOKEN.lastIndex = 0;
        let tokenMatch: RegExpExecArray | null;
        while ((tokenMatch = REGEX_TOKEN.exec(match[1])) !== null) {
            tokens.add(tokenMatch[0]);
        }
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
    constructor(
        private readonly fileProvider: WorkspaceFileProvider,
        private readonly documentProvider: DocumentProvider
    ) {}

    public async scan(
        options: ClassIndexScanOptions,
        onProgress?: ClassScanProgress
    ): Promise<ResultadoClasesHuerfanas> {
        const inicio = Date.now();
        const cssPatterns = options.cssPatterns ?? DEFAULT_CSS_PATTERNS;
        const consumerPatterns = options.consumerPatterns ?? DEFAULT_CONSUMER_PATTERNS;
        const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;

        const { clasesMap, totalArchivos: archivosCss } = await this.scanCssDefinitions(
            cssPatterns,
            options.exclude,
            (actual, total) => onProgress?.('Escaneando CSS', actual, total)
        );

        onProgress?.('Extrayendo tokens de consumidores', 0, 1);
        const { tokens, totalArchivos: archivosConsumo } = await this.extractConsumerTokens(
            consumerPatterns,
            options.exclude
        );

        const regexExcluidos = compilarPatronesExcluidos(options.excludedClassPatterns ?? []);
        const clasesHuerfanas: ClaseCssDefinida[] = [];
        const nombresUnicos = Array.from(clasesMap.keys());

        for (let index = 0; index < nombresUnicos.length; index++) {
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
        onProgress?: (actual: number, total: number) => void
    ): Promise<{ clasesMap: Map<string, ClaseCssDefinida[]>; totalArchivos: number }> {
        const files = await this.fileProvider.findFiles(patterns, exclude);
        const clasesMap = new Map<string, ClaseCssDefinida[]>();

        for (let index = 0; index < files.length; index++) {
            try {
                const document = await this.documentProvider.openTextDocument(files[index]);
                const clases = extraerClasesDeTexto(document.getText(), files[index].fsPath);

                for (const clase of clases) {
                    const existentes = clasesMap.get(clase.nombre) ?? [];
                    const duplicado = existentes.some(item => item.archivo === clase.archivo && item.linea === clase.linea);
                    if (!duplicado) {
                        existentes.push(clase);
                        clasesMap.set(clase.nombre, existentes);
                    }
                }
            } catch {
                /* Mantiene el comportamiento historico: archivos no abribles no bloquean el reporte. */
            }

            onProgress?.(index + 1, files.length);
        }

        return { clasesMap, totalArchivos: files.length };
    }

    private async extractConsumerTokens(
        patterns: string[],
        exclude: string[]
    ): Promise<{ tokens: Set<string>; totalArchivos: number }> {
        const files = await this.findUniqueFiles(patterns, exclude);
        const tokens = new Set<string>();

        for (const file of files.values()) {
            if (tokens.size >= MAX_TOKENS) {
                break;
            }

            try {
                const document = await this.documentProvider.openTextDocument(file);
                extraerTokensDeTexto(document.getText(), tokens);
            } catch {
                /* Mantiene el comportamiento historico: archivos no abribles no bloquean el reporte. */
            }
        }

        return { tokens, totalArchivos: files.size };
    }

    private async findUniqueFiles(patterns: string[], exclude: string[]): Promise<Map<string, { uri: string; fsPath: string }>> {
        const files = new Map<string, { uri: string; fsPath: string }>();

        for (const pattern of patterns) {
            const matches = await this.fileProvider.findFiles([pattern], exclude);
            for (const file of matches) {
                files.set(file.fsPath, file);
            }
        }

        return files;
    }
}
