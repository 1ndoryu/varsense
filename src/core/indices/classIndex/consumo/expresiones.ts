/* [V6] Partición de classIndexBuilder.ts: expresiones de clase exactas (ternarios y concatenaciones). Sin cambio de comportamiento. */
import { descomponerTemplate, finTemplateLiteral } from '../plantillas/plantillas';
import { addTemplateClassTokens } from '../plantillas/resolucionTemplate';
import { resolverAccesoPuntoMapa, sinFallbackClase } from './llamadas';
import { addQuotedClassTokens } from './tokens';

/* [149A-1 F3.11] orphan-plantilla-resuelta: resolucion exacta de expresiones
 * de clase compuestas ANTES de marcar. La indireccion cubria solo
 * identificadores puros (className={x}); las concatenaciones ('ico-' + v),
 * los ternarios compuestos (cond ? 'a-' + v : 'b') y los templates con vars
 * (`pref-${v}`) quedaban sin resolver y su clase exacta se reportaba
 * huerfana (FP). El evaluador expande la expresion contra el mapa de
 * declaraciones y devuelve las cadenas exactas; devuelve null (fail-closed)
 * ante llamadas, accesos a miembro, identificadores desconocidos o
 * combinatoria excesiva, conservando el comportamiento previo (familias y
 * literales). Solo ANade tokens de uso: jamas crea un reporte nuevo (H11:
 * 0 FP por construccion) y confia en el mapa igual que la indireccion
 * existente (mismo nivel de aproximacion, sin nueva clase de confianza). */
export const MAX_COMBINACIONES_CLASE_EXACTA = 25;
export const REGEX_IDENTIFICADOR_PURO = /^[A-Za-z_$][\w$]*$/;

/* Contenido de un literal completo (quotes, dobles o template balanceado).
 * Null si la expresion no es un unico literal (p.ej. 'a' + 'b'). */
export function contenidoLiteral(expr: string): { comilla: string; contenido: string } | null {
    const trimmed = expr.trim();
    if (trimmed.length < 2) {
        return null;
    }
    const comilla = trimmed[0];
    if (comilla !== "'" && comilla !== '"' && comilla !== '`') {
        return null;
    }
    if (comilla === '`') {
        const cierre = finTemplateLiteral(trimmed, 0);
        return cierre === trimmed.length - 1 ? { comilla, contenido: trimmed.slice(1, cierre) } : null;
    }
    let i = 1;
    while (i < trimmed.length) {
        const c = trimmed[i];
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (c === comilla) {
            return i === trimmed.length - 1 ? { comilla, contenido: trimmed.slice(1, i) } : null;
        }
        i++;
    }
    return null;
}

export interface EstadoDivision { quote: string; profundidad: number }

/* Avanza un indice respetando strings simples/dobles; ante un backtick salta
 * con el escaner balanceado (soporta ${...} anidados). */
export function saltarAtomico(expr: string, i: number, estado: EstadoDivision): number {
    const c = expr[i];
    if (estado.quote) {
        if (c === '\\') {
            return i + 2;
        }
        if (c === estado.quote) {
            estado.quote = '';
        }
        return i + 1;
    }
    if (c === '"' || c === "'") {
        estado.quote = c;
        return i + 1;
    }
    if (c === '`') {
        const cierre = finTemplateLiteral(expr, i);
        return cierre < 0 ? expr.length : cierre + 1;
    }
    if (c === '(' || c === '[' || c === '{') {
        estado.profundidad++;
    } else if (c === ')' || c === ']' || c === '}') {
        estado.profundidad--;
    }
    return i + 1;
}

/* Divide por '+' a profundidad 0. Null si no hay concatenacion superior. */
export function dividirConcatenacion(expr: string): string[] | null {
    const partes: string[] = [];
    const estado: EstadoDivision = { quote: '', profundidad: 0 };
    let inicio = 0;
    let i = 0;
    while (i < expr.length) {
        const c = expr[i];
        if (!estado.quote && estado.profundidad === 0 && c === '+') {
            partes.push(expr.slice(inicio, i));
            inicio = i + 1;
            i++;
            continue;
        }
        i = saltarAtomico(expr, i, estado);
    }
    if (partes.length === 0) {
        return null;
    }
    partes.push(expr.slice(inicio));
    return partes;
}

/* Divide un ternario superior en [rama, alternativa]. Excluye '?.' y '??'.
 * Null si no hay forma cond ? a : b a profundidad 0. */
export function dividirTernario(expr: string): [string, string] | null {
    const estado: EstadoDivision = { quote: '', profundidad: 0 };
    let qi = -1;
    let i = 0;
    while (i < expr.length) {
        const c = expr[i];
        if (!estado.quote && estado.profundidad === 0 && c === '?'
            && expr[i + 1] !== '.' && expr[i + 1] !== '?' && expr[i - 1] !== '?') {
            qi = i;
            break;
        }
        i = saltarAtomico(expr, i, estado);
    }
    if (qi < 0) {
        return null;
    }
    const estadoDos: EstadoDivision = { quote: '', profundidad: 0 };
    let j = qi + 1;
    while (j < expr.length) {
        const c = expr[j];
        if (!estadoDos.quote && estadoDos.profundidad === 0 && c === ':') {
            return [expr.slice(qi + 1, j), expr.slice(j + 1)];
        }
        j = saltarAtomico(expr, j, estadoDos);
    }
    return null;
}

/* Expande el contenido de un template (sin backticks) sustituyendo cada
 * interpolacion por sus valores exactos. Null si alguna no resuelve. */
export function expandirPlantillaContenido(contenido: string, variables: Map<string, Set<string>>): string[] | null {
    if (!contenido.includes('${')) {
        return [contenido];
    }
    const { segmentos, expresiones } = descomponerTemplate(contenido);
    let resultados = [''];
    for (let k = 0; k < expresiones.length; k++) {
        const opciones = resolverExpresionClaseExacta(expresiones[k].trim(), variables);
        if (!opciones || opciones.length === 0) {
            return null;
        }
        const combinado: string[] = [];
        for (const base of resultados) {
            for (const opcion of opciones) {
                combinado.push(base + segmentos[k] + opcion);
                if (combinado.length > MAX_COMBINACIONES_CLASE_EXACTA) {
                    return null;
                }
            }
        }
        resultados = combinado;
    }
    const sufijo = segmentos[segmentos.length - 1] ?? '';
    return resultados.map(base => base + sufijo);
}

/* Resuelve una expresion de clase a sus cadenas exactas o null. */
export function resolverExpresionClaseExacta(expr: string, variables: Map<string, Set<string>>): string[] | null {
    const trimmed = expr.trim();
    if (!trimmed) {
        return null;
    }
    if (REGEX_IDENTIFICADOR_PURO.test(trimmed)) {
        const resuelto = variables.get(trimmed);
        return resuelto && resuelto.size > 0 ? [...resuelto] : null;
    }
    const literal = contenidoLiteral(trimmed);
    if (literal) {
        return literal.comilla === '`'
            ? expandirPlantillaContenido(literal.contenido, variables)
            : [literal.contenido];
    }
    const ternario = dividirTernario(trimmed);
    if (ternario) {
        const ramas = resolverExpresionClaseExacta(ternario[0], variables);
        const alternativa = resolverExpresionClaseExacta(ternario[1], variables);
        return ramas && alternativa ? [...ramas, ...alternativa] : null;
    }
    const partes = dividirConcatenacion(trimmed);
    if (partes) {
        let resultados = [''];
        for (const parte of partes) {
            const opciones = resolverExpresionClaseExacta(parte, variables);
            if (!opciones || opciones.length === 0) {
                return null;
            }
            const combinado: string[] = [];
            for (const base of resultados) {
                for (const opcion of opciones) {
                    combinado.push(base + opcion);
                    if (combinado.length > MAX_COMBINACIONES_CLASE_EXACTA) {
                        return null;
                    }
                }
            }
            resultados = combinado;
        }
        return resultados;
    }
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        return resolverExpresionClaseExacta(trimmed.slice(1, -1), variables);
    }
    return null;
}

/* Anade las cadenas exactas como tokens de uso (split + forma de clase). */
export function agregarClasesExactas(exactas: string[] | null, tokens: Set<string>): void {
    if (!exactas) {
        return;
    }
    for (const exacta of exactas) {
        for (const clase of exacta.split(/\s+/)) {
            if (clase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(clase)) {
                tokens.add(clase);
            }
        }
    }
}

/* [J-8] Resuelve un identificador puro (className={clases}) contra el mapa de
 * declaraciones; si no es un identificador, extrae los literales embebidos
 * (ternarios, templates). */
export function resolverExpresionClase(body: string, variables: Map<string, Set<string>>, tokens: Set<string>, familyPrefixes?: Set<string>, importsPropios?: Set<string>, referenciasMapa?: Set<string>): void {
    const trimmed = body.trim();
    /* [149A-1 F3.11] resolucion exacta aditiva antes del flujo previo. */
    agregarClasesExactas(resolverExpresionClaseExacta(trimmed, variables), tokens);
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
        const resuelto = variables.get(trimmed);
        if (resuelto) {
            for (const token of resuelto) {
                tokens.add(token);
            }
        } else if (importsPropios?.has(trimmed)) {
            /* [11AA-2] `className={CLASE_TEXTO}` con escalar importado: misma
             * referencia que en template (fase 2 resuelve contra el exportador). */
            referenciasMapa?.add(trimmed);
        }
        return;
    }
    /* [318A-7V23] Template literal en posición de clase (el('li', `tarea
     * ${CLASES[tarea.estado]}`) en tareasMeta.ts:62 de GH): los segmentos
     * estáticos son clases y cada ${} se resuelve por indirección (ident),
     * subíndice sobre mapa (M1) o literales embebidos. contextoAttr=true: el
     * valor en esta posición ES una cadena de clases por construcción. Un
     * template sin cierre balanceado cae al camino de literales de abajo. */
    if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2) {
        addTemplateClassTokens(trimmed.slice(1, -1), variables, tokens, familyPrefixes, true, importsPropios, referenciasMapa);
        return;
    }
    /* [299A-13 F3b] Subíndice en posición de expresión (`className={
     * STATUS_CLASS[order.status]}` en UsuariosFila.tsx:80, `el('li',
     * CLASES[x])` vanilla): resuelve el set local (misma regla M1 que en
     * template) o registra la referencia al mapa importado para la fase 2.
     * [299A-13 F3b-2] Tolera fallback literal (`MAPA[x] || ''`) y acceso por
     * punto simple (`MAPA.prop`, sin llamada detrás). */
    const sinFallbackExpr = sinFallbackClase(trimmed);
    const subindiceExpr = /^([A-Za-z_$][\w$]*)\s*\[[^\]]+\]$/.exec(sinFallbackExpr);
    if (subindiceExpr) {
        const resueltoLocal = variables.get(subindiceExpr[1]);
        if (resueltoLocal) {
            for (const token of resueltoLocal) {
                tokens.add(token);
            }
        } else if (importsPropios?.has(subindiceExpr[1])) {
            referenciasMapa?.add(subindiceExpr[1]);
        }
    } else {
        const puntoExpr = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(sinFallbackExpr);
        if (puntoExpr) {
            resolverAccesoPuntoMapa(puntoExpr[1], variables, tokens, importsPropios, referenciasMapa);
        }
    }
    addQuotedClassTokens(trimmed, tokens, familyPrefixes);
}
