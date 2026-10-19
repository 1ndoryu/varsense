/* [V6] Partición de classIndexBuilder.ts: tokens de clase desde cadenas y expresiones. Sin cambio de comportamiento. */
import { descomponerTemplate, extraerLiterales, registrarPrefijosFamilia } from '../plantillas/plantillas';
import { EstadoDivision, saltarAtomico } from './expresiones';
import { pareceTernarioDeLiterales, sinFallbackClase } from './llamadas';

export function addClassTokens(value: string, tokens: Set<string>, familyPrefixes?: Set<string>, contextoAttr = false): void {
    if (familyPrefixes) {
        registrarPrefijosFamilia(value, familyPrefixes, contextoAttr);
    }
    /* [318A-7V18] descomponerTemplate en lugar de replace con `\$\{[^}]*\}`:
     * el regex se cortaba en el `}` INTERIOR de un template anidado y dejaba
     * basura en los segmentos estáticos (SelectorNivel.tsx:39). */
    const { segmentos, expresiones } = descomponerTemplate(value);
    for (const segmento of segmentos) {
        for (const clase of segmento.split(/\s+/)) {
            if (clase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(clase)) {
                tokens.add(clase);
            }
        }
    }

    /* Conserva clases literales dentro de ternarios/template expressions:
     * `campo ${error ? 'campoError' : ''}`. Nunca agrega identificadores.
     * Los cuerpos balanceados pueden contener templates anidados; sus
     * literales (comillas/backticks) se extraen recursivamente aquí. */
    for (const body of expresiones) {
        for (const literal of extraerLiterales(body)) {
            addClassTokens(literal, tokens, familyPrefixes, contextoAttr);
        }
    }
}

export function previousCodeCharacter(source: string, index: number): string {
    let cursor = index - 1;
    while (cursor >= 0 && /\s/.test(source[cursor])) {cursor--;}
    return cursor >= 0 ? source[cursor] : '';
}

export function addQuotedClassTokens(value: string, tokens: Set<string>, familyPrefixes?: Set<string>, contextoAttr = false): void {
    for (const literal of extraerLiterales(value)) {
        addClassTokens(literal, tokens, familyPrefixes, contextoAttr);
    }
}

export function addDeclarationClassTokens(value: string, tokens: Set<string>, familyPrefixes?: Set<string>, contextoAttr = false): void {
    const trimmed = value.trim();
    if (/^(['"`])[\s\S]*\1$/.test(trimmed)) {
        addClassTokens(trimmed.slice(1, -1), tokens, familyPrefixes, contextoAttr);
        addQuotedClassTokens(trimmed, tokens, familyPrefixes, contextoAttr);
        return;
    }
    if (pareceTernarioDeLiterales(trimmed)) {
        addQuotedClassTokens(trimmed, tokens, familyPrefixes, contextoAttr);
    }
}

/* [J-8] Recorta cadenas de métodos al final de un valor para reducir
 * `\`campo ${x}\`.trim()` o `['a','b'].join(' ')` a su literal base. */
export function normalizarValorLiteral(value: string): string {
    let current = value.trim();
    for (;;) {
        const recortado = current.replace(/\s*\.\s*\w+\s*\([^)]*\)\s*$/, '');
        if (recortado === current) {
            break;
        }
        current = recortado;
    }
    return current;
}

/* [J-8] Recopila declaraciones cuyo valor es un literal de clases: string,
 * template, ternario con literales o array de literales. Permite resolver
 * className={ident}, classList.add(ident) y createElement(tag, ident) por
 * indirección de variable (const x = 'a b'; ...; className={x}). Solo
 * literales: una llamada a función (helper('clase')) NO resuelve, manteniendo
 * el contrato del test 'unusedPanel'. */
/* [15A-25] Elementos de nivel superior de un array literal. Null si el valor
 * no empieza por '['. Respeta strings y anidamiento (un array de arrays o una
 * llamada dentro de un elemento no parten por sus comas). */
export function dividirElementosArray(valor: string): string[] | null {
    const cuerpo = valor.trim();
    if (!cuerpo.startsWith('[')) {
        return null;
    }
    const elementos: string[] = [];
    const estado: EstadoDivision = { quote: '', profundidad: 0 };
    let inicio = 1;
    let i = 1;
    while (i < cuerpo.length) {
        const c = cuerpo[i];
        if (!estado.quote && estado.profundidad === 0 && (c === ',' || c === ']')) {
            elementos.push(cuerpo.slice(inicio, i));
            if (c === ']') {
                return elementos;
            }
            inicio = i + 1;
            i++;
            continue;
        }
        i = saltarAtomico(cuerpo, i, estado);
    }
    return elementos;
}

/* [15A-25] Un array de fragmentos de clase compone en runtime: `const clases =
 * ['badge', mapaVariante[variante], mapaTamano[tamano], ...]` y luego
 * `className={clases}` (Badge.tsx, Avatar.tsx, BotonBase.tsx, Modal.tsx,
 * Notificacion.tsx). Los elementos que no son literales —un subindice sobre un
 * mapa local o una variable local— los aplica el runtime igual, pero
 * `addQuotedClassTokens` solo ve comillas y la clase definida en el CSS salia
 * huerfana. Se resuelven contra las declaraciones ya recopiladas del archivo:
 * un nombre desconocido no aporta nada (fail-closed). */
export function resolverFragmentosDeArray(
    valor: string,
    variables: Map<string, Set<string>>,
    tokens: Set<string>
): void {
    const elementos = dividirElementosArray(valor);
    if (!elementos) {
        return;
    }
    for (const elemento of elementos) {
        const limpio = sinFallbackClase(elemento.trim());
        const subindice = /^([A-Za-z_$][\w$]*)\s*\[[^\]]+\]$/.exec(limpio);
        const nombre = subindice ? subindice[1] : (/^[A-Za-z_$][\w$]*$/.test(limpio) ? limpio : null);
        if (!nombre) {
            continue;
        }
        const resuelto = variables.get(nombre);
        if (resuelto) {
            for (const token of resuelto) {
                tokens.add(token);
            }
        }
    }
}
