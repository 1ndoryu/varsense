/* [V6] Partición de classIndexBuilder.ts: construcción de HTML y patrones de exclusión. Sin cambio de comportamiento. */
import { addTemplateClassTokens } from '../plantillas/resolucionTemplate';

/* [318A-7V22][M4] Extrae las clases de los atributos `class="..."` literales
 * dentro de un valor que construye HTML (template con `<tag` o asignación a
 * innerHTML/html). Solo procesa si el valor parece contener markup HTML; una
 * cadena de clases plana ya la cubre addDeclarationClassTokens (vía carriers).
 * [318A-7V23] El contenido interpolado (`class="${clase}"`) se resuelve contra
 * el mapa de declaraciones igual que un template de atributo (mensajesUtil.ts
 * de GH: cuerpo.push(`<span class="${clase}">`) con `clase` valiendo
 * ctx/add/del/elididas; iconoHtml: `<svg class="${cls}">` con cls={ic,ic-xs}).
 * Sin variables el ${} quedaba sin resolver y esas clases se reportaban. */
export function resolverConstruccionHtml(valor: string, variables: Map<string, Set<string>>, tokens: Set<string>, familyPrefixes?: Set<string>, importsPropios?: Set<string>, referenciasMapa?: Set<string>): void {
    /* Guard rápido: sin '<' no hay construcción de HTML. */
    if (!valor.includes('<')) {
        return;
    }
    /* Atributos class="..." (o class='...') con contenido no vacío. */
    const reAttr = /\bclass\s*=\s*(["'])([\s\S]*?)\1/g;
    let match: RegExpExecArray | null;
    while ((match = reAttr.exec(valor)) !== null) {
        const contenido = match[2];
        if (!contenido.includes('${')) {
            /* Clase literal completa: tokenizar por espacios. */
            for (const clase of contenido.split(/\s+/)) {
                if (clase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(clase)) {
                    tokens.add(clase);
                }
            }
            continue;
        }
        /* Contenido con interpolación: descomponer el template para tokenizar
         * segmentos estáticos, resolver ${ident} por indirección y registrar
         * familias pegadas (ver addTemplateClassTokens). */
        addTemplateClassTokens(contenido, variables, tokens, familyPrefixes, true, importsPropios, referenciasMapa);
    }
}

export function compilarPatronesExcluidos(patterns: string[]): RegExp[] {
    return patterns
        .filter(pattern => pattern.length > 0)
        .map(pattern => {
            try { return new RegExp(pattern); } catch { return null; }
        })
        .filter((regex): regex is RegExp => regex !== null);
}
