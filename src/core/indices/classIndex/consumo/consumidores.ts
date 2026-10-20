/* [V6] Partición de classIndexBuilder.ts: tokens de consumidores (JSX, HTML y strings). Sin cambio de comportamiento. */
import { REGEX_CLASS_FACTORY, REGEX_CLASS_LIST, REGEX_CREATE_ELEMENT_CLASS, REGEX_EL_FACTORY, REGEX_EXTERNAL_LINK_CLASS, REGEX_SET_ATTRIBUTE_CLASS, regexesPortadoras } from '../constantes';
import { detectarCarriersMismoArchivo, escanearAsignacionesCompuestas, escanearPushs, escanearReturns } from '../fuentes/carriers';
import { recopilarDeclaraciones } from '../fuentes/declaraciones';
import { escanearDeclaraciones, extraerNombresImportadosRelativos, finObjetoLiteral } from '../fuentes/mapasJs';
import { descomponerTemplate, esNombrePortadorClase, finTemplateLiteral } from '../plantillas/plantillas';
import { addTemplateClassTokens, resolverSwitchTemplate } from '../plantillas/resolucionTemplate';
import { agregarClasesExactas, resolverExpresionClase, resolverExpresionClaseExacta } from './expresiones';
import { resolverConstruccionHtml } from './htmlYExclusiones';
import { dividirArgumentosLlamada, resolverLlamadaMapper } from './llamadas';
import { addClassTokens, addDeclarationClassTokens, addQuotedClassTokens, normalizarValorLiteral, previousCodeCharacter } from './tokens';

import { isCodeMatch, removeComments } from './textoCodigo';
export { isCodeMatch, isInsideString, removeComments } from './textoCodigo';

/* [G1] Los prefijos portadores son obligatorios: los pasa la raíz (convención del área). */
export function extraerTokensDeTexto(texto: string, tokens: Set<string>, familyPrefixes: Set<string> | undefined, referenciasMapa: Set<string> | undefined, llamadasClaseFuera: Set<string> | undefined, prefijos: readonly string[]): void {
    const source = removeComments(texto);
    const re = regexesPortadoras(prefijos);
    let match: RegExpExecArray | null;
    /* [J-8] La indirección requiere conocer las declaraciones antes de
     * resolver los usos (className={ident}). Se recopila una vez por archivo. */
    const variables = recopilarDeclaraciones(source, familyPrefixes, prefijos);
    /* [299A-13 F3b] Nombres traídos por import relativo: permiten distinguir
     * un mapa importado (`STATUS_CLASS` de otro archivo) de un global
     * desconocido al registrar referencias para la fase 2. */
    const importsPropios = extraerNombresImportadosRelativos(source);

    re.attr.lastIndex = 0;
    while ((match = re.attr.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        for (const clase of match[1].split(/\s+/)) {
            if (clase.length > 1) {
                tokens.add(clase);
            }
        }
    }

    re.templateInicio.lastIndex = 0;
    while ((match = re.templateInicio.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        /* [318A-7V18] El match termina en el backtick de apertura; el cierre
         * se halla con el escáner balanceado (soporta templates anidados y
         * post-procesado como `.trim()` tras el backtick de cierre). */
        const apertura = match.index + match[0].length - 1;
        const cierre = finTemplateLiteral(source, apertura);
        if (cierre < 0) {continue;}
        const valor = source.slice(apertura + 1, cierre);
        /* contextoAttr=true: el contenido de un template en atributo de clase
         * ES una cadena de clases por construcción (regla V18). */
        addTemplateClassTokens(valor, variables, tokens, familyPrefixes, true, importsPropios, referenciasMapa);
        resolverSwitchTemplate(valor, source, tokens);
        /* [318A-7V20] RC-3: mapper llamado dentro del template de clase
         * (`etiqueta ${obtenerClasePrioridad(p)}` en ListaProyectos.tsx). */
        for (const exp of descomponerTemplate(valor).expresiones) {
            resolverLlamadaMapper(exp, source, tokens, importsPropios, referenciasMapa, llamadasClaseFuera);
        }
    }

    /* [J-8] className={cond ? 'a' : 'b'} y className={'a b'}: expresiones
     * JSX con literales o identificadores indirectos. */
    re.jsxExpr.lastIndex = 0;
    while ((match = re.jsxExpr.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        resolverExpresionClase(match[1], variables, tokens, familyPrefixes, importsPropios, referenciasMapa);
        resolverLlamadaMapper(match[1], source, tokens, importsPropios, referenciasMapa, llamadasClaseFuera);
    }

    /* [15A-25] Plantillas dentro de una expresion de clase. El regex de arriba
     * se corta en la primera llave y una interpolacion la contiene: en
     * `className={on ? `tarjetaMetaBadgeClickable${extra}` : undefined}`
     * (BadgesMetadata.tsx:109) solo llegaba el fragmento previo, sin backtick de
     * cierre, y la familia no se registraba: `.tarjetaMetaBadgeClickable` salia
     * huerfana. Aqui el atributo se delimita balanceando llaves y se recorren
     * las plantillas COMPLETAS que contenga, con el mismo tratamiento que la
     * plantilla de clase directa (contextoAttr: su contenido es una cadena de
     * clases por construccion). */
    re.atributoClase.lastIndex = 0;
    while ((match = re.atributoClase.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const aperturaAtributo = match.index + match[0].length - 1;
        const cierreAtributo = finObjetoLiteral(source, aperturaAtributo);
        if (cierreAtributo < 0) {continue;}
        for (let cursor = aperturaAtributo + 1; cursor < cierreAtributo; cursor++) {
            if (source[cursor] !== '`') {continue;}
            const finPlantilla = finTemplateLiteral(source, cursor);
            if (finPlantilla < 0) {break;}
            addTemplateClassTokens(source.slice(cursor + 1, finPlantilla), variables, tokens, familyPrefixes, true, importsPropios, referenciasMapa);
            cursor = finPlantilla;
        }
    }

    re.object.lastIndex = 0;
    while ((match = re.object.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous !== '{' && previous !== ',') {continue;}
        /* Las props *clase en objetos ({ claseAdicional: x }) son portadoras
         * de clase: contextoAttr true (regla V18). */
        addClassTokens(match[1] ?? match[2] ?? '', tokens, familyPrefixes, true);
    }

    /* [318A-7V21] RC-4: `className: clases.join(' ')` (vanilla DOM factory)
     * resuelve el identificador por indirección; los push del carrier ya
     * quedaron fusionados al set en recopilarDeclaraciones. */
    re.objectVar.lastIndex = 0;
    while ((match = re.objectVar.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous !== '{' && previous !== ',') {continue;}
        resolverExpresionClase(match[1], variables, tokens, familyPrefixes, importsPropios, referenciasMapa);
    }

    REGEX_CLASS_FACTORY.lastIndex = 0;
    while ((match = REGEX_CLASS_FACTORY.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous && !/[=(,:]/.test(previous)) {continue;}
        addClassTokens(match[1], tokens);
    }

    /* [J-8] createElement(tag, 'clase') posicional: el segundo argumento es
     * la clase (o un ternario de literales / identificador indirecto). */
    REGEX_CREATE_ELEMENT_CLASS.lastIndex = 0;
    while ((match = REGEX_CREATE_ELEMENT_CLASS.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        resolverExpresionClase(match[1], variables, tokens, familyPrefixes, importsPropios, referenciasMapa);
        resolverLlamadaMapper(match[1], source, tokens, importsPropios, referenciasMapa, llamadasClaseFuera);
    }

    /* [318A-7V23] el(tag, cls) posicional (ver REGEX_EL_FACTORY): el 2º
     * argumento porta la clase por el MISMO pipeline que createElement
     * (literales, ternarios/concat, templates con ${} e identificadores por
     * indirección). El divisor balanceado sustituye a `([^)]*)` para no
     * tronchar args multilínea o con paréntesis internos. */
    REGEX_EL_FACTORY.lastIndex = 0;
    while ((match = REGEX_EL_FACTORY.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previo = previousCodeCharacter(source, match.index);
        /* Solo `x.el(` (método) o `$el(` (otra función) se excluyen: el `\b`
         * del regex ya impide el pegado a identificador (`panel(` no casa),
         * pero previousCodeCharacter salta blancos y vería la 'n' de
         * `return el(` — un guard [\w] rechazaría TODAS las llamadas en
         * posición de sentencia/return. */
        if (previo === '.' || previo === '$') {continue;}
        const args = dividirArgumentosLlamada(source, match.index + match[0].length - 1);
        if (!args || args.length < 2) {continue;}
        /* 1er argumento tag literal ('div'): con tag dinámico u otra
         * semántica del mismo nombre, fuera por diseño (ver regex). */
        if (!/^\s*['"][A-Za-z][\w-]*['"]\s*$/.test(args[0])) {continue;}
        resolverExpresionClase(args[1], variables, tokens, familyPrefixes, importsPropios, referenciasMapa);
        resolverLlamadaMapper(args[1], source, tokens, importsPropios, referenciasMapa, llamadasClaseFuera);
    }

    /* [318A-7V23] Call-sites de carriers del mismo archivo (ver
     * detectarCarriersMismoArchivo): los literales string en posiciones
     * portadoras son las clases que el runtime aplica
     * (`crearStat('+', n, 'git-adiciones')`). Solo literales (quoted o
     * template); un ident/boolean/número nunca se indexa. Las definiciones
     * casan el mismo patrón pero sus parámetros son idents y no aportan, así
     * que la regla es uniformemente segura sin distinguir def de llamada. */
    const carriers = detectarCarriersMismoArchivo(source);
    if (carriers.size > 0) {
        const reLlamadaCarrier = /\b([A-Za-z_$][\w$]*)\s*\(/g;
        while ((match = reLlamadaCarrier.exec(source)) !== null) {
            const posiciones = carriers.get(match[1]);
            if (!posiciones || !isCodeMatch(source, match.index)) {continue;}
            /* Igual que en el loop el(): solo '.' o '$' excluyen; un [\w]
             * rechazaría `return crearStat(...)` (previo 'n' tras el salto). */
            const previoLlamada = previousCodeCharacter(source, match.index);
            if (previoLlamada === '.' || previoLlamada === '$') {continue;}
            const argsLlamada = dividirArgumentosLlamada(source, match.index + match[0].length - 1);
            if (!argsLlamada) {continue;}
            for (const pos of posiciones) {
                const arg = (argsLlamada[pos] ?? '').trim();
                if (/^(['"])[\s\S]*\1$/.test(arg)) {
                    addClassTokens(arg.slice(1, -1), tokens, familyPrefixes, true);
                } else if (arg.startsWith('`') && arg.endsWith('`') && arg.length >= 2) {
                    addTemplateClassTokens(arg.slice(1, -1), variables, tokens, familyPrefixes, true, importsPropios, referenciasMapa);
                }
            }
        }
    }

    REGEX_EXTERNAL_LINK_CLASS.lastIndex = 0;
    while ((match = REGEX_EXTERNAL_LINK_CLASS.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        const previous = previousCodeCharacter(source, match.index);
        if (previous && !/[=(,:]/.test(previous)) {continue;}
        addClassTokens(match[1], tokens);
    }

    REGEX_CLASS_LIST.lastIndex = 0;
    while ((match = REGEX_CLASS_LIST.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index) || previousCodeCharacter(source, match.index) !== '.') {continue;}
        resolverExpresionClase(match[1], variables, tokens, familyPrefixes, importsPropios, referenciasMapa);
        resolverLlamadaMapper(match[1], source, tokens, importsPropios, referenciasMapa, llamadasClaseFuera);
    }

    /* [318A-7V23] setAttribute('class', <expr>) directo: la vía de ATRIBUTO
     * (className=/class=) no casa con llamadas, y la vía carrier solo cubre
     * indirecciones. Mismo pipeline que classList (GH entradaContexto.ts:39:
     * `circuloFondo.setAttribute('class', 'ctx-pista')`; iconos.ts:93: la
     * concat `'ic' + (pequeno ? ' ic-xs' : '') + ...` aporta sus literales). */
    REGEX_SET_ATTRIBUTE_CLASS.lastIndex = 0;
    while ((match = REGEX_SET_ATTRIBUTE_CLASS.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        /* setAttribute es método (`x.setAttribute(`): el '.' previo es lo
         * normal y se admite; solo '$' ($setAttribute) excluye. El match
         * termina en la coma tras 'class', así que el '(' se busca hacia
         * adelante (no es match.index + len - 1 como en el(), cuyo match
         * termina en el paréntesis). */
        if (previousCodeCharacter(source, match.index) === '$') {continue;}
        const aperturaAttr = source.indexOf('(', match.index);
        if (aperturaAttr < 0) {continue;}
        const argsAttr = dividirArgumentosLlamada(source, aperturaAttr);
        if (!argsAttr || argsAttr.length < 2) {continue;}
        resolverExpresionClase(argsAttr[1], variables, tokens, familyPrefixes, importsPropios, referenciasMapa);
        resolverLlamadaMapper(argsAttr[1], source, tokens, importsPropios, referenciasMapa, llamadasClaseFuera);
    }

    for (const declaracion of escanearDeclaraciones(source)) {
        const esCarrier = esNombrePortadorClase(declaracion.nombre, prefijos);
        if (!esCarrier) {
            continue;
        }
        if (!isCodeMatch(source, declaracion.indice)) {continue;}
        const previous = previousCodeCharacter(source, declaracion.indice);
        if (previous && /[\w'"`]/.test(previous)) {continue;}
        /* [299A-13 F5] contextoAttr=true: la declaración ya es portadora por
         * nombre; sus templates registran familia (boton/input/textarea). */
        addDeclarationClassTokens(declaracion.valor, tokens, familyPrefixes, true);
        /* [149A-1 F3.11] className/contentClass compuestos: el mapa ya esta
         * completo aqui (todas las declaraciones del archivo). */
        agregarClasesExactas(resolverExpresionClaseExacta(normalizarValorLiteral(declaracion.valor), variables), tokens);
    }
    /* [318A-7V20] RC-1: compuestos de carriers (*clase, className, contentClass)
     * emiten directo al archivo; recopilarDeclaraciones ya los fusionó al set
     * de la variable para la vía de indirección className={clase}. */
    for (const compuesto of escanearAsignacionesCompuestas(source)) {
        const esCarrierCompuesto = esNombrePortadorClase(compuesto.nombre, prefijos);
        if (!esCarrierCompuesto || !isCodeMatch(source, compuesto.indice)) {
            continue;
        }
        addQuotedClassTokens(compuesto.valor, tokens, familyPrefixes, true);
    }
    /* [318A-7V21] RC-4: `clases.push('...')` sobre un carrier emite directo
     * al archivo (misma regla que los compuestos); el set para indirección ya
     * se fusionó en recopilarDeclaraciones. */
    for (const push of escanearPushs(source)) {
        const esCarrierPush = esNombrePortadorClase(push.nombre, prefijos);
        if (!esCarrierPush || !isCodeMatch(source, push.indice)) {
            continue;
        }
        addQuotedClassTokens(push.valor, tokens, familyPrefixes, true);
    }

    /* [318A-7V22][M4] Construcción de HTML en runtime: templates que
     * ensamblan markup (`html += '<h${n} class="...">...'`, innerHTML,
     * createElement con html). El literal `class="..."` dentro de un template
     * ES una cadena de clases por construcción, aunque no sea un atributo de
     * componente React. Cubre (useScratchpad.ts:82/94 de un proyecto real):
     *   `<h${nivel} class="scratchpadVistaPreviaTitulo scratchpadVistaPreviaTitulo--h${nivel}">`
     *   `<li><span class="scratchpadVistaPreviaChecklist">${marcado}</span>`
     * El segmento estático se tokeniza entero (base + clase literal), y la
     * familia pegada a la interpolación (--h) la registra registrarPrefijosFamilia
     * con contextoAttr=true (forma de clase válida). El HTML se suele acumular
     * con `html +=` (asignación compuesta) o declararse en `const x =`; se
     * recorren ambas vías. */
    for (const declaracion of escanearDeclaraciones(source)) {
        if (!isCodeMatch(source, declaracion.indice)) {continue;}
        const previo = previousCodeCharacter(source, declaracion.indice);
        if (previo && /[\w'"`]/.test(previo)) {continue;}
        resolverConstruccionHtml(declaracion.valor, variables, tokens, familyPrefixes, importsPropios, referenciasMapa);
    }
    for (const compuesto of escanearAsignacionesCompuestas(source)) {
        if (!isCodeMatch(source, compuesto.indice)) {continue;}
        resolverConstruccionHtml(compuesto.valor, variables, tokens, familyPrefixes, importsPropios, referenciasMapa);
    }
    /* [318A-7V23] returns y push con HTML: `return \`<span
     * class="resumen">...\`` (mensajesUtil.ts:44/51-52 de GH) y
     * `cuerpo.push(\`<span class="${clase}">...\`)` (:40) ensamblan markup en
     * posiciones que ni declaraciones ni `+=` cubren; el literal `class="..."`
     * dentro del template ES cadena de clases por construcción (regla M4). */
    for (const retorno of escanearReturns(source)) {
        if (!isCodeMatch(source, retorno.indice)) {continue;}
        resolverConstruccionHtml(retorno.valor, variables, tokens, familyPrefixes, importsPropios, referenciasMapa);
    }
    for (const push of escanearPushs(source)) {
        if (!isCodeMatch(source, push.indice)) {continue;}
        resolverConstruccionHtml(push.valor, variables, tokens, familyPrefixes, importsPropios, referenciasMapa);
    }
}
