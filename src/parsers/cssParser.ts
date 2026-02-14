/*
 * Parser de archivos CSS
 * Analiza documentos CSS para extraer declaraciones, variables y usos
 */

import * as vscode from 'vscode';
import {CssVariable, CssDeclaration, CssRule, ParseResult, VariableUsage, HardcodedValue, DuplicateClass} from '../types';
import {extraerVariablesDeValor, esDefinicionVariable, obtenerNombreVariable, esValorHardcodeado, extraerValorLimpio, crearUsosVariable} from './valueParser';
import {esColor} from '../utils/colorUtils';
import {obtenerConfigService} from '../services/configService';

/*
 * Regex para encontrar bloques de reglas CSS
 * Captura selector y contenido entre llaves
 */
const RULE_REGEX = /([^{}]+)\{([^{}]*)\}/g;

/*
 * Regex para encontrar declaraciones CSS (propiedad: valor)
 */
const DECLARATION_REGEX = /([a-zA-Z-]+)\s*:\s*([^;]+);?/g;

/*
 * Regex para detectar comentarios CSS
 */
const COMMENT_REGEX = /\/\*[\s\S]*?\*\//g;

/*
 * Clase principal del parser CSS
 */
export class CssParser {
    private _documento: vscode.TextDocument;
    private _textoSinComentarios: string;
    private _mapaOffsets: Map<number, number>;

    constructor(documento: vscode.TextDocument) {
        this._documento = documento;
        this._mapaOffsets = new Map();
        this._textoSinComentarios = this.eliminarComentarios(documento.getText());
    }

    /*
     * Parsea el documento completo y retorna resultados
     */
    public parsear(): ParseResult {
        const resultado: ParseResult = {
            variablesDefinidas: [],
            clasesDuplicadas: [],
            usosVariables: [],
            valoresHardcoded: [],
            errores: []
        };

        try {
            /* Parsear reglas CSS */
            const reglas = this.parsearReglas();

            /* Mapa para detectar duplicados de selectores de clase exactos */
            const clasesVistas = new Map<string, vscode.Range>();

            for (const regla of reglas) {
                /* Detectar clases duplicadas */
                const selectores = regla.selector.split(',').map(s => s.trim());
                for (const selector of selectores) {
                    /* Solo verificar selectores que son exactamente una clase (e.g. .mi-clase) */
                    if (/^\.[a-zA-Z0-9_-]+$/.test(selector)) {
                        const nombreClase = selector;

                        if (clasesVistas.has(nombreClase)) {
                            const rangoOriginal = clasesVistas.get(nombreClase)!;
                            resultado.clasesDuplicadas.push({
                                nombre: nombreClase,
                                rango: regla.rangoSelector,
                                linea: regla.rangoSelector.start.line,
                                columna: regla.rangoSelector.start.character
                            });
                        } else {
                            clasesVistas.set(nombreClase, regla.rangoSelector);
                        }
                    }
                }

                for (const declaracion of regla.declaraciones) {
                    /* Recolectar definiciones de variables */
                    if (declaracion.esDefinicionVariable) {
                        const nombreVar = obtenerNombreVariable(declaracion.propiedad);
                        if (nombreVar) {
                            resultado.variablesDefinidas.push({
                                nombre: nombreVar,
                                valor: declaracion.valor,
                                archivo: this._documento.uri.fsPath,
                                linea: declaracion.rangoPropiedad.start.line,
                                columna: declaracion.rangoPropiedad.start.character,
                                esColor: esColor(declaracion.valor),
                                frecuenciaUso: 0
                            });
                        }
                    }

                    /* Recolectar usos de variables */
                    resultado.usosVariables.push(...declaracion.variablesUsadas);

                    /* Verificar fallbacks hardcodeados */
                    for (const uso of declaracion.variablesUsadas) {
                        if (uso.fallback && esValorHardcodeado(uso.fallback)) {
                            resultado.valoresHardcoded.push({
                                propiedad: declaracion.propiedad,
                                valor: uso.fallback,
                                archivo: this._documento.uri.fsPath,
                                linea: uso.linea,
                                columna: uso.columna,
                                rango: uso.rango,
                                sugerencias: []
                            });
                        }
                    }
                }
            }

            /* Detectar valores hardcodeados en propiedades configuradas */
            const hardcoded = this.detectarHardcodeados(reglas);
            resultado.valoresHardcoded.push(...hardcoded);
        } catch (error) {
            resultado.errores.push({
                mensaje: `Error parseando CSS: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                linea: 0,
                columna: 0
            });
        }

        return resultado;
    }

    /*
     * Parsea solo las definiciones de variables del documento
     * Versión optimizada para escaneo inicial
     */
    public parsearSoloDefiniciones(): CssVariable[] {
        const variables: CssVariable[] = [];
        const texto = this._documento.getText();

        /* Regex optimizada para buscar solo definiciones de variables */
        const varDefRegex = /(--[\w-]+)\s*:\s*([^;{}]+);/g;
        let match: RegExpExecArray | null;

        while ((match = varDefRegex.exec(texto)) !== null) {
            const posicion = this._documento.positionAt(match.index);
            const valorLimpio = extraerValorLimpio(match[2]);

            variables.push({
                nombre: match[1],
                valor: valorLimpio,
                archivo: this._documento.uri.fsPath,
                linea: posicion.line,
                columna: posicion.character,
                esColor: esColor(valorLimpio),
                frecuenciaUso: 0
            });
        }

        return variables;
    }

    /*
     * Parsea las reglas CSS del documento
     */
    private parsearReglas(): CssRule[] {
        const reglas: CssRule[] = [];
        const texto = this._textoSinComentarios;
        let match: RegExpExecArray | null;

        RULE_REGEX.lastIndex = 0;

        while ((match = RULE_REGEX.exec(texto)) !== null) {
            const selector = match[1].trim();
            const contenido = match[2];
            const inicioSelector = this.obtenerOffsetOriginal(match.index);

            const regla: CssRule = {
                selector,
                rangoSelector: this.crearRangoDesdeOffset(inicioSelector, selector.length),
                declaraciones: this.parsearDeclaraciones(contenido, match.index + match[1].length + 1)
            };

            reglas.push(regla);
        }

        return reglas;
    }

    /*
     * Parsea las declaraciones dentro de un bloque CSS
     */
    private parsearDeclaraciones(contenido: string, offsetBase: number): CssDeclaration[] {
        const declaraciones: CssDeclaration[] = [];
        let match: RegExpExecArray | null;

        DECLARATION_REGEX.lastIndex = 0;

        while ((match = DECLARATION_REGEX.exec(contenido)) !== null) {
            const propiedad = match[1].trim();
            const valor = extraerValorLimpio(match[2]);
            const offsetPropiedad = this.obtenerOffsetOriginal(offsetBase + match.index);
            const offsetValor = offsetPropiedad + propiedad.length + match[0].indexOf(match[2]);

            /* Extraer variables usadas en el valor */
            const variablesMatch = extraerVariablesDeValor(valor);
            const posPropiedad = this._documento.positionAt(offsetPropiedad);

            const variablesUsadas = crearUsosVariable(variablesMatch, this._documento, posPropiedad.line, posPropiedad.character + propiedad.length + 2, valor);

            declaraciones.push({
                propiedad,
                valor,
                rangoPropiedad: this.crearRangoDesdeOffset(offsetPropiedad, propiedad.length),
                rangoValor: this.crearRangoDesdeOffset(offsetValor, valor.length),
                variablesUsadas,
                esDefinicionVariable: esDefinicionVariable(propiedad)
            });
        }

        return declaraciones;
    }

    /*
     * Detecta valores hardcodeados según la configuración
     */
    private detectarHardcodeados(reglas: CssRule[]): HardcodedValue[] {
        const hardcodeados: HardcodedValue[] = [];
        const configService = obtenerConfigService();

        for (const regla of reglas) {
            for (const declaracion of regla.declaraciones) {
                /* Saltar definiciones de variables */
                if (declaracion.esDefinicionVariable) {
                    continue;
                }

                /* Verificar si la propiedad debe ser chequeada */
                if (!configService.deberiVerificarPropiedad(declaracion.propiedad)) {
                    continue;
                }

                /* Verificar si el valor es permitido */
                if (configService.esValorPermitido(declaracion.valor)) {
                    continue;
                }

                /* Verificar si es hardcodeado */
                if (esValorHardcodeado(declaracion.valor)) {
                    hardcodeados.push({
                        propiedad: declaracion.propiedad,
                        valor: declaracion.valor,
                        archivo: this._documento.uri.fsPath,
                        linea: declaracion.rangoValor.start.line,
                        columna: declaracion.rangoValor.start.character,
                        rango: declaracion.rangoValor,
                        sugerencias: []
                    });
                }
            }
        }

        return hardcodeados;
    }

    /*
     * Elimina comentarios del CSS y construye mapa de offsets
     */
    private eliminarComentarios(texto: string): string {
        let resultado = '';
        let ultimoFin = 0;
        let match: RegExpExecArray | null;

        COMMENT_REGEX.lastIndex = 0;

        while ((match = COMMENT_REGEX.exec(texto)) !== null) {
            /* Agregar texto antes del comentario */
            resultado += texto.slice(ultimoFin, match.index);

            /* Reemplazar comentario con espacios para mantener posiciones */
            resultado += ' '.repeat(match[0].length);

            ultimoFin = match.index + match[0].length;
        }

        resultado += texto.slice(ultimoFin);

        return resultado;
    }

    /*
     * Obtiene el offset original (con comentarios) desde offset sin comentarios
     */
    private obtenerOffsetOriginal(offsetSinComentarios: number): number {
        /* En esta implementación simplificada, los offsets se mantienen
           porque reemplazamos comentarios con espacios */
        return offsetSinComentarios;
    }

    /*
     * Crea un Range de VS Code desde offset y longitud
     */
    private crearRangoDesdeOffset(offset: number, longitud: number): vscode.Range {
        const inicio = this._documento.positionAt(offset);
        const fin = this._documento.positionAt(offset + longitud);
        return new vscode.Range(inicio, fin);
    }
}

/*
 * Función helper para parsear un documento
 */
export function parsearDocumento(documento: vscode.TextDocument): ParseResult {
    const parser = new CssParser(documento);
    return parser.parsear();
}

/*
 * Función helper para parsear solo definiciones de variables
 */
export function parsearDefiniciones(documento: vscode.TextDocument): CssVariable[] {
    const parser = new CssParser(documento);
    return parser.parsearSoloDefiniciones();
}

/*
 * Busca todos los usos de var() en un documento
 */
export function buscarUsosVariables(documento: vscode.TextDocument): VariableUsage[] {
    const texto = documento.getText();
    const usos: VariableUsage[] = [];

    const varRegex = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = varRegex.exec(texto)) !== null) {
        const posicionInicio = documento.positionAt(match.index);
        const posicionFin = documento.positionAt(match.index + match[0].length);

        usos.push({
            nombreVariable: match[1],
            archivo: documento.uri.fsPath,
            linea: posicionInicio.line,
            columna: posicionInicio.character,
            rango: new vscode.Range(posicionInicio, posicionFin),
            fallback: match[2]?.trim()
        });
    }

    return usos;
}

/*
 * Encuentra la variable bajo el cursor en un documento
 */
export function encontrarVariableEnPosicion(documento: vscode.TextDocument, posicion: vscode.Position): {nombre: string; rango: vscode.Range} | null {
    const lineaTexto = documento.lineAt(posicion.line).text;

    /* Buscar var(--...) en la línea */
    const varRegex = /var\(\s*(--[\w-]+)\s*(?:,\s*[^)]+)?\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = varRegex.exec(lineaTexto)) !== null) {
        const inicio = match.index;
        const fin = inicio + match[0].length;

        /* Verificar si el cursor está dentro del match */
        if (posicion.character >= inicio && posicion.character <= fin) {
            /* Encontrar el rango exacto del nombre de la variable */
            const nombreInicio = lineaTexto.indexOf(match[1], inicio);
            const nombreFin = nombreInicio + match[1].length;

            return {
                nombre: match[1],
                rango: new vscode.Range(new vscode.Position(posicion.line, nombreInicio), new vscode.Position(posicion.line, nombreFin))
            };
        }
    }

    /* También buscar definiciones de variables: --nombre: */
    const defRegex = /(--[\w-]+)\s*:/g;
    while ((match = defRegex.exec(lineaTexto)) !== null) {
        const inicio = match.index;
        const fin = inicio + match[1].length;

        if (posicion.character >= inicio && posicion.character <= fin) {
            return {
                nombre: match[1],
                rango: new vscode.Range(new vscode.Position(posicion.line, inicio), new vscode.Position(posicion.line, fin))
            };
        }
    }

    return null;
}

/*
 * Obtiene la propiedad CSS en una posición del documento
 * Útil para autocompletado contextual
 */
export function obtenerPropiedadEnPosicion(documento: vscode.TextDocument, posicion: vscode.Position): string | null {
    const lineaTexto = documento.lineAt(posicion.line).text;

    /* Buscar propiedad: valor en la línea */
    const propRegex = /^\s*([a-zA-Z-]+)\s*:\s*/;
    const match = propRegex.exec(lineaTexto);

    if (match && posicion.character > lineaTexto.indexOf(':')) {
        return match[1];
    }

    return null;
}
