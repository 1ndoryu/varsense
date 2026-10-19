/*
 * Parsing de colores hexadecimales (#rgb, #rgba, #rrggbb, #rrggbbaa).
 */

import { ColorInfo, ColorFormat } from '@/types';
import { COLOR_PATTERNS } from './colorConstants';
import { hexARgb, rgbAHex } from './colorConversion';

/* Devuelve null si el valor no es un hex válido. `valorLimpio` va en minúsculas. */
export function parsearHex(valor: string, valorLimpio: string): ColorInfo | null {
    /* Hex de 3 dígitos */
    let match = COLOR_PATTERNS.hex3.exec(valorLimpio);
    if (match) {
        const [r, g, b] = match[1].split('').map(c => parseInt(c + c, 16));
        return {
            formato: ColorFormat.Hex,
            r, g, b, a: 1,
            original: valor,
            hex: rgbAHex(r, g, b)
        };
    }

    /* Hex de 4 dígitos (con alpha) */
    match = COLOR_PATTERNS.hex4.exec(valorLimpio);
    if (match) {
        const chars = match[1].split('');
        const [r, g, b, a] = chars.map(c => parseInt(c + c, 16));
        return {
            formato: ColorFormat.Hex,
            r, g, b, a: a / 255,
            original: valor,
            hex: rgbAHex(r, g, b, a / 255)
        };
    }

    /* Hex de 6 dígitos */
    match = COLOR_PATTERNS.hex6.exec(valorLimpio);
    if (match) {
        const rgb = hexARgb('#' + match[1]);
        return {
            formato: ColorFormat.Hex,
            ...rgb, a: 1,
            original: valor,
            hex: '#' + match[1]
        };
    }

    /* Hex de 8 dígitos (con alpha) */
    match = COLOR_PATTERNS.hex8.exec(valorLimpio);
    if (match) {
        const hex = match[1];
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = parseInt(hex.slice(6, 8), 16) / 255;
        return {
            formato: ColorFormat.Hex,
            r, g, b, a,
            original: valor,
            hex: '#' + hex
        };
    }

    return null;
}
