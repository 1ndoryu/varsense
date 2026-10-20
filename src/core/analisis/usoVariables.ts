/* Nombres de variables CSS usados en un texto. Dos formas: `var(--x)` (CSS y estilos
 * inline en JS) y `bg-(--x)` (shorthand arbitrario de Tailwind v4 en clases de TSX/JS).
 * [por que] token-unused contaba solo `var(`: un token usado únicamente en clases de
 * Tailwind salía huérfano aunque se pintara. Vive aquí para que el índice inverso y el
 * escaneo de respaldo usen la misma regla. Tercera forma: `getPropertyValue('--x')` en JS,
 * que lee la variable sin pasar por `var(`. */
const FORMA_VAR = String.raw`var\(\s*(--[\w-]+)`;
const FORMA_SHORTHAND_TAILWIND = String.raw`\(\s*(--[\w-]+)\s*\)`;
const FORMA_GET_PROPERTY = String.raw`getPropertyValue\(\s*['"\`](--[\w-]+)`;

/* [AG-1] El shorthand `(--x)` es sintaxis de Tailwind: `tokenDetection.tailwindShorthand`
 * lo desactiva para proyectos que no la usan (por defecto, activo). */
const REGEX_USO_CON_SHORTHAND = new RegExp(`${FORMA_VAR}|${FORMA_SHORTHAND_TAILWIND}|${FORMA_GET_PROPERTY}`, 'g');
const REGEX_USO_SIN_SHORTHAND = new RegExp(`${FORMA_VAR}|${FORMA_GET_PROPERTY}`, 'g');

export interface OpcionesUsoVariables {
    shorthandTailwind?: boolean;
}

export function extraerUsoVariablesDeTexto(texto: string, opciones: OpcionesUsoVariables = {}): string[] {
    const regex = opciones.shorthandTailwind === false ? REGEX_USO_SIN_SHORTHAND : REGEX_USO_CON_SHORTHAND;
    const usos = new Set<string>();
    for (const match of texto.matchAll(regex)) {
        usos.add(match[1] ?? match[2] ?? match[3]);
    }
    return [...usos].sort();
}
