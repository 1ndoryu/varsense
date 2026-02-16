/*
 * Tipos principales para la extensión CSS Variables Validator
 * Define todas las interfaces y tipos utilizados en el proyecto
 */

import * as vscode from 'vscode';

/*
 * Representa una variable CSS definida en el proyecto
 */
export interface CssVariable {
    nombre: string;
    valor: string;
    archivo: string;
    linea: number;
    columna: number;
    /* Valor resuelto si la variable referencia otra variable */
    valorResuelto?: string;
    /* Indica si el valor es un color */
    esColor?: boolean;
    /* Frecuencia de uso en el proyecto */
    frecuenciaUso: number;
}

/*
 * Índice de variables CSS para búsqueda rápida
 */
export interface VariableIndex {
    /* Mapa de nombre de variable a su definición */
    variables: Map<string, CssVariable>;
    /* Timestamp de última actualización */
    ultimaActualizacion: number;
    /* Archivos escaneados */
    archivosEscaneados: string[];
}

/*
 * Uso de una variable CSS encontrado en el código
 */
export interface VariableUsage {
    nombreVariable: string;
    archivo: string;
    linea: number;
    columna: number;
    rango: vscode.Range;
    /* Valor de fallback si existe: var(--color, #fff) */
    fallback?: string;
}

/*
 * Valor hardcodeado detectado
 */
export interface HardcodedValue {
    propiedad: string;
    valor: string;
    archivo: string;
    linea: number;
    columna: number;
    rango: vscode.Range;
    /* Sugerencias de variables que podrían reemplazarlo */
    sugerencias: string[];
}

/*
 * Resultado del parsing de un archivo CSS
 */
export interface ParseResult {
    /* Variables definidas en el archivo */
    variablesDefinidas: CssVariable[];
    /* Clases duplicadas detectadas */
    clasesDuplicadas: DuplicateClass[];
    /* Usos de variables encontrados */
    usosVariables: VariableUsage[];
    /* Valores hardcodeados detectados */
    valoresHardcoded: HardcodedValue[];
    /* Errores de parsing si los hay */
    errores: ParseError[];
}

/*
 * Clase duplicada detectada
 */
export interface DuplicateClass {
    nombre: string;
    rango: vscode.Range;
    linea: number;
    columna: number;
}

/*
 * Error durante el parsing
 */
export interface ParseError {
    mensaje: string;
    linea: number;
    columna: number;
}

/*
 * Configuración de la extensión
 */
export interface ExtensionConfig {
    habilitado: boolean;
    archivosVariables: string[];
    patronesIncluidos: string[];
    deteccionHardcoded: HardcodedDetectionConfig;
    deteccionInline: InlineDetectionConfig;
    duplicadosHabilitado: boolean;
    duplicadosCrossFile: boolean;
    sugerenciasContextuales: Record<string, string[]>;
    patronesExcluidos: string[];
    escanearTodosArchivos: boolean;
}

/*
 * Configuración para detección de valores hardcodeados
 */
export interface HardcodedDetectionConfig {
    habilitado: boolean;
    severidad: vscode.DiagnosticSeverity;
    propiedades: Record<string, boolean>;
    valoresPermitidos: string[];
}

/*
 * Información para mostrar en hover
 */
export interface HoverInfo {
    variable: CssVariable;
    /* Representación visual del color si aplica */
    colorPreview?: string;
    /* Markdown formateado para mostrar */
    contenido: vscode.MarkdownString;
}

/*
 * Item de autocompletado para variables CSS
 */
export interface CompletionInfo {
    variable: CssVariable;
    /* Relevancia para ordenamiento (mayor = más relevante) */
    relevancia: number;
    /* Etiquetas de contexto que coincidieron */
    etiquetasCoincidentes: string[];
}

/*
 * Diagnóstico personalizado con metadata adicional
 */
export interface CssDiagnostic {
    tipo: DiagnosticType;
    mensaje: string;
    rango: vscode.Range;
    severidad: vscode.DiagnosticSeverity;
    /* Nombre de variable si aplica */
    nombreVariable?: string;
    /* Valor hardcodeado si aplica */
    valorHardcoded?: string;
    /* Propiedad CSS si aplica */
    propiedad?: string;
}

/*
 * Tipos de diagnósticos
 */
export enum DiagnosticType {
    VariableNoDefinida = 'variableNoDefinida',
    ValorHardcoded = 'valorHardcoded',
    FallbackHardcoded = 'fallbackHardcoded',
    ClaseDuplicada = 'claseDuplicada',
    ClaseDuplicadaCrossFile = 'claseDuplicadaCrossFile',
    CssInlineReact = 'cssInlineReact'
}

/*
 * Estado del caché de variables
 */
export interface CacheState {
    /* Indica si el caché está actualizado */
    valido: boolean;
    /* Índice de variables */
    indice: VariableIndex;
    /* Map de archivo a sus variables para invalidación parcial */
    variablesPorArchivo: Map<string, CssVariable[]>;
    /* Índice de clases CSS por archivo para detección cross-file */
    clasesPorArchivo: Map<string, ClassEntry[]>;
}

/*
 * Entrada de clase CSS indexada para detección cross-file
 */
export interface ClassEntry {
    nombre: string;
    archivo: string;
    linea: number;
    columna: number;
}

/*
 * Configuración para detección de CSS inline en React
 */
export interface InlineDetectionConfig {
    habilitado: boolean;
    severidad: vscode.DiagnosticSeverity;
}

/*
 * Resultado de la resolución de una variable
 */
export interface ResolvedVariable {
    encontrada: boolean;
    variable?: CssVariable;
    /* Si la variable referencia otra, contiene la cadena de resolución */
    cadenaResolucion?: string[];
}

/*
 * Representa un token CSS parseado
 */
export interface CssToken {
    tipo: CssTokenType;
    valor: string;
    inicio: number;
    fin: number;
    linea: number;
    columna: number;
}

/*
 * Tipos de tokens CSS
 */
export enum CssTokenType {
    Selector = 'selector',
    Propiedad = 'propiedad',
    Valor = 'valor',
    VariableDefinicion = 'variableDefinicion',
    VariableUso = 'variableUso',
    Comentario = 'comentario',
    LlaveAbre = 'llaveAbre',
    LlaveCierra = 'llaveCierra',
    DosPuntos = 'dosPuntos',
    PuntoComa = 'puntoComa'
}

/*
 * Declaración CSS parseada
 */
export interface CssDeclaration {
    propiedad: string;
    valor: string;
    rangoPropiedad: vscode.Range;
    rangoValor: vscode.Range;
    /* Variables usadas en el valor */
    variablesUsadas: VariableUsage[];
    /* Si es una definición de variable CSS */
    esDefinicionVariable: boolean;
}

/*
 * Regla CSS parseada
 */
export interface CssRule {
    selector: string;
    rangoSelector: vscode.Range;
    declaraciones: CssDeclaration[];
    /* Reglas anidadas (para @media, etc) */
    reglasAnidadas?: CssRule[];
}

/*
 * Información de un color
 */
export interface ColorInfo {
    formato: ColorFormat;
    /* Valores RGB normalizados (0-255) */
    r: number;
    g: number;
    b: number;
    /* Alpha (0-1) */
    a: number;
    /* Representación original */
    original: string;
    /* Representación hexadecimal */
    hex: string;
}

/*
 * Formatos de color soportados
 */
export enum ColorFormat {
    Hex = 'hex',
    Rgb = 'rgb',
    Rgba = 'rgba',
    Hsl = 'hsl',
    Hsla = 'hsla',
    Named = 'named'
}

/*
 * Opciones para el escáner de variables
 */
export interface ScannerOptions {
    /* Patrones de archivos a escanear */
    patronesArchivos: string[];
    /* Patrones a excluir */
    patronesExcluidos: string[];
    /* Si debe escanear recursivamente */
    recursivo: boolean;
}

/*
 * Evento de cambio en variables
 */
export interface VariableChangeEvent {
    tipo: 'agregada' | 'modificada' | 'eliminada';
    variable: CssVariable;
    archivoOrigen: string;
}

/*
 * Resultado de búsqueda de variables
 */
export interface VariableSearchResult {
    variables: CssVariable[];
    tiempoBusqueda: number;
    totalEncontradas: number;
}

/*
 * Mapeo de severidades de string a DiagnosticSeverity
 */
export const SEVERITY_MAP: Record<string, vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    information: vscode.DiagnosticSeverity.Information,
    hint: vscode.DiagnosticSeverity.Hint
};
