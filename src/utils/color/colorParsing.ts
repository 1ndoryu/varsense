
/*
 * Detección y parsing de valores de color CSS.
 * Soporta: hex (3/4/6/8), rgb/rgba, hsl/hsla, colores nombrados.
 * Hex en colorParsingHex.ts; funciones rgb/hsl en colorParsingFuncional.ts.
 */

import { ColorInfo, ColorFormat } from '@/types';
import { NAMED_COLORS, COLOR_PATTERNS } from './colorConstants';
import { hexARgb } from './colorConversion';
import { parsearHex } from './colorParsingHex';
import { parsearFuncional } from './colorParsingFuncional';

/* Determina si un valor CSS es un color */
export function esColor(valor: string): boolean {
    const valorLimpio = valor.trim().toLowerCase();

    /* Verificar colores nombrados */
    if (valorLimpio in NAMED_COLORS) {
        return true;
    }

    /* Verificar patrones de color */
    return Object.values(COLOR_PATTERNS).some(pattern => pattern.test(valorLimpio));
}

/* Parsea un valor de color CSS y retorna información detallada */
export function parsearColor(valor: string): ColorInfo | null {
    const valorLimpio = valor.trim().toLowerCase();

    if (valorLimpio in NAMED_COLORS) {
        return parsearNombrado(valor, valorLimpio);
    }
    return parsearHex(valor, valorLimpio) ?? parsearFuncional(valor);
}

/* "transparent" es el único nombrado sin componentes RGB: se fija a alpha 0. */
function parsearNombrado(valor: string, valorLimpio: string): ColorInfo {
    const hex = NAMED_COLORS[valorLimpio];
    if (hex === 'transparent') {
        return {
            formato: ColorFormat.Named,
            r: 0, g: 0, b: 0, a: 0,
            original: valor,
            hex: '#00000000'
        };
    }
    const rgb = hexARgb(hex);
    return {
        formato: ColorFormat.Named,
        ...rgb, a: 1,
        original: valor,
        hex: hex
    };
}
