/*
 * Detección de valores hardcodeados y propiedades prohibidas en reglas CSS
 * Usada por CssParser; las opciones llegan como argumento, sin estado propio
 */

import {CssDeclaration, CssRule, HardcodedValue, BannedPropertyUsage} from '@/types';
import {CoreTextDocument} from '@/core/types';
import {esValorHardcodeado} from './valueParser';
import type {OpcionesParserCss} from '@/core/puertoParsers';

/*
 * [15A-25] Verifica fallbacks hardcodeados de un var() con los MISMOS dos
 * filtros que una declaracion directa (ver detectarHardcodeados): la puerta de
 * propiedad y la lista de valores permitidos. Antes iba a pelo, y por eso el
 * mismo valor salia exento en `color: transparent` y reportado en
 * `border-top: 3px solid var(--colorInsert, transparent)`, y `height: 120px`
 * (layout, fuera de `properties`) se colaba solo cuando venia como respaldo de
 * un var(). En KAMPLES eran 17 hallazgos, todos de esta forma y ninguno
 * accionable: el remedio que la regla prescribe —usar una variable— ya esta
 * aplicado en la propia declaracion.
 */
export function detectarFallbacksHardcodeados(
    documento: CoreTextDocument,
    opciones: OpcionesParserCss,
    declaracion: CssDeclaration,
    destino: HardcodedValue[]
): void {
    /* Escribe en `destino` hallazgo a hallazgo: si un filtro lanza, lo ya añadido se conserva */
    if (!(opciones.debeVerificarPropiedad?.(declaracion.propiedad) ?? true)) {
        return;
    }
    for (const uso of declaracion.variablesUsadas) {
        if (!uso.fallback) {
            continue;
        }
        if (opciones.esValorPermitido?.(uso.fallback)) {
            continue;
        }
        if (esValorHardcodeado(uso.fallback)) {
            destino.push({
                propiedad: declaracion.propiedad,
                valor: uso.fallback,
                archivo: documento.fileName,
                linea: uso.linea,
                columna: uso.columna,
                rango: uso.rango,
                sugerencias: []
            });
        }
    }
}

/*
 * Detecta valores hardcodeados según la configuración
 */
export function detectarHardcodeados(documento: CoreTextDocument, opciones: OpcionesParserCss, reglas: CssRule[]): HardcodedValue[] {
    const hardcodeados: HardcodedValue[] = [];

    if (!opciones.debeVerificarPropiedad || !opciones.esValorPermitido) {
        return hardcodeados;
    }

    for (const regla of reglas) {
        for (const declaracion of regla.declaraciones) {
            /* Saltar definiciones de variables */
            if (declaracion.esDefinicionVariable) {
                continue;
            }

            /* Verificar si la propiedad debe ser chequeada */
            if (!opciones.debeVerificarPropiedad(declaracion.propiedad)) {
                continue;
            }

            /* Verificar si el valor es permitido */
            if (opciones.esValorPermitido(declaracion.valor)) {
                continue;
            }

            /* Verificar si es hardcodeado */
            if (esValorHardcodeado(declaracion.valor)) {
                hardcodeados.push({
                    propiedad: declaracion.propiedad,
                    valor: declaracion.valor,
                    archivo: documento.fileName,
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
export function detectarPropiedadesProhibidas(documento: CoreTextDocument, opciones: OpcionesParserCss, reglas: CssRule[]): BannedPropertyUsage[] {
    const detectadas: BannedPropertyUsage[] = [];
    const configProhibidas = opciones.propiedadesProhibidas;

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
                    archivo: documento.fileName,
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
