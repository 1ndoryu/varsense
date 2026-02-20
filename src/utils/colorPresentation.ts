/*
 * Funciones de presentación visual y análisis de accesibilidad de colores.
 * Preview SVG para VS Code, markdown, contraste y nombre cercano.
 */

import type { ColorInfo } from '../types';
import { NAMED_COLORS } from './colorConstants';
import { hexARgb } from './colorConversion';

/* Genera un cuadro de preview de color en Markdown usando SVG inline */
export function generarPreviewColor(color: ColorInfo): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
        <rect width="16" height="16" fill="${color.hex}" stroke="#888" stroke-width="1"/>
    </svg>`;

    const base64 = Buffer.from(svg).toString('base64');
    return `![color](data:image/svg+xml;base64,${base64})`;
}

/* Genera markdown con información del color (hex, rgb, alpha) */
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

/* Calcula el contraste entre dos colores según WCAG 2.0 */
export function calcularContraste(color1: ColorInfo, color2: ColorInfo): number {
    const luminancia1 = calcularLuminancia(color1);
    const luminancia2 = calcularLuminancia(color2);

    const mas = Math.max(luminancia1, luminancia2);
    const menos = Math.min(luminancia1, luminancia2);

    return (mas + 0.05) / (menos + 0.05);
}

/* Calcula la luminancia relativa de un color según WCAG 2.0 */
function calcularLuminancia(color: ColorInfo): number {
    const [r, g, b] = [color.r, color.g, color.b].map(c => {
        const sRGB = c / 255;
        return sRGB <= 0.03928
            ? sRGB / 12.92
            : Math.pow((sRGB + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* Obtiene el nombre CSS del color más cercano por distancia euclidiana RGB */
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
