/*
 * Búsqueda y ordenación de variables CSS sobre un conjunto dado.
 * Funciones puras: el escáner les pasa sus variables; no conocen el caché ni vscode.
 */

import { CssVariable, ScoredVariable } from '@/types';

/* Puntuación de similitud para sugerencias: palabra coincidente, prefijo compartido */
const SIMILARITY_EXACT_SCORE = 10;
const SIMILARITY_PREFIX_SCORE = 5;
const SIMILARITY_PREFIX_LENGTH = 5;
const MIN_WORD_LENGTH = 2;
export const DEFAULT_SUGGESTION_LIMIT = 3;

/* Filtra las variables que cumplen el predicate, en el orden de entrada */
export function buscar(variables: Iterable<CssVariable>, predicate: (variable: CssVariable) => boolean): CssVariable[] {
    const resultados: CssVariable[] = [];
    for (const variable of variables) {
        if (predicate(variable)) {
            resultados.push(variable);
        }
    }
    return resultados;
}

/* Nombre que contiene el texto (sin distinguir mayúsculas) */
export function buscarPorNombre(variables: Iterable<CssVariable>, busqueda: string): CssVariable[] {
    const busquedaLower = busqueda.toLowerCase();
    return buscar(variables, variable => variable.nombre.toLowerCase().includes(busquedaLower));
}

/* Nombre que contiene al menos una de las palabras clave */
export function buscarPorPalabrasClave(variables: Iterable<CssVariable>, palabrasClave: string[]): CssVariable[] {
    const palabrasLower = palabrasClave.map(p => p.toLowerCase());
    return buscar(variables, variable => {
        const nombreLower = variable.nombre.toLowerCase();
        return palabrasLower.some(w => nombreLower.includes(w));
    });
}

/* Las `limite` variables más parecidas al nombre dado, de mayor a menor puntuación */
export function buscarSimilares(
    variables: Iterable<CssVariable>,
    nombreBuscado: string,
    limite: number = DEFAULT_SUGGESTION_LIMIT
): CssVariable[] {
    const nombreLower = nombreBuscado.toLowerCase();
    const palabras = nombreLower
        .replace('--', '')
        .split('-')
        .filter(p => p.length >= MIN_WORD_LENGTH);

    const resultados: ScoredVariable[] = [];
    for (const variable of variables) {
        const puntuacion = calcularPuntuacionSimilitud(variable, palabras, nombreLower);
        if (puntuacion > 0) {
            resultados.push({ variable, puntuacion });
        }
    }

    return resultados
        .sort((a, b) => b.puntuacion - a.puntuacion)
        .slice(0, limite)
        .map(r => r.variable);
}

/* Puntuación de una variable frente a las palabras buscadas y al prefijo del nombre */
function calcularPuntuacionSimilitud(variable: CssVariable, palabras: string[], nombreLower: string): number {
    const varNombre = variable.nombre.toLowerCase();
    let puntuacion = 0;

    const varPalabras = varNombre.replace('--', '').split('-');
    for (const palabra of palabras) {
        for (const varPalabra of varPalabras) {
            if (varPalabra.includes(palabra) || palabra.includes(varPalabra)) {
                puntuacion += SIMILARITY_EXACT_SCORE;
            }
        }
    }

    /* Bonus por compartir prefijo */
    if (varNombre.startsWith(nombreLower.substring(0, SIMILARITY_PREFIX_LENGTH))) {
        puntuacion += SIMILARITY_PREFIX_SCORE;
    }

    return puntuacion;
}

/* Variables de mayor a menor frecuencia de uso; no modifica la lista de entrada */
export function ordenarPorUso(variables: CssVariable[]): CssVariable[] {
    return [...variables].sort((a, b) => b.frecuenciaUso - a.frecuenciaUso);
}
