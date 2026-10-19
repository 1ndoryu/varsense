/* [V4] Regla EstiloBotonEspecifico: una clase de botón definida en CSS de
 * componente reimplementa estilos que deben venir de <Button>. Antes vivía
 * solo en la extensión; ahora la comparten extensión, CLI y LSP. */
import { DiagnosticType } from '../../types';
import { CoreFinding, CoreTextDocument, createCoreRange } from '../types';

/* Propiedades que indican implementación manual de botón */
const PROPS_BOTON = /\b(padding|background(?:-color)?|border(?:-radius)?|cursor)\s*:/gi;
/* Selector que contiene 'btn' o 'button' (case-insensitive) */
const REGEX_BTN_SELECTOR = /btn|button/i;
/* Regla CSS plana: .clase { ... } — no anidada */
const REGEX_REGLA = /(\.[a-zA-Z][a-zA-Z0-9_-]*)(?:[^{,]*?)\{([^}]*)\}/g;
/* Mínimo de propiedades estructurales para considerar que reimplementa el botón */
const MIN_PROPS_BOTON = 2;

/* Solo CSS dentro de components/, excepto Button.css (el propio componente base) */
function esCssDeComponente(document: CoreTextDocument): boolean {
    const ruta = document.fileName.replace(/\\/g, '/');
    if (!ruta.includes('/components/') || !ruta.endsWith('.css')) {
        return false;
    }
    const nombreArchivo = ruta.split('/').pop() ?? '';
    return !/^button/i.test(nombreArchivo);
}

/* Sustituye cada carácter de un comentario por un espacio (los saltos de línea se
 * conservan): así no se desplazan los offsets y la línea calculada coincide. */
function textoSinComentarios(texto: string): string {
    return texto.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
}

export function analyzeEstiloBotonEspecifico(document: CoreTextDocument): CoreFinding[] {
    if (!esCssDeComponente(document)) {
        return [];
    }

    const texto = document.getText();
    const sinComentarios = textoSinComentarios(texto);
    const findings: CoreFinding[] = [];
    REGEX_REGLA.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = REGEX_REGLA.exec(sinComentarios)) !== null) {
        const nombreClase = match[1];
        if (!REGEX_BTN_SELECTOR.test(nombreClase)) {
            continue;
        }

        const propsEncontradas = (match[2].match(PROPS_BOTON) ?? []).length;
        if (propsEncontradas < MIN_PROPS_BOTON) {
            continue;
        }

        /* Línea de inicio del selector en el texto original */
        const linea = (texto.substring(0, match.index).match(/\n/g) ?? []).length;
        findings.push({
            ruleId: DiagnosticType.EstiloBotonEspecifico,
            message: `Estilo de botón específico '${nombreClase}' en componente. Usar <Button variante=... tamano=...> en vez de clase local.`,
            severity: 'warning',
            range: createCoreRange(linea, 0, linea, nombreClase.length),
            source: 'VarSense',
        });
    }

    return findings;
}
