/* [V6] Partición de classIndexBuilder.ts: clases definidas en CSS. Sin cambio de comportamiento. */
import { ClaseCssDefinida } from '../tipos';

/* [J-8] El cap evita que un workspace enorme agote memoria, pero 10000 deja
 * sin escanear archivos posteriores (MapaV2.tsx etc.) en proyectos medianos.
 * 50k cubre la práctica real con RSS holgado (unos 70 MB en un monorepo grande). */
export const MAX_TOKENS = 50000;

export function extraerClasesDeTexto(texto: string, rutaArchivo: string): ClaseCssDefinida[] {
    const clases: ClaseCssDefinida[] = [];
    const textoLimpio = texto.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
    const lineas = textoLimpio.split('\n');
    const regexClase = /\.([a-zA-Z_][\w-]*)/g;

    for (let numLinea = 0; numLinea < lineas.length; numLinea++) {
        const linea = lineas[numLinea];
        const trimmed = linea.trim();

        if (!trimmed) {
            continue;
        }

        /* [318A-7V21] `url('/logo-ejemplo.png')` no es un selector: el `.png`
         * del nombre de archivo casaba con regexClase y producía la clase
         * fantasma 'png' (landing real de un proyecto, CSS:43-44). Se neutraliza
         * el segmento url(...) (con o sin comillas) antes del escaneo. */
        const lineaEscaneable = linea.replace(/url\(\s*(['"])(?:(?!\1).)*\1\s*\)|url\(\s*[^)'"]+\s*\)/gi, ' ');

        const esPropiedad = /^\s*[\w-]+\s*:(?!:)/.test(linea) && !linea.includes('{');
        if (esPropiedad) {
            continue;
        }

        if (trimmed.startsWith('@') && !trimmed.includes('{')) {
            continue;
        }

        let match: RegExpExecArray | null;
        while ((match = regexClase.exec(lineaEscaneable)) !== null) {
            clases.push({
                nombre: match[1],
                archivo: rutaArchivo,
                linea: numLinea,
                columna: match.index,
                selector: trimmed
            });
        }
        regexClase.lastIndex = 0;
    }

    return clases;
}
