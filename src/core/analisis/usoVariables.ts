/* Nombres de variables CSS usados en un texto. Dos formas: `var(--x)` (CSS y estilos
 * inline en JS) y `bg-(--x)` (shorthand arbitrario de Tailwind v4 en clases de TSX/JS).
 * [por que] token-unused contaba solo `var(`: un token usado únicamente en clases de
 * Tailwind salía huérfano aunque se pintara. Vive aquí para que el índice inverso y el
 * escaneo de respaldo usen la misma regla. Tercera forma: `getPropertyValue('--x')` en JS,
 * que lee la variable sin pasar por `var(`. */
const REGEX_USO = /var\(\s*(--[\w-]+)|\(\s*(--[\w-]+)\s*\)|getPropertyValue\(\s*['"`](--[\w-]+)/g;

export function extraerUsoVariablesDeTexto(texto: string): string[] {
    const usos = new Set<string>();
    for (const match of texto.matchAll(REGEX_USO)) {
        usos.add(match[1] ?? match[2] ?? match[3]);
    }
    return [...usos].sort();
}
