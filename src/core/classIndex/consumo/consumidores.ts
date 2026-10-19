/* [V6] Partición de classIndexBuilder.ts: tokens de consumidores (JSX, HTML y strings). Sin cambio de comportamiento. */
import { REGEX_ATRIBUTO_CLASE, REGEX_CLASS_ATTR, REGEX_CLASS_FACTORY, REGEX_CLASS_JSX_EXPR, REGEX_CLASS_LIST, REGEX_CLASS_OBJECT, REGEX_CLASS_OBJECT_VAR, REGEX_CLASS_TEMPLATE_INICIO, REGEX_CREATE_ELEMENT_CLASS, REGEX_EL_FACTORY, REGEX_EXTERNAL_LINK_CLASS, REGEX_SET_ATTRIBUTE_CLASS } from '../constantes';
import { detectarCarriersMismoArchivo, escanearAsignacionesCompuestas, escanearPushs, escanearReturns } from '../fuentes/carriers';
import { recopilarDeclaraciones } from '../fuentes/declaraciones';
import { escanearDeclaraciones, extraerNombresImportadosRelativos, finObjetoLiteral } from '../fuentes/mapasJs';
import { descomponerTemplate, esNombrePortadorClase, finTemplateLiteral } from '../plantillas/plantillas';
import { addTemplateClassTokens, resolverSwitchTemplate } from '../plantillas/resolucionTemplate';
import { agregarClasesExactas, resolverExpresionClase, resolverExpresionClaseExacta } from './expresiones';
import { resolverConstruccionHtml } from './htmlYExclusiones';
import { dividirArgumentosLlamada, resolverLlamadaMapper } from './llamadas';
import { addClassTokens, addDeclarationClassTokens, addQuotedClassTokens, normalizarValorLiteral, previousCodeCharacter } from './tokens';

export function removeComments(texto: string): string {
    let result = '';
    let quote = '';
    let escaped = false;
    let comment = '';
    let regex = false;
    let inClass = false;
    let prevSig = '';
    /* [318A-7V22][M5] Un regex literal puede contener comillas o backticks
     * (`/[&<>"]/g`, `/`([^`]+)`/g` en useScratchpad.ts de PT): sin estado
     * regex, removeComments trataba esa comilla como apertura de string y
     * Todo el texto posterior del archivo quedaba "dentro de string" →
     * escanearDeclaraciones/escanearAsignacionesCompuestas saltaban los
     * `html +=` con clases reales (scratchpadVistaPrevia* seguían huérfanas)
     * por isCodeMatch. Aquí se reconoce un regex literal cuando el '/' NO va
     * precedido de algo que lo haga división (identificador, número, cierre
     * de bloque/llamada) y se consume hasta su '/' de cierre sin tratar las
     * comillas/backticks internas como strings (excepto dentro de [clase]).
     * El cuerpo del regex se conserva en la salida (es código, no comentario)
     * para no alterar índices: solo se evita que sus comillas abran string.
     * prevSig es el último carácter significativo (no-whitespace): con
     * espacios, `width / 2` sigue siendo división (prevSig='h') y no regex. */
    for (let index = 0; index < texto.length; index++) {
        const current = texto[index];
        const next = texto[index + 1] ?? '';

        if (comment === 'line') {
            result += current === '\n' ? '\n' : ' ';
            if (current === '\n') {comment = '';}
            continue;
        }
        if (comment === 'block') {
            result += current === '\n' ? '\n' : ' ';
            if (current === '*' && next === '/') {
                result += ' ';
                index++;
                comment = '';
            }
            continue;
        }

        if (regex) {
            /* Dentro de un regex literal: comillas/backticks NO abren string.
             * Se neutralizan EN LA SALIDA (emitidas como espacio, misma
             * longitud) para que los escáneres posteriores tampoco las vean
             * como apertura: `isInsideString`/`escanearAsignacionesCompuestas`
             * no conocen el estado regex y una comilla interna (`/[&<>"]/g`,
             * `/`([^`]+)`/g`) corrompía Todo el texto posterior del archivo
             * (los `html +=` con clases reales quedaban "dentro de string"). */
            result += (current === '"' || current === "'" || current === '`') ? ' ' : current;
            if (escaped) {
                escaped = false;
            } else if (current === '\\') {
                escaped = true;
            } else if (current === '[') {
                inClass = true;
            } else if (current === ']') {
                inClass = false;
            } else if (current === '/' && !inClass) {
                regex = false;
            }
            continue;
        }

        if (quote) {
            result += current;
            if (escaped) {
                escaped = false;
            } else if (current === '\\') {
                escaped = true;
            } else if (current === quote) {
                quote = '';
                prevSig = current;
            }
            continue;
        }

        if (current === '/' && next === '/') {
            result += '  ';
            index++;
            comment = 'line';
            continue;
        }
        if (current === '/' && next === '*') {
            result += '  ';
            index++;
            comment = 'block';
            continue;
        }
        /* [318A-7V22][M5] Inicio de regex literal SOLO tras un carácter que en
         * la práctica precede a un regex (whitelist): apertura de llamada/
         * array/objeto, asignación, coma, dos puntos, operadores. Un blacklist
         * era insuficiente: en TSX real el '/' de self-closing `<Tag "x" />`
         * va tras una comilla de cierre y disparaba un falso regex que se
         * tragaba el resto del archivo (medición PT 156→419). NUNCA es regex
         * tras cierre de string/comilla (`"foo" / 2` = división), `) ] }`,
         * identificador, número, `<` (cierre etiqueta JSX) ni `>`. */
        if (current === '/' && /[=(,:;!?&|[+*%~^{]/.test(prevSig)) {
            /* Se consume hasta el cierre sin abrir strings por comillas
             * internas; las comillas/backticks del interior se neutralizan en
             * la salida (emitidas como espacio, misma longitud) para que los
             * escáneres posteriores tampoco las vean como apertura
             * (`isInsideString`/`escanearAsignacionesCompuestas` no conocen el
             * estado regex: `/[&<>"]/g` y `/`([^`]+)`/g` corrompían Todo el
             * texto posterior del archivo, dejando los `html +=` con clases
             * reales "dentro de string"). */
            regex = true;
            inClass = false;
            escaped = false;
            result += current;
            continue;
        }
        if (current === '"' || current === "'" || current === '`') {
            quote = current;
        }
        result += current;
        if (!/\s/.test(current)) {
            prevSig = current;
        }
    }
    return result;
}

/* Estado de cadena en cada posición de la última fuente consultada. Se calcula una
 * sola vez por archivo: recorrer la fuente desde el principio en cada match era
 * O(matches × longitud) y dominaba el escaneo (classIndexMs). */
let fuenteMemo: string | null = null;
let mapaMemo = new Uint8Array(0);

function mapaCadenas(source: string): Uint8Array {
    if (source === fuenteMemo) {
        return mapaMemo;
    }
    const mapa = new Uint8Array(source.length + 1);
    let quote = '';
    let escaped = false;
    for (let cursor = 0; cursor < source.length; cursor++) {
        mapa[cursor] = quote ? 1 : 0;
        const current = source[cursor];
        if (quote) {
            if (escaped) {escaped = false;}
            else if (current === '\\') {escaped = true;}
            else if (current === quote) {quote = '';}
        } else if (current === '"' || current === "'" || current === '`') {
            quote = current;
        }
    }
    mapa[source.length] = quote ? 1 : 0;
    fuenteMemo = source;
    mapaMemo = mapa;
    return mapa;
}

export function isInsideString(source: string, index: number): boolean {
    /* Más allá del final, el estado es el del último carácter, igual que el recorrido anterior */
    const mapa = mapaCadenas(source);
    return mapa[Math.min(index, source.length)] === 1;
}

export function isCodeMatch(source: string, matchIndex: number): boolean {
    return !isInsideString(source, matchIndex);
}

export function extraerTokensDeTexto(texto: string, tokens: Set<string>, familyPrefixes?: Set<string>, referenciasMapa?: Set<string>, llamadasClaseFuera?: Set<string>, prefijos: readonly string[] = []): void {
    const source = removeComments(texto);
    let match: RegExpExecArray | null;
    /* [J-8] La indirección requiere conocer las declaraciones antes de
     * resolver los usos (className={ident}). Se recopila una vez por archivo. */
    const variables = recopilarDeclaraciones(source, familyPrefixes, prefijos);
    /* [299A-13 F3b] Nombres traídos por import relativo: permiten distinguir
     * un mapa importado (`STATUS_CLASS` de otro archivo) de un global
     * desconocido al registrar referencias para la fase 2. */
    const importsPropios = extraerNombresImportadosRelativos(source);

    REGEX_CLASS_ATTR.lastIndex = 0;
    while ((match = REGEX_CLASS_ATTR.exec(source)) !== null) {
        if (!isCodeMatch(source, match.index)) {continue;}
        for (const clase of match[1].split(/\s+/)) {
            if (clase.length > 1) {
                tokens.add(clase);
            }
        }
    }

    REGEX_CLASS_TEMPLATE_INICIO.lastIndex = 0;
    while ((match = REGEX_CLASS_TEMPLATE_INICIO.exec(source)) !== null) {
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
    REGEX_CLASS_JSX_EXPR.lastIndex = 0;
    while ((match = REGEX_CLASS_JSX_EXPR.exec(source)) !== null) {
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
    REGEX_ATRIBUTO_CLASE.lastIndex = 0;
    while ((match = REGEX_ATRIBUTO_CLASE.exec(source)) !== null) {
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

    REGEX_CLASS_OBJECT.lastIndex = 0;
    while ((match = REGEX_CLASS_OBJECT.exec(source)) !== null) {
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
    REGEX_CLASS_OBJECT_VAR.lastIndex = 0;
    while ((match = REGEX_CLASS_OBJECT_VAR.exec(source)) !== null) {
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
     * componente React. Cubre (useScratchpad.ts:82/94 de PT):
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
