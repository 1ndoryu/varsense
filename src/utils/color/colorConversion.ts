/*
 * Funciones de conversión entre formatos de color (hex, rgb, hsl).
 * Funciones puras sin dependencias externas.
 */

/* Convierte hex a RGB */
export function hexARgb(hex: string): { r: number; g: number; b: number } {
    const resultado = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!resultado) {
        return { r: 0, g: 0, b: 0 };
    }
    return {
        r: parseInt(resultado[1], 16),
        g: parseInt(resultado[2], 16),
        b: parseInt(resultado[3], 16)
    };
}

/* Convierte RGB a hex, opcionalmente con canal alpha */
export function rgbAHex(r: number, g: number, b: number, a?: number): string {
    const toHex = (n: number): string => {
        const hex = Math.max(0, Math.min(255, Math.round(n))).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };

    let hex = '#' + toHex(r) + toHex(g) + toHex(b);

    if (a !== undefined && a < 1) {
        hex += toHex(Math.round(a * 255));
    }

    return hex;
}

/* Convierte HSL a RGB */
export function hslARgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    const sNorm = s / 100;
    const lNorm = l / 100;

    const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = lNorm - c / 2;

    let r = 0, g = 0, b = 0;

    if (h >= 0 && h < 60) {
        r = c; g = x; b = 0;
    } else if (h >= 60 && h < 120) {
        r = x; g = c; b = 0;
    } else if (h >= 120 && h < 180) {
        r = 0; g = c; b = x;
    } else if (h >= 180 && h < 240) {
        r = 0; g = x; b = c;
    } else if (h >= 240 && h < 300) {
        r = x; g = 0; b = c;
    } else if (h >= 300 && h < 360) {
        r = c; g = 0; b = x;
    }

    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}
