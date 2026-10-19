/* [V4] Regla EstiloBotonEspecifico: una clase de botón definida en CSS de
 * componente reimplementa estilos que deben venir de <Button>. Antes vivía
 * solo en la extensión; ahora la comparten extensión, CLI y LSP. */
import { DiagnosticType } from '../../types';
import { CoreFinding, CoreSeverity, CoreTextDocument, createCoreRange } from '../types';

/* Propiedades que indican implementación manual de botón */
const PROPS_BOTON = /\b(padding|background(?:-color)?|border(?:-radius)?|cursor)\s*:/gi;
/* Regla CSS plana: .clase { ... } — no anidada */
const REGEX_REGLA = /(\.[a-zA-Z][a-zA-Z0-9_-]*)(?:[^{,]*?)\{([^}]*)\}/g;
/* Mínimo de propiedades estructurales para considerar que reimplementa el botón */
const MIN_PROPS_BOTON = 2;

/* [por que] Convención del design system del área (NAKOMI): son defaults, no reglas del
 * core. Otro proyecto los cambia en `buttonStyleDetection` de varsense.config.json. */
export interface VarsenseEstiloBotonConfig {
    habilitado: boolean;
    severidad: CoreSeverity;
    /* Nombre de carpeta donde viven los componentes (segmento de ruta). */
    carpeta: string;
    /* Fuente de regex (sin flags): selector de clase que se considera botón. Se compila sin distinguir mayúsculas. */
    patronSelector: string;
    /* Fuente de regex (sin flags) aplicada al nombre de archivo: no se analiza si coincide. */
    patronExcluirArchivo: string;
}

export const ESTILO_BOTON_POR_DEFECTO: VarsenseEstiloBotonConfig = {
    habilitado: true,
    severidad: 'warning',
    carpeta: 'components',
    patronSelector: 'btn|button',
    patronExcluirArchivo: '^button',
};

/* Solo CSS dentro de la carpeta de componentes, salvo el archivo excluido (el propio componente base) */
function esCssDeComponente(document: CoreTextDocument, config: VarsenseEstiloBotonConfig): boolean {
    const ruta = document.fileName.replace(/\\/g, '/');
    if (!ruta.includes(`/${config.carpeta}/`) || !ruta.endsWith('.css')) {
        return false;
    }
    const nombreArchivo = ruta.split('/').pop() ?? '';
    return !new RegExp(config.patronExcluirArchivo, 'i').test(nombreArchivo);
}

/* Sustituye cada carácter de un comentario por un espacio (los saltos de línea se
 * conservan): así no se desplazan los offsets y la línea calculada coincide. */
function textoSinComentarios(texto: string): string {
    return texto.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
}

export function analyzeEstiloBotonEspecifico(
    document: CoreTextDocument,
    config: VarsenseEstiloBotonConfig = ESTILO_BOTON_POR_DEFECTO
): CoreFinding[] {
    if (!config.habilitado || !esCssDeComponente(document, config)) {
        return [];
    }

    const regexSelector = new RegExp(config.patronSelector, 'i');
    const texto = document.getText();
    const sinComentarios = textoSinComentarios(texto);
    const findings: CoreFinding[] = [];
    const regexRegla = new RegExp(REGEX_REGLA.source, 'g');

    let match: RegExpExecArray | null;
    while ((match = regexRegla.exec(sinComentarios)) !== null) {
        const nombreClase = match[1];
        if (!regexSelector.test(nombreClase)) {
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
            severity: config.severidad,
            range: createCoreRange(linea, 0, linea, nombreClase.length),
            source: 'VarSense',
        });
    }

    return findings;
}
