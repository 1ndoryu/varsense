/*
 * Parser de archivos CSS
 * Analiza documentos CSS para extraer declaraciones, variables y usos
 */

import {CssVariable, CssDeclaration, CssRule, ParseResult, VariableUsage, HardcodedValue, BannedPropertyUsage} from '@/types';
import { CorePosition, CoreRange, CoreTextDocument, createCoreRange, positionAtOffset } from '@/core/types';
import {extraerVariablesDeValor, esDefinicionVariable, obtenerNombreVariable, esValorHardcodeado, extraerValorLimpio, crearUsosVariable} from './valueParser';
import {esColor} from '@/utils/colorUtils';

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

/* [085A-1] Opciones inyectables para que el parser no importe configService ni vscode.
 * Pendiente: los scanners recibiran providers de documentos/archivos en la siguiente fase. */
export interface CssParserOptions {
    debeVerificarPropiedad?: (propiedad: string) => boolean;
    esValorPermitido?: (valor: string) => boolean;
    propiedadesProhibidas?: {
        habilitado: boolean;
        propiedades: string[];
    };
}

/*
 * Clase principal del parser CSS
 */
export class CssParser {
    private _documento: CoreTextDocument;
    private _textoSinComentarios: string;
    private _opciones: CssParserOptions;

    constructor(documento: CoreTextDocument, opciones: CssParserOptions = {}) {
        this._documento = documento;
        this._textoSinComentarios = this.eliminarComentarios(documento.getText());
        this._opciones = opciones;
    }

    /*
     * Parsea el documento completo y retorna resultados
     */
    public parsear(): ParseResult {
        const resultado: ParseResult = {
            variablesDefinidas: [],
            usosVariables: [],
            valoresHardcoded: [],
            propiedadesProhibidas: [],
            errores: []
        };

        try {
            /* Parsear reglas CSS */
            const reglas = this.parsearReglas();

            for (const regla of reglas) {
                for (const declaracion of regla.declaraciones) {
                    /* Recolectar definiciones de variables */
                    if (declaracion.esDefinicionVariable) {
                        const nombreVar = obtenerNombreVariable(declaracion.propiedad);
                        if (nombreVar) {
                            resultado.variablesDefinidas.push({
                                nombre: nombreVar,
                                valor: declaracion.valor,
                                archivo: this._documento.fileName,
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
                                archivo: this._documento.fileName,
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

            /* Detectar propiedades prohibidas (ej: box-shadow) */
            const prohibidas = this.detectarPropiedadesProhibidas(reglas);
            resultado.propiedadesProhibidas.push(...prohibidas);
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
        /* [FIX-fantasma] Buscar definiciones sobre el texto sin comentarios
         * (offsets preservados por relleno con espacios): `.boton--primario:hover`
         * en prosa casa `--primario` + `:` y el valor se extendia hasta el `;`
         * siguiente fuera del comentario -> token-unused fantasma (caso TASKS
         * --primario en modalCreacionRapida.css:92 y accionesItem.css:29). */
        const texto = this._textoSinComentarios;
        const ambitos = mapearAmbitosBloques(texto);

        /* Regex optimizada para buscar solo definiciones de variables */
        const varDefRegex = /(--[\w-]+)\s*:\s*([^;{}]+);/g;
        let match: RegExpExecArray | null;

        while ((match = varDefRegex.exec(texto)) !== null) {
            const posicion = positionAtOffset(this._documento, match.index);
            const valorLimpio = extraerValorLimpio(match[2]);

            variables.push({
                nombre: match[1],
                valor: valorLimpio,
                archivo: this._documento.fileName,
                linea: posicion.line,
                columna: posicion.character,
                esColor: esColor(valorLimpio),
                frecuenciaUso: 0,
                /* [229A-1] Ambito de cascada: dos definiciones con el mismo
                 * valor en ambitos distintos son shadowing intencional. */
                ambito: buscarAmbitoInnermost(ambitos, match.index)
            });
        }

        return variables;
    }

    /*
     * [318A-7V24] Parsea definiciones de variables en runtime: llamadas
     * `algo.setProperty('--x', valor)` en TS/JS. El primer argumento literal
     * '--x' define la variable aunque ningún CSS la declare (patrón habitual
     * en GH: panelDerechoAncho.ts, panelEntrada.ts, barraLateral.ts...).
     * Solo literales quoted (incluye backtick sin interpolación: el nombre
     * queda cerrado por el backtick antes de cualquier ${...}); si el nombre
     * es dinámico no se puede indexar y se ignora. El valor runtime es
     * desconocido: se registra como '' (no color) para que la definición
     * exista en el índice.
     */
    public parsearDefinicionesRuntime(): CssVariable[] {
        const variables: CssVariable[] = [];
        /* [FIX-fantasma] Igual que en parsearSoloDefiniciones: un
         * `.setProperty('--x', ...)` mencionado en un comentario de bloque no
         * define nada (caso --fantasma). No se tocan comentarios de linea `//`
         * (riesgo con `https://` en strings): limitacion documentada. */
        const texto = this._textoSinComentarios;
        const runtimeDefRegex = /\.setProperty\s*\(\s*(['"`])--([\w-]+)\1/g;
        let match: RegExpExecArray | null;

        while ((match = runtimeDefRegex.exec(texto)) !== null) {
            const posicion = positionAtOffset(this._documento, match.index);
            variables.push({
                nombre: `--${match[2]}`,
                valor: '',
                archivo: this._documento.fileName,
                linea: posicion.line,
                columna: posicion.character,
                esColor: false,
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
            const offsetPropiedad = this.obtenerOffsetOriginal(offsetBase + match.index);
            const valorRaw = match[2];
            const indiceValorEnMatch = match[0].indexOf(valorRaw);
            const espaciosInicioValor = valorRaw.search(/\S|$/);
            const valor = extraerValorLimpio(valorRaw);

            /* Offset real del inicio del valor dentro del documento */
            const offsetValor = offsetBase + match.index + indiceValorEnMatch + espaciosInicioValor;
            const posPropiedad = positionAtOffset(this._documento, offsetPropiedad);
            let rangoValor = this.crearRangoDesdeOffset(offsetValor, valor.length);

            /*
             * Corrección de precisión: si el valor no es multilínea, forzar el rango
             * a la misma línea de la propiedad para evitar subrayado desplazado.
             */
            if (!valor.includes('\n') && rangoValor.start.line !== posPropiedad.line) {
                const textoLinea = this._documento.lineAt(posPropiedad.line).text;
                const desdeColumna = Math.max(0, posPropiedad.character + propiedad.length);
                const indiceEnLinea = textoLinea.indexOf(valor, desdeColumna);

                if (indiceEnLinea >= 0) {
                    rangoValor = createCoreRange(
                        posPropiedad.line,
                        indiceEnLinea,
                        posPropiedad.line,
                        indiceEnLinea + valor.length
                    );
                }
            }

            /* Extraer variables usadas en el valor */
            const variablesMatch = extraerVariablesDeValor(valor);
            const posValor = positionAtOffset(this._documento, offsetValor);

            const variablesUsadas = crearUsosVariable(variablesMatch, this._documento, posValor.line, posValor.character, valor);

            declaraciones.push({
                propiedad,
                valor,
                rangoPropiedad: this.crearRangoDesdeOffset(offsetPropiedad, propiedad.length),
                rangoValor,
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

        if (!this._opciones.debeVerificarPropiedad || !this._opciones.esValorPermitido) {
            return hardcodeados;
        }

        for (const regla of reglas) {
            for (const declaracion of regla.declaraciones) {
                /* Saltar definiciones de variables */
                if (declaracion.esDefinicionVariable) {
                    continue;
                }

                /* Verificar si la propiedad debe ser chequeada */
                if (!this._opciones.debeVerificarPropiedad(declaracion.propiedad)) {
                    continue;
                }

                /* Verificar si el valor es permitido */
                if (this._opciones.esValorPermitido(declaracion.valor)) {
                    continue;
                }

                /* Verificar si es hardcodeado */
                if (esValorHardcodeado(declaracion.valor)) {
                    hardcodeados.push({
                        propiedad: declaracion.propiedad,
                        valor: declaracion.valor,
                        archivo: this._documento.fileName,
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
     * Detecta propiedades CSS prohibidas según la configuración
     * Ejemplo: box-shadow está prohibido en proyectos que no usan sombras
     */
    private detectarPropiedadesProhibidas(reglas: CssRule[]): BannedPropertyUsage[] {
        const detectadas: BannedPropertyUsage[] = [];
        const configProhibidas = this._opciones.propiedadesProhibidas;

        if (!configProhibidas?.habilitado || configProhibidas.propiedades.length === 0) {
            return detectadas;
        }

        const propiedadesSet = new Set(configProhibidas.propiedades.map(p => p.toLowerCase()));

        for (const regla of reglas) {
            for (const declaracion of regla.declaraciones) {
                if (declaracion.esDefinicionVariable) {
                    continue;
                }

                if (propiedadesSet.has(declaracion.propiedad.toLowerCase())) {
                    detectadas.push({
                        propiedad: declaracion.propiedad,
                        valor: declaracion.valor,
                        archivo: this._documento.fileName,
                        linea: declaracion.rangoPropiedad.start.line,
                        columna: declaracion.rangoPropiedad.start.character,
                        rango: {
                            start: declaracion.rangoPropiedad.start,
                            end: declaracion.rangoValor.end
                        }
                    });
                }
            }
        }

        return detectadas;
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
     * Crea un CoreRange desde offset y longitud
     */
    private crearRangoDesdeOffset(offset: number, longitud: number): CoreRange {
        const inicio = positionAtOffset(this._documento, offset);
        const fin = positionAtOffset(this._documento, offset + longitud);
        return { start: inicio, end: fin };
    }
}

/*
 * Función helper para parsear un documento
 */
export function parsearDocumento(documento: CoreTextDocument, opciones: CssParserOptions = {}): ParseResult {
    const parser = new CssParser(documento, opciones);
    return parser.parsear();
}

/*
 * Función helper para parsear solo definiciones de variables
 */
export function parsearDefiniciones(documento: CoreTextDocument): CssVariable[] {
    const parser = new CssParser(documento);
    return parser.parsearSoloDefiniciones();
}

/*
 * [229A-1] Pre-escaneo de ambitos: por cada `{` registra el selector del
 * bloque que abre (texto desde el ultimo `;`, `{` o `}`), ignorando
 * comentarios y literales. `buscarAmbitoInnermost` resuelve el bloque mas
 * interno que contiene un offset con busqueda binaria. El mismo token con
 * el mismo valor en ambitos distintos es shadowing de cascada, no
 * duplicado; el mismo selector repetido conserva su texto y sigue
 * agrupando igual que antes.
 */
interface EntradaAmbito {
    apertura: number;
    cierre: number;
    ambito: string;
}

function mapearAmbitosBloques(texto: string): EntradaAmbito[] {
    const ambitos: EntradaAmbito[] = [];
    const pila: Array<{ apertura: number; ambito: string }> = [];
    let inicioSelector = 0;
    let i = 0;

    const saltarLiteral = (comilla: string): void => {
        i++;
        while (i < texto.length) {
            if (texto[i] === '\\') {
                i += 2;
                continue;
            }
            if (texto[i] === comilla) {
                i++;
                return;
            }
            i++;
        }
    };

    while (i < texto.length) {
        const actual = texto[i];
        const siguiente = i + 1 < texto.length ? texto[i + 1] : '';

        if (actual === '/' && siguiente === '*') {
            const fin = texto.indexOf('*/', i + 2);
            i = fin < 0 ? texto.length : fin + 2;
            inicioSelector = i;
            continue;
        }

        if (actual === '"' || actual === "'") {
            saltarLiteral(actual);
            continue;
        }

        if (actual === '{') {
            const selector = texto.slice(inicioSelector, i).trim().replace(/\s+/g, ' ');
            pila.push({ apertura: i, ambito: selector });
            inicioSelector = i + 1;
            i++;
            continue;
        }

        if (actual === '}') {
            const abierto = pila.pop();
            if (abierto !== undefined) {
                ambitos.push({ apertura: abierto.apertura, cierre: i, ambito: abierto.ambito });
            }
            inicioSelector = i + 1;
            i++;
            continue;
        }

        if (actual === ';' && pila.length === 0) {
            inicioSelector = i + 1;
        }
        i++;
    }

    ambitos.sort((a, b) => a.apertura - b.apertura);
    return ambitos;
}

function buscarAmbitoInnermost(ambitos: EntradaAmbito[], offset: number): string | undefined {
    /* Ultimo bloque con apertura <= offset: el mas interno posible. */
    let izquierda = 0;
    let derecha = ambitos.length - 1;
    let posicion = -1;

    while (izquierda <= derecha) {
        const medio = (izquierda + derecha) >> 1;
        if (ambitos[medio].apertura <= offset) {
            posicion = medio;
            izquierda = medio + 1;
        } else {
            derecha = medio - 1;
        }
    }

    /* Retroceder hasta el primero que realmente contenga el offset. */
    while (posicion >= 0) {
        const candidato = ambitos[posicion];
        if (offset <= candidato.cierre) {
            return candidato.ambito;
        }
        posicion--;
    }

    return undefined;
}

/*
 * [318A-7V24] Función helper para parsear definiciones de variables en
 * runtime (setProperty) de un documento script.
 */
export function parsearDefinicionesRuntime(documento: CoreTextDocument): CssVariable[] {
    const parser = new CssParser(documento);
    return parser.parsearDefinicionesRuntime();
}

/*
 * Busca todos los usos de var() en un documento
 */
export function buscarUsosVariables(documento: CoreTextDocument): VariableUsage[] {
    const texto = documento.getText();
    const usos: VariableUsage[] = [];

    const varRegex = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = varRegex.exec(texto)) !== null) {
        const posicionInicio = positionAtOffset(documento, match.index);
        const posicionFin = positionAtOffset(documento, match.index + match[0].length);

        usos.push({
            nombreVariable: match[1],
            archivo: documento.fileName,
            linea: posicionInicio.line,
            columna: posicionInicio.character,
            rango: { start: posicionInicio, end: posicionFin },
            fallback: match[2]?.trim()
        });
    }

    return usos;
}

/*
 * Encuentra la variable bajo el cursor en un documento
 */
export function encontrarVariableEnPosicion(documento: CoreTextDocument, posicion: CorePosition): {nombre: string; rango: CoreRange} | null {
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
                rango: createCoreRange(posicion.line, nombreInicio, posicion.line, nombreFin)
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
                rango: createCoreRange(posicion.line, inicio, posicion.line, fin)
            };
        }
    }

    return null;
}

/*
 * Obtiene la propiedad CSS en una posición del documento
 * Útil para autocompletado contextual
 */
export function obtenerPropiedadEnPosicion(documento: CoreTextDocument, posicion: CorePosition): string | null {
    const lineaTexto = documento.lineAt(posicion.line).text;

    /* Buscar propiedad: valor en la línea */
    const propRegex = /^\s*([a-zA-Z-]+)\s*:\s*/;
    const match = propRegex.exec(lineaTexto);

    if (match && posicion.character > lineaTexto.indexOf(':')) {
        return match[1];
    }

    return null;
}
