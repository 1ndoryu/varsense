/*
 * Resolvedor de variables CSS
 * Resuelve valores de variables, incluyendo referencias a otras variables
 */

import { CssVariable, ResolvedVariable } from '../types';
import { obtenerScanner, obtenerVariable } from './variableScanner';
import { extraerVariablesDeValor } from '../parsers/valueParser';
import { esColor, parsearColor } from '../utils/colorUtils';

/*
 * Límite máximo de resolución recursiva para evitar bucles infinitos
 */
const MAX_RESOLUCION_PROFUNDIDAD = 10;

/* [124A-AUDIT1] Límite de caché para evitar crecimiento ilimitado en sesiones largas */
const MAX_CACHE_ENTRIES = 200;

/*
 * Clase para resolver variables CSS
 */
export class VariableResolver {
    private static _instancia: VariableResolver;
    private _cacheResolucion: Map<string, ResolvedVariable>;
    
    private constructor() {
        this._cacheResolucion = new Map();
        
        /* Limpiar caché cuando cambien las variables */
        obtenerScanner().onVariablesChange(() => {
            this._cacheResolucion.clear();
        });
    }
    
    /*
     * Obtiene la instancia singleton
     */
    public static obtenerInstancia(): VariableResolver {
        if (!VariableResolver._instancia) {
            VariableResolver._instancia = new VariableResolver();
        }
        return VariableResolver._instancia;
    }
    
    /*
     * Resuelve una variable CSS por nombre
     * Sigue referencias a otras variables hasta obtener el valor final
     */
    public resolver(nombreVariable: string): ResolvedVariable {
        /* Verificar caché */
        const cached = this._cacheResolucion.get(nombreVariable);
        if (cached) {
            return cached;
        }
        
        const resultado = this.resolverRecursivo(nombreVariable, [], 0);
        
        /* [124A-AUDIT1] Evicción LRU simple: borrar entrada más antigua si excede límite */
        if (this._cacheResolucion.size >= MAX_CACHE_ENTRIES) {
            const primeraKey = this._cacheResolucion.keys().next().value;
            if (primeraKey) {
                this._cacheResolucion.delete(primeraKey);
            }
        }
        
        /* Cachear resultado */
        this._cacheResolucion.set(nombreVariable, resultado);
        
        return resultado;
    }
    
    /*
     * Resolución recursiva de variables
     */
    private resolverRecursivo(
        nombreVariable: string,
        cadena: string[],
        profundidad: number
    ): ResolvedVariable {
        /* Verificar límite de profundidad */
        if (profundidad >= MAX_RESOLUCION_PROFUNDIDAD) {
            return {
                encontrada: false,
                cadenaResolucion: cadena
            };
        }
        
        /* Verificar referencias circulares */
        if (cadena.includes(nombreVariable)) {
            console.warn(`[CSS Vars Validator] Referencia circular detectada: ${cadena.join(' -> ')} -> ${nombreVariable}`);
            return {
                encontrada: false,
                cadenaResolucion: cadena
            };
        }
        
        /* Buscar la variable */
        const variable = obtenerVariable(nombreVariable);
        if (!variable) {
            return {
                encontrada: false,
                cadenaResolucion: [...cadena, nombreVariable]
            };
        }
        
        /* Verificar si el valor contiene otras variables */
        const variablesEnValor = extraerVariablesDeValor(variable.valor);
        
        if (variablesEnValor.length === 0) {
            /* Valor final sin referencias */
            return {
                encontrada: true,
                variable: {
                    ...variable,
                    valorResuelto: variable.valor
                },
                cadenaResolucion: [...cadena, nombreVariable]
            };
        }
        
        /* Resolver variable referenciada */
        /* Por simplicidad, solo resolvemos la primera variable encontrada */
        const primeraVar = variablesEnValor[0];
        const resultadoAnidado = this.resolverRecursivo(
            primeraVar.nombreVariable,
            [...cadena, nombreVariable],
            profundidad + 1
        );
        
        if (resultadoAnidado.encontrada && resultadoAnidado.variable) {
            /* Construir valor resuelto reemplazando la variable */
            const valorResuelto = variable.valor.replace(
                `var(${primeraVar.nombreVariable})`,
                resultadoAnidado.variable.valorResuelto || resultadoAnidado.variable.valor
            );
            
            return {
                encontrada: true,
                variable: {
                    ...variable,
                    valorResuelto,
                    esColor: esColor(valorResuelto)
                },
                cadenaResolucion: resultadoAnidado.cadenaResolucion
            };
        }
        
        /* No se pudo resolver completamente, devolver valor parcial */
        return {
            encontrada: true,
            variable: {
                ...variable,
                valorResuelto: variable.valor
            },
            cadenaResolucion: resultadoAnidado.cadenaResolucion
        };
    }
    
    /*
     * Obtiene el valor final resuelto de una variable
     */
    public obtenerValorResuelto(nombreVariable: string): string | null {
        const resultado = this.resolver(nombreVariable);
        
        if (resultado.encontrada && resultado.variable) {
            return resultado.variable.valorResuelto || resultado.variable.valor;
        }
        
        return null;
    }
    
    /*
     * Verifica si una variable existe y está correctamente definida
     */
    public variableEsValida(nombreVariable: string): boolean {
        const resultado = this.resolver(nombreVariable);
        return resultado.encontrada;
    }
    
    /*
     * Obtiene información de color de una variable si aplica
     */
    public obtenerInfoColor(nombreVariable: string): ReturnType<typeof parsearColor> {
        const valorResuelto = this.obtenerValorResuelto(nombreVariable);
        
        if (valorResuelto && esColor(valorResuelto)) {
            return parsearColor(valorResuelto);
        }
        
        return null;
    }
    
    /*
     * Obtiene la cadena de resolución de una variable
     * Útil para debugging y mostrar en hover
     */
    public obtenerCadenaResolucion(nombreVariable: string): string[] {
        const resultado = this.resolver(nombreVariable);
        return resultado.cadenaResolucion || [nombreVariable];
    }
    
    /*
     * Genera un markdown descriptivo de la resolución
     */
    public generarDescripcionResolucion(nombreVariable: string): string {
        const resultado = this.resolver(nombreVariable);
        
        if (!resultado.encontrada) {
            return `❌ Variable \`${nombreVariable}\` no encontrada`;
        }
        
        const variable = resultado.variable!;
        const lineas: string[] = [];
        
        /* Nombre y valor */
        lineas.push(`**${variable.nombre}**`);
        lineas.push('');
        
        /* Valor original */
        lineas.push(`📄 **Valor:** \`${variable.valor}\``);
        
        /* Valor resuelto si es diferente */
        if (variable.valorResuelto && variable.valorResuelto !== variable.valor) {
            lineas.push(`🔗 **Resuelto:** \`${variable.valorResuelto}\``);
        }
        
        /* Cadena de resolución si hay múltiples pasos */
        if (resultado.cadenaResolucion && resultado.cadenaResolucion.length > 1) {
            lineas.push('');
            lineas.push(`🔄 **Cadena:** ${resultado.cadenaResolucion.join(' → ')}`);
        }
        
        /* Ubicación */
        lineas.push('');
        lineas.push(`📍 **Archivo:** ${variable.archivo}`);
        lineas.push(`📍 **Línea:** ${variable.linea + 1}`);
        
        return lineas.join('\n');
    }
    
    /*
     * Busca sugerencias de variables para un valor dado
     * Útil para quick fixes de valores hardcodeados
     */
    public sugerirVariablesParaValor(valor: string, limite: number = 5): CssVariable[] {
        const valorLower = valor.toLowerCase().trim();
        const sugerencias: Array<{ variable: CssVariable; puntuacion: number }> = [];
        
        const scanner = obtenerScanner();
        const todasVariables = scanner.obtenerTodasVariables();
        
        for (const variable of todasVariables) {
            const valorResuelto = this.obtenerValorResuelto(variable.nombre);
            if (!valorResuelto) {
                continue;
            }
            
            const valorResueltoLower = valorResuelto.toLowerCase().trim();
            
            /* Coincidencia exacta */
            if (valorResueltoLower === valorLower) {
                sugerencias.push({ variable, puntuacion: 100 });
                continue;
            }
            
            /* Coincidencia parcial para colores */
            if (esColor(valor) && variable.esColor) {
                const colorOriginal = parsearColor(valor);
                const colorVariable = parsearColor(valorResuelto);
                
                if (colorOriginal && colorVariable) {
                    /* Calcular similitud de color */
                    const distancia = Math.sqrt(
                        Math.pow(colorOriginal.r - colorVariable.r, 2) +
                        Math.pow(colorOriginal.g - colorVariable.g, 2) +
                        Math.pow(colorOriginal.b - colorVariable.b, 2)
                    );
                    
                    /* Normalizar a puntuación (0-50) */
                    const puntuacion = Math.max(0, 50 - distancia / 5);
                    if (puntuacion > 10) {
                        sugerencias.push({ variable, puntuacion });
                    }
                }
            }
        }
        
        /* Ordenar por puntuación y frecuencia de uso */
        return sugerencias
            .sort((a, b) => {
                const puntDiff = b.puntuacion - a.puntuacion;
                if (Math.abs(puntDiff) > 5) {
                    return puntDiff;
                }
                return b.variable.frecuenciaUso - a.variable.frecuenciaUso;
            })
            .slice(0, limite)
            .map(s => s.variable);
    }
    
    /*
     * Limpia el caché de resolución
     */
    public limpiarCache(): void {
        this._cacheResolucion.clear();
    }
}

/*
 * Funciones helper exportadas
 */
export function obtenerResolver(): VariableResolver {
    return VariableResolver.obtenerInstancia();
}

export function resolverVariable(nombre: string): ResolvedVariable {
    return VariableResolver.obtenerInstancia().resolver(nombre);
}

export function obtenerValorResuelto(nombre: string): string | null {
    return VariableResolver.obtenerInstancia().obtenerValorResuelto(nombre);
}

export function variableEsValida(nombre: string): boolean {
    return VariableResolver.obtenerInstancia().variableEsValida(nombre);
}
