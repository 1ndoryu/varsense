/*
 * Parser de valores CSS
 * Analiza valores CSS para detectar variables, colores, y valores hardcodeados
 */

import * as vscode from 'vscode';
import { VariableUsage } from '../types';
import { esColor } from '../utils/colorUtils';

/*
 * Regex para detectar uso de variables CSS: var(--nombre) o var(--nombre, fallback)
 */
const VAR_REGEX = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\s*\)/g;

/*
 * Regex para detectar definición de variables CSS: --nombre: valor
 */
const VAR_DEFINITION_REGEX = /^\s*(--[\w-]+)\s*$/;

/*
 * Patrones para detectar valores hardcodeados por tipo
 */
const HARDCODED_PATTERNS = {
    /* Colores hexadecimales */
    hex: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    
    /* rgb() y rgba() */
    rgb: /^rgba?\s*\(/i,
    
    /* hsl() y hsla() */
    hsl: /^hsla?\s*\(/i,
    
    /* Valores numéricos con unidades */
    numerico: /^-?\d+(\.\d+)?(px|em|rem|%|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|deg|rad|turn|s|ms)$/i,
    
    /* Números puros (sin unidad) */
    numeroPuro: /^-?\d+(\.\d+)?$/
};

/*
 * Información extraída de un uso de variable
 */
export interface VariableMatch {
    nombreCompleto: string;  /* var(--color, #fff) */
    nombreVariable: string;  /* --color */
    fallback: string | null; /* #fff */
    inicio: number;          /* posición de inicio en el string */
    fin: number;             /* posición de fin en el string */
}

/*
 * Extrae todas las variables CSS usadas en un valor
 */
export function extraerVariablesDeValor(valor: string): VariableMatch[] {
    const matches: VariableMatch[] = [];
    let match: RegExpExecArray | null;
    
    /* Reset del regex para nueva búsqueda */
    VAR_REGEX.lastIndex = 0;
    
    while ((match = VAR_REGEX.exec(valor)) !== null) {
        matches.push({
            nombreCompleto: match[0],
            nombreVariable: match[1],
            fallback: match[2]?.trim() || null,
            inicio: match.index,
            fin: match.index + match[0].length
        });
    }
    
    return matches;
}

/*
 * Verifica si un valor es una definición de variable CSS
 */
export function esDefinicionVariable(propiedad: string): boolean {
    return VAR_DEFINITION_REGEX.test(propiedad);
}

/*
 * Obtiene el nombre de la variable de una definición
 * Ej: "--mi-color" -> "--mi-color"
 */
export function obtenerNombreVariable(propiedad: string): string | null {
    const match = VAR_DEFINITION_REGEX.exec(propiedad.trim());
    return match ? match[1] : null;
}

/*
 * Verifica si un valor es hardcodeado (no usa variables)
 */
export function esValorHardcodeado(valor: string): boolean {
    const valorLimpio = valor.trim();
    
    /* Si contiene var(), no es hardcodeado */
    if (valorLimpio.includes('var(')) {
        return false;
    }
    
    /* Verificar patrones de hardcoded */
    if (HARDCODED_PATTERNS.hex.test(valorLimpio)) {
        return true;
    }
    
    if (HARDCODED_PATTERNS.rgb.test(valorLimpio)) {
        return true;
    }
    
    if (HARDCODED_PATTERNS.hsl.test(valorLimpio)) {
        return true;
    }
    
    if (HARDCODED_PATTERNS.numerico.test(valorLimpio)) {
        return true;
    }
    
    /* Verificar colores nombrados */
    if (esColor(valorLimpio)) {
        return true;
    }
    
    return false;
}

/*
 * Detecta el tipo de valor hardcodeado
 */
export function detectarTipoHardcodeado(valor: string): 'color' | 'numero' | 'otro' {
    const valorLimpio = valor.trim();
    
    if (HARDCODED_PATTERNS.hex.test(valorLimpio) ||
        HARDCODED_PATTERNS.rgb.test(valorLimpio) ||
        HARDCODED_PATTERNS.hsl.test(valorLimpio) ||
        esColor(valorLimpio)) {
        return 'color';
    }
    
    if (HARDCODED_PATTERNS.numerico.test(valorLimpio) ||
        HARDCODED_PATTERNS.numeroPuro.test(valorLimpio)) {
        return 'numero';
    }
    
    return 'otro';
}

/*
 * Crea objetos VariableUsage desde matches encontrados en un documento
 */
export function crearUsosVariable(
    matches: VariableMatch[],
    documento: vscode.TextDocument,
    lineaBase: number,
    columnaBase: number,
    texto: string
): VariableUsage[] {
    return matches.map(match => {
        /* Calcular la posición real en el documento */
        const posicionEnTexto = calcularPosicion(texto, match.inicio);
        const lineaReal = lineaBase + posicionEnTexto.linea;
        const columnaReal = posicionEnTexto.linea === 0 
            ? columnaBase + posicionEnTexto.columna 
            : posicionEnTexto.columna;
        
        const posicionFinEnTexto = calcularPosicion(texto, match.fin);
        const lineaFinReal = lineaBase + posicionFinEnTexto.linea;
        const columnaFinReal = posicionFinEnTexto.linea === 0
            ? columnaBase + posicionFinEnTexto.columna
            : posicionFinEnTexto.columna;
        
        return {
            nombreVariable: match.nombreVariable,
            archivo: documento.uri.fsPath,
            linea: lineaReal,
            columna: columnaReal,
            rango: new vscode.Range(
                new vscode.Position(lineaReal, columnaReal),
                new vscode.Position(lineaFinReal, columnaFinReal)
            ),
            fallback: match.fallback ?? undefined
        };
    });
}

/*
 * Calcula línea y columna desde un offset en texto
 */
function calcularPosicion(texto: string, offset: number): { linea: number; columna: number } {
    let linea = 0;
    let columna = 0;
    
    for (let i = 0; i < offset && i < texto.length; i++) {
        if (texto[i] === '\n') {
            linea++;
            columna = 0;
        } else {
            columna++;
        }
    }
    
    return { linea, columna };
}

/*
 * Parsea un valor CSS compuesto (ej: "1px solid var(--color)")
 * y extrae las partes individuales
 */
export function parsearValorCompuesto(valor: string): string[] {
    const partes: string[] = [];
    let actual = '';
    let profundidadParentesis = 0;
    
    for (let i = 0; i < valor.length; i++) {
        const char = valor[i];
        
        if (char === '(') {
            profundidadParentesis++;
            actual += char;
        } else if (char === ')') {
            profundidadParentesis--;
            actual += char;
        } else if (char === ' ' && profundidadParentesis === 0) {
            if (actual.trim()) {
                partes.push(actual.trim());
            }
            actual = '';
        } else {
            actual += char;
        }
    }
    
    if (actual.trim()) {
        partes.push(actual.trim());
    }
    
    return partes;
}

/*
 * Normaliza un valor CSS para comparación
 */
export function normalizarValor(valor: string): string {
    return valor
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s*\(\s*/g, '(')
        .replace(/\s*\)\s*/g, ')');
}

/*
 * Verifica si el valor de fallback en un var() es hardcodeado
 */
export function tieneFallbackHardcodeado(match: VariableMatch): boolean {
    if (!match.fallback) {
        return false;
    }
    
    return esValorHardcodeado(match.fallback);
}

/*
 * Extrae el valor limpio de una propiedad CSS
 * Maneja casos como "color: #fff !important;"
 */
export function extraerValorLimpio(valorCompleto: string): string {
    return valorCompleto
        .replace(/!important/gi, '')
        .replace(/;$/, '')
        .trim();
}

/*
 * Verifica si una propiedad CSS es relacionada con colores
 */
export function esPropiedadColor(propiedad: string): boolean {
    const propiedadesColor = [
        'color',
        'background-color',
        'background',
        'border-color',
        'border-top-color',
        'border-right-color',
        'border-bottom-color',
        'border-left-color',
        'outline-color',
        'text-decoration-color',
        'fill',
        'stroke',
        'caret-color',
        'column-rule-color',
        'accent-color'
    ];
    
    return propiedadesColor.includes(propiedad.toLowerCase());
}

/*
 * Verifica si una propiedad CSS es relacionada con tamaños de fuente
 */
export function esPropiedadFuente(propiedad: string): boolean {
    const propiedadesFuente = [
        'font-size',
        'font-weight',
        'line-height',
        'letter-spacing',
        'word-spacing',
        'font-family'
    ];
    
    return propiedadesFuente.includes(propiedad.toLowerCase());
}

/*
 * Verifica si una propiedad CSS es relacionada con espaciado
 */
export function esPropiedadEspaciado(propiedad: string): boolean {
    const propiedadesEspaciado = [
        'margin',
        'margin-top',
        'margin-right',
        'margin-bottom',
        'margin-left',
        'padding',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
        'gap',
        'row-gap',
        'column-gap'
    ];
    
    return propiedadesEspaciado.includes(propiedad.toLowerCase());
}
