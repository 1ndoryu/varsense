/*
 * Utilidades para manejo y detección de colores CSS
 * Soporta formatos: hex, rgb, rgba, hsl, hsla, y colores nombrados
 */

import { ColorInfo, ColorFormat } from '../types';

/*
 * Mapa de colores CSS nombrados a valores hexadecimales
 * Lista completa de colores CSS Level 4
 */
const NAMED_COLORS: Record<string, string> = {
    'aliceblue': '#f0f8ff',
    'antiquewhite': '#faebd7',
    'aqua': '#00ffff',
    'aquamarine': '#7fffd4',
    'azure': '#f0ffff',
    'beige': '#f5f5dc',
    'bisque': '#ffe4c4',
    'black': '#000000',
    'blanchedalmond': '#ffebcd',
    'blue': '#0000ff',
    'blueviolet': '#8a2be2',
    'brown': '#a52a2a',
    'burlywood': '#deb887',
    'cadetblue': '#5f9ea0',
    'chartreuse': '#7fff00',
    'chocolate': '#d2691e',
    'coral': '#ff7f50',
    'cornflowerblue': '#6495ed',
    'cornsilk': '#fff8dc',
    'crimson': '#dc143c',
    'cyan': '#00ffff',
    'darkblue': '#00008b',
    'darkcyan': '#008b8b',
    'darkgoldenrod': '#b8860b',
    'darkgray': '#a9a9a9',
    'darkgreen': '#006400',
    'darkgrey': '#a9a9a9',
    'darkkhaki': '#bdb76b',
    'darkmagenta': '#8b008b',
    'darkolivegreen': '#556b2f',
    'darkorange': '#ff8c00',
    'darkorchid': '#9932cc',
    'darkred': '#8b0000',
    'darksalmon': '#e9967a',
    'darkseagreen': '#8fbc8f',
    'darkslateblue': '#483d8b',
    'darkslategray': '#2f4f4f',
    'darkslategrey': '#2f4f4f',
    'darkturquoise': '#00ced1',
    'darkviolet': '#9400d3',
    'deeppink': '#ff1493',
    'deepskyblue': '#00bfff',
    'dimgray': '#696969',
    'dimgrey': '#696969',
    'dodgerblue': '#1e90ff',
    'firebrick': '#b22222',
    'floralwhite': '#fffaf0',
    'forestgreen': '#228b22',
    'fuchsia': '#ff00ff',
    'gainsboro': '#dcdcdc',
    'ghostwhite': '#f8f8ff',
    'gold': '#ffd700',
    'goldenrod': '#daa520',
    'gray': '#808080',
    'green': '#008000',
    'greenyellow': '#adff2f',
    'grey': '#808080',
    'honeydew': '#f0fff0',
    'hotpink': '#ff69b4',
    'indianred': '#cd5c5c',
    'indigo': '#4b0082',
    'ivory': '#fffff0',
    'khaki': '#f0e68c',
    'lavender': '#e6e6fa',
    'lavenderblush': '#fff0f5',
    'lawngreen': '#7cfc00',
    'lemonchiffon': '#fffacd',
    'lightblue': '#add8e6',
    'lightcoral': '#f08080',
    'lightcyan': '#e0ffff',
    'lightgoldenrodyellow': '#fafad2',
    'lightgray': '#d3d3d3',
    'lightgreen': '#90ee90',
    'lightgrey': '#d3d3d3',
    'lightpink': '#ffb6c1',
    'lightsalmon': '#ffa07a',
    'lightseagreen': '#20b2aa',
    'lightskyblue': '#87cefa',
    'lightslategray': '#778899',
    'lightslategrey': '#778899',
    'lightsteelblue': '#b0c4de',
    'lightyellow': '#ffffe0',
    'lime': '#00ff00',
    'limegreen': '#32cd32',
    'linen': '#faf0e6',
    'magenta': '#ff00ff',
    'maroon': '#800000',
    'mediumaquamarine': '#66cdaa',
    'mediumblue': '#0000cd',
    'mediumorchid': '#ba55d3',
    'mediumpurple': '#9370db',
    'mediumseagreen': '#3cb371',
    'mediumslateblue': '#7b68ee',
    'mediumspringgreen': '#00fa9a',
    'mediumturquoise': '#48d1cc',
    'mediumvioletred': '#c71585',
    'midnightblue': '#191970',
    'mintcream': '#f5fffa',
    'mistyrose': '#ffe4e1',
    'moccasin': '#ffe4b5',
    'navajowhite': '#ffdead',
    'navy': '#000080',
    'oldlace': '#fdf5e6',
    'olive': '#808000',
    'olivedrab': '#6b8e23',
    'orange': '#ffa500',
    'orangered': '#ff4500',
    'orchid': '#da70d6',
    'palegoldenrod': '#eee8aa',
    'palegreen': '#98fb98',
    'paleturquoise': '#afeeee',
    'palevioletred': '#db7093',
    'papayawhip': '#ffefd5',
    'peachpuff': '#ffdab9',
    'peru': '#cd853f',
    'pink': '#ffc0cb',
    'plum': '#dda0dd',
    'powderblue': '#b0e0e6',
    'purple': '#800080',
    'rebeccapurple': '#663399',
    'red': '#ff0000',
    'rosybrown': '#bc8f8f',
    'royalblue': '#4169e1',
    'saddlebrown': '#8b4513',
    'salmon': '#fa8072',
    'sandybrown': '#f4a460',
    'seagreen': '#2e8b57',
    'seashell': '#fff5ee',
    'sienna': '#a0522d',
    'silver': '#c0c0c0',
    'skyblue': '#87ceeb',
    'slateblue': '#6a5acd',
    'slategray': '#708090',
    'slategrey': '#708090',
    'snow': '#fffafa',
    'springgreen': '#00ff7f',
    'steelblue': '#4682b4',
    'tan': '#d2b48c',
    'teal': '#008080',
    'thistle': '#d8bfd8',
    'tomato': '#ff6347',
    'turquoise': '#40e0d0',
    'violet': '#ee82ee',
    'wheat': '#f5deb3',
    'white': '#ffffff',
    'whitesmoke': '#f5f5f5',
    'yellow': '#ffff00',
    'yellowgreen': '#9acd32',
    'transparent': 'transparent'
};

/*
 * Expresiones regulares para detectar formatos de color
 */
const COLOR_PATTERNS = {
    hex3: /^#([0-9a-fA-F]{3})$/,
    hex4: /^#([0-9a-fA-F]{4})$/,
    hex6: /^#([0-9a-fA-F]{6})$/,
    hex8: /^#([0-9a-fA-F]{8})$/,
    rgb: /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i,
    rgba: /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/i,
    rgbModern: /^rgb\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*(?:\/\s*([\d.]+%?))?\s*\)$/i,
    hsl: /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/i,
    hsla: /^hsla\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*,\s*([\d.]+)\s*\)$/i,
    hslModern: /^hsl\(\s*(\d{1,3})\s+(\d{1,3})%\s+(\d{1,3})%\s*(?:\/\s*([\d.]+%?))?\s*\)$/i
};

/*
 * Determina si un valor CSS es un color
 */
export function esColor(valor: string): boolean {
    const valorLimpio = valor.trim().toLowerCase();
    
    /* Verificar colores nombrados */
    if (valorLimpio in NAMED_COLORS) {
        return true;
    }
    
    /* Verificar patrones de color */
    return Object.values(COLOR_PATTERNS).some(pattern => pattern.test(valorLimpio));
}

/*
 * Parsea un valor de color CSS y retorna información detallada
 */
export function parsearColor(valor: string): ColorInfo | null {
    const valorLimpio = valor.trim().toLowerCase();
    
    /* Color nombrado */
    if (valorLimpio in NAMED_COLORS) {
        const hex = NAMED_COLORS[valorLimpio];
        if (hex === 'transparent') {
            return {
                formato: ColorFormat.Named,
                r: 0,
                g: 0,
                b: 0,
                a: 0,
                original: valor,
                hex: '#00000000'
            };
        }
        const rgb = hexARgb(hex);
        return {
            formato: ColorFormat.Named,
            ...rgb,
            a: 1,
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
            r, g, b,
            a: 1,
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
            r, g, b,
            a: a / 255,
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
            ...rgb,
            a: 1,
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
            r, g, b,
            a: 1,
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
            ...rgb,
            a: 1,
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
            ...rgb,
            a,
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
            ...rgb,
            a,
            original: valor,
            hex: rgbAHex(rgb.r, rgb.g, rgb.b, a)
        };
    }
    
    return null;
}

/*
 * Convierte hex a RGB
 */
function hexARgb(hex: string): { r: number; g: number; b: number } {
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

/*
 * Convierte RGB a hex
 */
function rgbAHex(r: number, g: number, b: number, a?: number): string {
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

/*
 * Convierte HSL a RGB
 */
function hslARgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
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

/*
 * Genera un cuadro de preview de color en Markdown
 * Utiliza un emoji de cuadro con fondo coloreado como aproximación
 */
export function generarPreviewColor(color: ColorInfo): string {
    /* VS Code soporta imágenes inline con data URIs en markdown */
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
        <rect width="16" height="16" fill="${color.hex}" stroke="#888" stroke-width="1"/>
    </svg>`;
    
    const base64 = Buffer.from(svg).toString('base64');
    return `![color](data:image/svg+xml;base64,${base64})`;
}

/*
 * Genera markdown con información del color
 */
export function generarMarkdownColor(color: ColorInfo): string {
    const preview = generarPreviewColor(color);
    const lines = [
        `${preview} **${color.original}**`,
        '',
        `- **HEX:** \`${color.hex}\``,
        `- **RGB:** \`rgb(${color.r}, ${color.g}, ${color.b})\``,
    ];
    
    if (color.a < 1) {
        lines.push(`- **Alpha:** \`${color.a.toFixed(2)}\``);
    }
    
    return lines.join('\n');
}

/*
 * Calcula el contraste entre dos colores (para accesibilidad)
 */
export function calcularContraste(color1: ColorInfo, color2: ColorInfo): number {
    const luminancia1 = calcularLuminancia(color1);
    const luminancia2 = calcularLuminancia(color2);
    
    const mas = Math.max(luminancia1, luminancia2);
    const menos = Math.min(luminancia1, luminancia2);
    
    return (mas + 0.05) / (menos + 0.05);
}

/*
 * Calcula la luminancia relativa de un color
 */
function calcularLuminancia(color: ColorInfo): number {
    const [r, g, b] = [color.r, color.g, color.b].map(c => {
        const sRGB = c / 255;
        return sRGB <= 0.03928
            ? sRGB / 12.92
            : Math.pow((sRGB + 0.055) / 1.055, 2.4);
    });
    
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/*
 * Obtiene el nombre del color más cercano (aproximación)
 */
export function obtenerNombreColorCercano(color: ColorInfo): string | null {
    let nombreCercano: string | null = null;
    let distanciaMinima = Infinity;
    
    for (const [nombre, hex] of Object.entries(NAMED_COLORS)) {
        if (hex === 'transparent') {
            continue;
        }
        
        const rgb = hexARgb(hex);
        const distancia = Math.sqrt(
            Math.pow(color.r - rgb.r, 2) +
            Math.pow(color.g - rgb.g, 2) +
            Math.pow(color.b - rgb.b, 2)
        );
        
        if (distancia < distanciaMinima) {
            distanciaMinima = distancia;
            nombreCercano = nombre;
        }
    }
    
    /* Solo retornar si la distancia es razonablemente pequeña */
    return distanciaMinima < 50 ? nombreCercano : null;
}
