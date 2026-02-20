/*
 * Barrel de utilidades de color CSS.
 * Re-exporta desde modulos especializados para mantener compatibilidad
 * con imports existentes (esColor, parsearColor, etc. desde 'colorUtils').
 *
 * Modulos internos:
 * - colorConstants: NAMED_COLORS, COLOR_PATTERNS (datos puros)
 * - colorConversion: hexARgb, rgbAHex, hslARgb (conversion entre formatos)
 * - colorParsing: esColor, parsearColor (deteccion y parsing)
 * - colorPresentation: preview, markdown, contraste, nombre cercano
 */

export { esColor, parsearColor } from './colorParsing';
export { generarPreviewColor, generarMarkdownColor, calcularContraste, obtenerNombreColorCercano } from './colorPresentation';
export { hexARgb, rgbAHex, hslARgb } from './colorConversion';
export { NAMED_COLORS, COLOR_PATTERNS } from './colorConstants';
