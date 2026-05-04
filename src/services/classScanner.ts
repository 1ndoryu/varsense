/*
 * Escáner de clases CSS huérfanas
 * Detecta clases definidas en archivos CSS que no se usan en archivos consumidores
 * Estrategia: extraer tokens de archivos consumidores (TSX, JSX, TS, JS, PHP, HTML),
 * cruzar con definiciones de clase extraidas de archivos CSS
 */

import * as vscode from 'vscode';

/* Representa una clase CSS definida en un archivo */
export interface ClaseCssDefinida {
    nombre: string;
    archivo: string;
    linea: number;
    columna: number;
    selector: string;
}

/* Resultado del escaneo de clases huérfanas */
export interface ResultadoClasesHuerfanas {
    totalClasesDefinidas: number;
    totalClasesUsadas: number;
    totalClasesHuerfanas: number;
    clasesHuerfanas: ClaseCssDefinida[];
    archivosAnalizadosCss: number;
    archivosAnalizadosConsumo: number;
    tiempoMs: number;
}

/*
 * Extrae selectores de clase de un texto CSS
 * Diferencia lineas de selectores vs propiedades CSS
 * Ignora comentarios y directivas @import/@charset
 */
function extraerClasesDeTexto(texto: string, rutaArchivo: string): ClaseCssDefinida[] {
    const clases: ClaseCssDefinida[] = [];

    /* Eliminar comentarios CSS preservando conteo de lineas */
    const textoLimpio = texto.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

    const lineas = textoLimpio.split('\n');
    const regexClase = /\.([a-zA-Z_][\w-]*)/g;

    for (let numLinea = 0; numLinea < lineas.length; numLinea++) {
        const linea = lineas[numLinea];
        const trimmed = linea.trim();

        if (!trimmed) {
            continue;
        }

        /*
         * Detectar lineas de propiedades CSS: "property-name: value;"
         * No confundir con pseudo-clases como ".foo:hover {"
         * Logica: la linea empieza con un nombre de propiedad seguido de : (no ::)
         * y no contiene { (las propiedades no abren bloque)
         */
        const esPropiedad = /^\s*[\w-]+\s*:(?!:)/.test(linea) && !linea.includes('{');
        if (esPropiedad) {
            continue;
        }

        /* Saltar directivas sin bloque (@import, @charset, @namespace) */
        if (trimmed.startsWith('@') && !trimmed.includes('{')) {
            continue;
        }

        /* Extraer nombres de clase de selectores en esta linea */
        let match: RegExpExecArray | null;
        while ((match = regexClase.exec(linea)) !== null) {
            const nombreClase = match[1];

            clases.push({
                nombre: nombreClase,
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

/*
 * Escanea archivos CSS del proyecto y extrae definiciones de clases
 * Agrupa por nombre de clase para facilitar cruces
 */
async function escanearDefinicionesCss(
    excluidos: string[],
    onProgress?: (actual: number, total: number) => void
): Promise<{ clasesMap: Map<string, ClaseCssDefinida[]>; totalArchivos: number }> {
    const patronExclusion = excluidos.length > 0
        ? `{${excluidos.join(',')}}`
        : '**/node_modules/**';

    const uris = await vscode.workspace.findFiles('**/*.css', patronExclusion);
    const clasesMap = new Map<string, ClaseCssDefinida[]>();

    for (let i = 0; i < uris.length; i++) {
        try {
            const doc = await vscode.workspace.openTextDocument(uris[i]);
            const clases = extraerClasesDeTexto(doc.getText(), uris[i].fsPath);

            for (const clase of clases) {
                const existentes = clasesMap.get(clase.nombre) || [];
                /* Evitar duplicados exactos (mismo archivo y linea) */
                const duplicado = existentes.some(c => c.archivo === clase.archivo && c.linea === clase.linea);
                if (!duplicado) {
                    existentes.push(clase);
                    clasesMap.set(clase.nombre, existentes);
                }
            }
        } catch {
            /* Archivos que no se pueden abrir se ignoran */
        }

        onProgress?.(i + 1, uris.length);
    }

    return { clasesMap, totalArchivos: uris.length };
}

/*
 * [124A-AUDIT1] Extrae tokens de clase CSS de archivos consumidores.
 * Solo extrae de atributos class/className para evitar explosión de RAM
 * al extraer TODOS los identificadores de cada archivo.
 * Incluye TSX, JSX, TS, JS, PHP, HTML.
 * Retorna un Set para busqueda O(1) por token.
 */

/* Regex precompiladas a nivel de módulo para evitar recreación por archivo */
const REGEX_CLASS_ATTR = /(?:className|class)\s*=\s*["']([^"']+)["']/g;
const REGEX_CLASS_TEMPLATE = /(?:className|class)\s*=\s*\{[`]([^`]+)[`]\}/g;
const REGEX_TOKEN = /[a-zA-Z_][\w-]+/g;
const MAX_TOKENS = 10000;

async function extraerTokensConsumidores(
    excluidos: string[]
): Promise<{ tokens: Set<string>; totalArchivos: number }> {
    const patronExclusion = excluidos.length > 0
        ? `{${excluidos.join(',')}}`
        : '**/node_modules/**';

    const patronesBusqueda = [
        '**/*.tsx', '**/*.jsx',
        '**/*.ts', '**/*.js',
        '**/*.php', '**/*.html'
    ];
    const urisUnicos = new Map<string, vscode.Uri>();

    for (const patron of patronesBusqueda) {
        const archivos = await vscode.workspace.findFiles(patron, patronExclusion);
        for (const uri of archivos) {
            urisUnicos.set(uri.fsPath, uri);
        }
    }

    const tokens = new Set<string>();

    for (const uri of urisUnicos.values()) {
        if (tokens.size >= MAX_TOKENS) { break; }

        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const texto = doc.getText();

            /* Extraer solo de class/className atributos */
            let match: RegExpExecArray | null;

            REGEX_CLASS_ATTR.lastIndex = 0;
            while ((match = REGEX_CLASS_ATTR.exec(texto)) !== null) {
                for (const clase of match[1].split(/\s+/)) {
                    if (clase.length > 1) { tokens.add(clase); }
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
        } catch {
            /* Ignorar archivos que no se pueden abrir */
        }
    }

    return { tokens, totalArchivos: urisUnicos.size };
}

/*
 * Ejecuta el escaneo completo de clases huérfanas
 * 1. Escanea archivos CSS para definiciones de clases
 * 2. Extrae tokens de archivos consumidores (TSX, JSX, TS, JS, PHP, HTML)
 * 3. Cruza referencias: clases definidas que no aparecen como tokens en consumidores
 *
 * Nota: usa extraccion de tokens en vez de includes() simple para evitar
 * falsos negativos por subcadenas (ej: clase "btn" encontrada dentro de "btnPrimario")
 */
export async function escanearClasesHuerfanas(
    excluidos: string[],
    longitudMinima: number = 3,
    patronesExcluidosClase: string[] = [],
    onProgress?: (fase: string, actual: number, total: number) => void
): Promise<ResultadoClasesHuerfanas> {
    const inicio = Date.now();

    /* Fase 1: Escanear definiciones CSS */
    const { clasesMap, totalArchivos: archivosCss } = await escanearDefinicionesCss(
        excluidos,
        (actual, total) => onProgress?.('Escaneando CSS', actual, total)
    );

    /* Fase 2: Extraer tokens de consumidores */
    onProgress?.('Extrayendo tokens de consumidores', 0, 1);
    const {
        tokens: tokensUsados,
        totalArchivos: archivosConsumo
    } = await extraerTokensConsumidores(excluidos);

    /* Compilar regex de patrones excluidos para nombres de clase */
    const regexExcluidos = patronesExcluidosClase
        .filter(p => p.length > 0)
        .map(p => {
            try { return new RegExp(p); } catch { return null; }
        })
        .filter((r): r is RegExp => r !== null);

    /* Fase 3: Cruzar referencias */
    const clasesHuerfanas: ClaseCssDefinida[] = [];
    const nombresUnicos = Array.from(clasesMap.keys());

    for (let i = 0; i < nombresUnicos.length; i++) {
        const nombre = nombresUnicos[i];

        if (i % 100 === 0) {
            onProgress?.('Verificando uso', i, nombresUnicos.length);
        }

        /* Filtrar por longitud minima */
        if (nombre.length < longitudMinima) {
            continue;
        }

        /* Filtrar por patrones excluidos */
        if (regexExcluidos.some(r => r.test(nombre))) {
            continue;
        }

        /* Verificar si el token existe en archivos consumidores */
        if (!tokensUsados.has(nombre)) {
            const definiciones = clasesMap.get(nombre) || [];
            /* Reportar la primera definicion encontrada */
            if (definiciones.length > 0) {
                clasesHuerfanas.push(definiciones[0]);
            }
        }
    }

    /* Ordenar por archivo y linea para presentacion coherente */
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
