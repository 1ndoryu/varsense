/*
 * Parser de archivos CSS
 * Analiza documentos CSS para extraer declaraciones, variables y usos
 * La lógica vive en reglasYDeclaracionesCss, deteccionValoresCss y definicionesVariablesCss
 */

import {CssVariable, ParseResult} from '@/types';
import {CoreTextDocument} from '@/core/types';
import {obtenerNombreVariable} from './valueParser';
import {esColor} from '@/utils/color/colorUtils';
import type {OpcionesParserCss} from '@/core/puertoParsers';
import {eliminarComentarios, parsearReglas} from './reglasYDeclaracionesCss';
import {detectarFallbacksHardcodeados, detectarHardcodeados, detectarPropiedadesProhibidas} from './deteccionValoresCss';
import {parsearSoloDefinicionesCss, parsearDefinicionesRuntimeCss} from './definicionesVariablesCss';

/* [085A-1] Opciones inyectables para que el parser no importe configService ni vscode.
 * La forma vive en el puerto del core: el adapter la implementa, no la define. */
export type CssParserOptions = OpcionesParserCss;

/*
 * Clase principal del parser CSS
 */
export class CssParser {
    private _documento: CoreTextDocument;
    private _textoSinComentarios: string;
    private _opciones: CssParserOptions;

    constructor(documento: CoreTextDocument, opciones: CssParserOptions = {}) {
        this._documento = documento;
        this._textoSinComentarios = eliminarComentarios(documento.getText());
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
            const reglas = parsearReglas(this._documento, this._textoSinComentarios);

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

                    /* Fallbacks hardcodeados de var(): mismos filtros que una declaración directa */
                    detectarFallbacksHardcodeados(this._documento, this._opciones, declaracion, resultado.valoresHardcoded);
                }
            }

            /* Detectar valores hardcodeados en propiedades configuradas */
            const hardcoded = detectarHardcodeados(this._documento, this._opciones, reglas);
            resultado.valoresHardcoded.push(...hardcoded);

            /* Detectar propiedades prohibidas (ej: box-shadow) */
            const prohibidas = detectarPropiedadesProhibidas(this._documento, this._opciones, reglas);
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
        return parsearSoloDefinicionesCss(this._documento, this._textoSinComentarios);
    }

    /*
     * [318A-7V24] Parsea definiciones de variables en runtime (setProperty y
     * style JSX); la lógica está en definicionesVariablesCss
     */
    public parsearDefinicionesRuntime(): CssVariable[] {
        return parsearDefinicionesRuntimeCss(this._documento, this._textoSinComentarios);
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
 * [318A-7V24] Función helper para parsear definiciones de variables en
 * runtime (setProperty) de un documento script.
 */
export function parsearDefinicionesRuntime(documento: CoreTextDocument): CssVariable[] {
    const parser = new CssParser(documento);
    return parser.parsearDefinicionesRuntime();
}
