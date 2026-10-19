/* [V6] Partición de classIndexBuilder.ts: resolución de switch y tokens de plantillas. Sin cambio de comportamiento. */
import { isCodeMatch } from '../consumo/consumidores';
import { agregarClasesExactas, expandirPlantillaContenido, resolverExpresionClaseExacta } from '../consumo/expresiones';
import { resolverAccesoPuntoMapa, sinFallbackClase } from '../consumo/llamadas';
import { addClassTokens } from '../consumo/tokens';
import { descomponerTemplate, extraerLiterales, registrarPrefijosFamilia } from './plantillas';

/* [J-8] Recopila declaraciones cuyo valor es un literal de clases: string,
 * template, ternario con literales o array de literales. Permite resolver
 * className={ident}, classList.add(ident) y createElement(tag, ident) por
 * indirección de variable (const x = 'a b'; ...; className={x}). Solo
 * literales: una llamada a función (helper('clase')) NO resuelve, manteniendo
 * el contrato del test 'unusedPanel'. */
export const REGEX_SWITCH_SUBJECT = /\bswitch\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/g;
export const REGEX_SWITCH_CASE = /\bcase\s*['"]([A-Za-z_][\w-]*)['"]\s*:/g;
/* [318A-7V3] Resuelve interpolaciones de template className={\`... ${x.y} ...\`}:
 * 1) identificador puro → mapa de declaraciones (VistaResizeHandle de PT);
 * 2) cadenas con punto que también son sujeto de un switch en el MISMO
 * archivo → los literales de sus case son los valores que en runtime se
 * interpolan como clases (CabeceraArbitraje: switch (viabilidad.estado) +
 * className={\`estadoViabilidad ${viabilidad.estado}\`}).
 * La parte 2 se resuelve en extraerTokensDeTexto, que tiene el source. */
export function addTemplateClassTokens(value: string, variables: Map<string, Set<string>>, tokens: Set<string>, familyPrefixes?: Set<string>, contextoAttr = false, importsPropios?: Set<string>, referenciasMapa?: Set<string>): void {
    if (familyPrefixes) {
        registrarPrefijosFamilia(value, familyPrefixes, contextoAttr);
    }
    /* [149A-1 F3.11] expansion exacta del template completo antes de marcar. */
    agregarClasesExactas(expandirPlantillaContenido(value, variables), tokens);
    const { segmentos, expresiones } = descomponerTemplate(value);
    for (const segmento of segmentos) {
        for (const clase of segmento.split(/\s+/)) {
            if (clase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(clase)) {
                tokens.add(clase);
            }
        }
    }

    for (const body of expresiones) {
        const trimmed = body.trim();
        /* [149A-1 F3.11] interpolaciones compuestas (${'a-' + v}). */
        agregarClasesExactas(resolverExpresionClaseExacta(trimmed, variables), tokens);
        if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
            const resuelto = variables.get(trimmed);
            if (resuelto) {
                for (const token of resuelto) {
                    tokens.add(token);
                }
            }
            /* [11AA-2] Escalar importado interpolado (`${CLASE_TEXTO}` con
             * `export const CLASE_TEXTO = 'texto-publica'` en otro archivo, caso
             * MN-Inmobiliaria/disenno.ts). Se registra como referencia para la
             * unión post-hoc; los nombres no importados se ignoran. */
            else if (importsPropios?.has(trimmed)) {
                referenciasMapa?.add(trimmed);
            }
        }
        /* [318A-7V22][M1] Subíndice sobre un mapa de clases dentro de un
         * atributo de clase: `CLASES_FUENTE[config.tamanoFuente]`
         * (PanelRecordatorios.tsx:91). Todas las claves del Record son
         * alcanzables en runtime (la variable es el mapa completo), así que
         * el subíndice resuelve el set de la variable igual que un ident.
         * [299A-13 F3b-2] Se tolera fallback literal (`MAPA[x] || ''` en
         * UsuariosFila.tsx:80 / HostingDetalle.tsx:155) y acceso por punto
         * (`MAPA.prop` simple, sin llamada detrás). */
        const sinFallback = sinFallbackClase(trimmed);
        const subindice = /^([A-Za-z_$][\w$]*)\s*\[[^\]]+\]$/.exec(sinFallback);
        if (subindice) {
            const resueltoMapa = variables.get(subindice[1]);
            if (resueltoMapa) {
                for (const token of resueltoMapa) {
                    tokens.add(token);
                }
            }
            /* [299A-13 F3b] Mapa importado (`STATUS_CLASS[order.status]` en
             * SeccionUsuarios/UsuariosFila.tsx de NAKOMI: el Record vive en
             * api/admin-users.ts y las variables locales no lo conocen). El
             * nombre traído por import relativo se registra como referencia
             * para la unión post-hoc (fase 2 del scan); la fase 2 añade los
             * valores del archivo que lo exporta. Referencias a nombres no
             * importados se ignoran (fail-closed: podría ser un global). */
            else if (importsPropios?.has(subindice[1])) {
                referenciasMapa?.add(subindice[1]);
            }
        } else {
            const punto = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(sinFallback);
            if (punto) {
                resolverAccesoPuntoMapa(punto[1], variables, tokens, importsPropios, referenciasMapa);
            }
        }
        for (const literal of extraerLiterales(body)) {
            addClassTokens(literal, tokens, familyPrefixes, contextoAttr);
        }
    }
}

/* [318A-7V3] Si una cadena con punto interpolada en un className template
 * coincide exactamente con el sujeto de un switch del mismo archivo, los
 * literales de sus case son las clases aplicadas en runtime. */
export function resolverSwitchTemplate(template: string, source: string, tokens: Set<string>): void {
    const { expresiones } = descomponerTemplate(template);
    const cadenas = new Set<string>();
    for (const body of expresiones) {
        const trimmed = body.trim();
        if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(trimmed)) {
            cadenas.add(trimmed);
        }
    }
    if (cadenas.size === 0) {
        return;
    }
    REGEX_SWITCH_SUBJECT.lastIndex = 0;
    let subjectMatch: RegExpExecArray | null;
    while ((subjectMatch = REGEX_SWITCH_SUBJECT.exec(source)) !== null) {
        if (!isCodeMatch(source, subjectMatch.index) || !cadenas.has(subjectMatch[1])) {
            continue;
        }
        REGEX_SWITCH_CASE.lastIndex = 0;
        let caseMatch: RegExpExecArray | null;
        while ((caseMatch = REGEX_SWITCH_CASE.exec(source)) !== null) {
            if (caseMatch.index < subjectMatch.index) {
                continue;
            }
            tokens.add(caseMatch[1]);
        }
        break;
    }
}
