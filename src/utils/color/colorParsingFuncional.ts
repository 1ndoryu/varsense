/*
 * Parsing de colores funcionales: rgb/rgba y hsl/hsla, en su forma clásica y moderna.
 */

import { ColorInfo, ColorFormat } from '@/types';
import { COLOR_PATTERNS } from './colorConstants';
import { rgbAHex, hslARgb } from './colorConversion';

/* Devuelve null si el valor no es rgb/hsl. Se usa el valor original (no en minúsculas): los patrones son /i. */
export function parsearFuncional(valor: string): ColorInfo | null {
    return parsearRgb(valor) ?? parsearHsl(valor);
}

function parsearRgb(valor: string): ColorInfo | null {
    /* RGB clásico */
    let match = COLOR_PATTERNS.rgb.exec(valor);
    if (match) {
        const r = parseInt(match[1], 10);
        const g = parseInt(match[2], 10);
        const b = parseInt(match[3], 10);
        return {
            formato: ColorFormat.Rgb,
            r, g, b, a: 1,
            original: valor,
            hex: rgbAHex(r, g, b)
        };
    }

    /* RGBA */
    match = COLOR_PATTERNS.rgba.exec(valor);
    if (match) {
        const r = parseInt(match[1], 10);
        const g = parseInt(match[2], 10);
        const b = parseInt(match[3], 10);
        const a = parseFloat(match[4]);
        return {
            formato: ColorFormat.Rgba,
            r, g, b, a,
            original: valor,
            hex: rgbAHex(r, g, b, a)
        };
    }

    /* RGB moderno (espacios, opcional alpha con /) */
    match = COLOR_PATTERNS.rgbModern.exec(valor);
    if (match) {
        const r = parseInt(match[1], 10);
        const g = parseInt(match[2], 10);
        const b = parseInt(match[3], 10);
        const a = alphaModerno(match[4]);
        return {
            formato: a < 1 ? ColorFormat.Rgba : ColorFormat.Rgb,
            r, g, b, a,
            original: valor,
            hex: rgbAHex(r, g, b, a)
        };
    }

    return null;
}

function parsearHsl(valor: string): ColorInfo | null {
    /* HSL clásico */
    let match = COLOR_PATTERNS.hsl.exec(valor);
    if (match) {
        const h = parseInt(match[1], 10);
        const s = parseInt(match[2], 10);
        const l = parseInt(match[3], 10);
        const rgb = hslARgb(h, s, l);
        return {
            formato: ColorFormat.Hsl,
            ...rgb, a: 1,
            original: valor,
            hex: rgbAHex(rgb.r, rgb.g, rgb.b)
        };
    }

    /* HSLA */
    match = COLOR_PATTERNS.hsla.exec(valor);
    if (match) {
        const h = parseInt(match[1], 10);
        const s = parseInt(match[2], 10);
        const l = parseInt(match[3], 10);
        const a = parseFloat(match[4]);
        const rgb = hslARgb(h, s, l);
        return {
            formato: ColorFormat.Hsla,
            ...rgb, a,
            original: valor,
            hex: rgbAHex(rgb.r, rgb.g, rgb.b, a)
        };
    }

    /* HSL moderno */
    match = COLOR_PATTERNS.hslModern.exec(valor);
    if (match) {
        const h = parseInt(match[1], 10);
        const s = parseInt(match[2], 10);
        const l = parseInt(match[3], 10);
        const a = alphaModerno(match[4]);
        const rgb = hslARgb(h, s, l);
        return {
            formato: a < 1 ? ColorFormat.Hsla : ColorFormat.Hsl,
            ...rgb, a,
            original: valor,
            hex: rgbAHex(rgb.r, rgb.g, rgb.b, a)
        };
    }

    return null;
}

/* Alpha de la sintaxis moderna: "50%" o "0.5"; sin valor, opaco. */
function alphaModerno(texto: string | undefined): number {
    if (!texto) {
        return 1;
    }
    return texto.endsWith('%') ? parseFloat(texto) / 100 : parseFloat(texto);
}
