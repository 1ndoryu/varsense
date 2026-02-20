/* sentinel-disable-file limite-lineas — parsearColor es una función cohesiva que procesa
 * 10 formatos de color CSS secuencialmente. Dividirla fragmentaría un flujo lineal simple. */

/*
 * Detección y parsing de valores de color CSS.
 * Soporta: hex (3/4/6/8), rgb/rgba, hsl/hsla, colores nombrados.
 */

import { ColorInfo, ColorFormat } from '../types';
import { NAMED_COLORS, COLOR_PATTERNS } from './colorConstants';
import { hexARgb, rgbAHex, hslARgb } from './colorConversion';

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

    /* Color nombrado */
    if (valorLimpio in NAMED_COLORS) {
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

    /* RGB clásico */
    match = COLOR_PATTERNS.rgb.exec(valor);
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
        let a = 1;
        if (match[4]) {
            a = match[4].endsWith('%')
                ? parseFloat(match[4]) / 100
                : parseFloat(match[4]);
        }
        return {
            formato: a < 1 ? ColorFormat.Rgba : ColorFormat.Rgb,
            r, g, b, a,
            original: valor,
            hex: rgbAHex(r, g, b, a)
        };
    }

    /* HSL clásico */
    match = COLOR_PATTERNS.hsl.exec(valor);
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
        let a = 1;
        if (match[4]) {
            a = match[4].endsWith('%')
                ? parseFloat(match[4]) / 100
                : parseFloat(match[4]);
        }
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
