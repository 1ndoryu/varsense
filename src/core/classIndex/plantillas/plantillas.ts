/* [V6] Partición de classIndexBuilder.ts: plantillas de clase, familias de prefijos y portadores. Sin cambio de comportamiento. */
import { addClassTokens } from '../consumo/tokens';

/* [318A-7V22][M2] Compone los tokens de templates que interpolan variables
 * locales ya declaradas con valor de clase: `const claseBase =
 * 'itemNotificacion'; const claseLeida = notif.leida ? \`${claseBase}--leida\`
 * : ''` (ItemNotificacion.tsx:77). En runtime el template concatena el
 * literal de la variable con el segmento estático pegado → `itemNotificacion--
 * leida`. addClassTokens no compone (descarta el `${ident}` por no ser
 * literal); aquí, si TODAS las interpolaciones del template son identificadores
 * puros con set en `variables`, se genera el producto acotado segmento +
 * token + segmento. Guard: el token compuesto debe tener FORMA de clase (BEM
 * `--`, CamelCase/dígito); una palabra minúscula (prosa: `archivo${x}s`) no
 * pasa, reteniendo el contrato de no inventar familias. */
export function resolverTemplatesDeVariables(
    valor: string,
    variables: Map<string, Set<string>>,
    destino: Set<string>
): void {
    for (const literal of extraerLiterales(valor)) {
        if (!literal.includes('${')) {
            continue;
        }
        const { segmentos, expresiones } = descomponerTemplate(literal);
        if (expresiones.length === 0) {
            continue;
        }
        const conjuntos: Array<Set<string>> = [];
        let combinaciones = 1;
        let resoluble = true;
        for (const expr of expresiones) {
            const ident = expr.trim();
            if (!/^[A-Za-z_$][\w$]*$/.test(ident)) {
                resoluble = false;
                break;
            }
            const conjunto = variables.get(ident);
            if (!conjunto || conjunto.size === 0) {
                resoluble = false;
                break;
            }
            conjuntos.push(conjunto);
            combinaciones *= conjunto.size;
            if (combinaciones > 64) {
                resoluble = false;
                break;
            }
        }
        if (!resoluble || conjuntos.length !== expresiones.length) {
            continue;
        }
        /* Producto cartesiano acotado: segmento_0 · token_0 · segmento_1 ·
         * token_1 · ... · segmento_n. */
        let resultados = [''] as string[];
        for (let e = 0; e < expresiones.length; e++) {
            const siguientes: string[] = [];
            for (const base of resultados) {
                for (const token of conjuntos[e]) {
                    siguientes.push(base + token + segmentos[e + 1]);
                }
            }
            /* El primer segmento (antes de la primera interpolación) se aplica
             * al inicio. */
            if (e === 0) {
                resultados = siguientes.map(s => segmentos[0] + s);
            } else {
                resultados = siguientes;
            }
        }
        for (const compuesto of resultados) {
            if (compuesto.length > 1 && /^[a-zA-Z_][\w-]*$/.test(compuesto)) {
                destino.add(compuesto);
            }
        }
    }
}

/* [318A-7V22][M3] Literales de return de una flecha AUTO-INVOCADA (IIFE) con
 * cuerpo de bloque, asignada a una variable portadora que luego se interpola
 * en un className:
 * `const claseUrgencia = (() => { if (x) return 'barraRellenoCompletado'; if
 * (p >= 80) return 'barraRellenoUrgenteCritico'; ... return ''; })();`
 * (FilaSubHabito.tsx:51-55). Cada `return <literal>` es una clase real que el
 * runtime aplica sobre la base. Sin resolver, los sufijos
 * `barraRellenoCompletado/UrgenteCritico/Urgente/Advertencia` se reportan
 * huérfanos (el valor no es string/ternario/array/objeto, así que
 * recopilarDeclaraciones no registra nada).
 * Guard anti-FN: solo se procesan flechas auto-invocadas (`})()` tras el
 * cierre del cuerpo). Una flecha NO invocada (`const C = (p) => { return
 * <div className="x"/>; }`) tiene returns JSX y no produce un string de
 * clases en runtime; si se incluyera, `x` del JSX entraría al set de una
 * variable y podría tapar una clase muerta por indirección. */
export function extraerReturnsDeIIFE(valor: string, tokens: Set<string>, familyPrefixes?: Set<string>): void {
    const reArrow = /=>\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = reArrow.exec(valor)) !== null) {
        const indiceCuerpo = match.index + match[0].length - 1;
        let profundidad = 0;
        let quote = '';
        let cierre = -1;
        for (let cursor = indiceCuerpo; cursor < valor.length; cursor++) {
            const c = valor[cursor];
            if (quote) {
                if (c === '\\') {cursor++; continue;}
                if (c === quote) {quote = '';}
                continue;
            }
            if (c === '"' || c === "'" || c === '`') {quote = c; continue;}
            if (c === '{') {profundidad++;}
            else if (c === '}') {
                profundidad--;
                if (profundidad === 0) {cierre = cursor; break;}
            }
        }
        if (cierre < 0) {
            continue;
        }
        const restoTrasCierre = valor.slice(cierre + 1);
        if (!/^\s*\)\s*\(\s*\)/.test(restoTrasCierre)) {
            reArrow.lastIndex = cierre + 1;
            continue;
        }
        const cuerpo = valor.slice(indiceCuerpo + 1, cierre);
        const reReturn = /\breturn\b/g;
        while (reReturn.exec(cuerpo) !== null) {
            const resto = cuerpo.slice(reReturn.lastIndex);
            const literales = extraerLiterales(resto);
            if (literales.length > 0) {
                addClassTokens(literales[0], tokens, familyPrefixes);
            }
            const finStatement = resto.indexOf(';');
            if (finStatement < 0) {
                break;
            }
            reReturn.lastIndex = reReturn.lastIndex + finStatement + 1;
        }
        reArrow.lastIndex = cierre + 1;
    }
}

/* [318A-7V5] Extracción de literales por pares de comillas. El regex de
 * agrupación anterior (['"`]([^'"`$]+)['"`]) falla con literales vacíos
 * seguidos de más texto: `: ''\n , estaX ? 'claseReal'` toma la comilla de
 * cierre del vacío como apertura y se traga la clase real, emitiendo en su
 * lugar el identificador (VistaCelda.tsx de PT). El escaneo respeta pares,
 * escapes y el contenido de templates con ${...}. */
export function extraerLiterales(value: string): string[] {
    const literales: string[] = [];
    for (let index = 0; index < value.length; index++) {
        const current = value[index];
        if (current !== "'" && current !== '"' && current !== '`') {
            continue;
        }
        const quote = current;
        let contenido = '';
        index++;
        for (; index < value.length; index++) {
            const c = value[index];
            if (c === '\\') {
                contenido += c;
                if (index + 1 < value.length) {
                    contenido += value[index + 1];
                    index++;
                }
                continue;
            }
            if (c === quote) {
                break;
            }
            contenido += c;
        }
        literales.push(contenido);
    }
    return literales;
}
/* [318A-7V14] Prefijo de familia de template literal. Un token estático
 * PEGADO a una interpolación (`badgeInfo--${variante}`, `selectorNivelBoton${sufijo}`,
 * `boton--${variante}`) marca como EN-USO toda la familia de clases cuyo
 * nombre empiece por ese prefijo: el sufijo se emite en runtime desde una
 * unión/mapa que indexar literalmente exigiría resolver tipos (verificado
 * en VAR-4: BadgeInfo.tsx, SelectorNivel.tsx, Boton.tsx). Solo cuenta el
 * token pegado (sin espacio previo): una interpolación separada por espacio
 * (`estadoViabilidad ${viabilidad.estado}`) aporta la clase COMPLETA, no una
 * familia — esa vía ya la resuelven las variables/switch. Nunca marca clases
 * fuera de la familia ni exime el reporte de un token exacto.*/
/* [318A-7V18] Escáner balanceado de templates/interpolaciones: el regex
 * `\$\{[^}]*\}` y el `[^`]+` plano se rompen con templates ANIDADOS
 * (interpolación cuyo cuerpo contiene otro template: SelectorNivel.tsx:39,
 * ModalExperimentos.tsx) — se cortan en el `}`/backtick INTERIOR y el resto
 * queda sin tokenizar (clases literales y familias perdidas). Estos
 * escáneres recorren char a char respetando escapes, strings, llaves
 * anidadas, comentarios de código y templates anidados dentro de ${...}. */
export function finExpresion(source: string, indiceLlave: number): number {
    let i = indiceLlave + 1;
    let quote = '';
    let profundidad = 1;
    while (i < source.length) {
        const c = source[i];
        if (quote) {
            if (c === '\\') {i += 2; continue;}
            if (c === quote) {quote = '';}
            i++;
            continue;
        }
        if (c === '"' || c === "'") {quote = c; i++; continue;}
        if (c === '`') {
            const cierre = finTemplateLiteral(source, i);
            if (cierre < 0) {return -1;}
            i = cierre + 1;
            continue;
        }
        if (c === '/') {
            const siguiente = source[i + 1];
            if (siguiente === '/') {while (i < source.length && source[i] !== '\n') {i++;} continue;}
            if (siguiente === '*') {
                const fin = source.indexOf('*/', i + 2);
                i = fin < 0 ? source.length : fin + 2;
                continue;
            }
        }
        if (c === '{') {profundidad++;}
        else if (c === '}') {
            profundidad--;
            if (profundidad === 0) {return i;}
        }
        i++;
    }
    return -1;
}

export function finTemplateLiteral(source: string, indiceApertura: number): number {
    let i = indiceApertura + 1;
    while (i < source.length) {
        const c = source[i];
        if (c === '\\') {i += 2; continue;}
        if (c === '`') {return i;}
        if (c === '$' && source[i + 1] === '{') {
            const cierre = finExpresion(source, i + 1);
            if (cierre < 0) {return -1;}
            i = cierre + 1;
            continue;
        }
        i++;
    }
    return -1;
}

/* Separa el contenido de un template (sin backticks) en segmentos estáticos
 * y cuerpos de interpolación BALANCEADOS (nested templates incluidos). */
export function descomponerTemplate(valor: string): { segmentos: string[]; expresiones: string[] } {
    const segmentos: string[] = [];
    const expresiones: string[] = [];
    let inicio = 0;
    let i = 0;
    while (i < valor.length) {
        if (valor[i] === '$' && valor[i + 1] === '{') {
            segmentos.push(valor.slice(inicio, i));
            const cierre = finExpresion(valor, i + 1);
            if (cierre < 0) {
                segmentos.push(valor.slice(i));
                return { segmentos, expresiones };
            }
            expresiones.push(valor.slice(i + 2, cierre));
            i = cierre + 1;
            inicio = i;
        } else {
            i++;
        }
    }
    segmentos.push(valor.slice(inicio));
    return { segmentos, expresiones };
}

/* [318A-7V14] Prefijo de familia de template literal. Un token estático
 * PEGADO a una interpolación (`badgeInfo--${variante}`, `selectorNivelBoton${sufijo}`,
 * `boton--${variante}`) marca como EN-USO toda la familia de clases cuyo
 * nombre empiece por ese prefijo: el sufijo se emite en runtime desde una
 * unión/mapa que indexar literalmente exigiría resolver tipos (verificado
 * en VAR-4: BadgeInfo.tsx, SelectorNivel.tsx, Boton.tsx). Solo cuenta el
 * token pegado (sin espacio previo): una interpolación separada por espacio
 * (`estadoViabilidad ${viabilidad.estado}`) aporta la clase COMPLETA, no una
 * familia — esa vía ya la resuelven las variables/switch. Nunca marca clases
 * fuera de la familia ni exime el reporte de un token exacto.
 * [318A-7V18] contextoAttr: dentro de un atributo className/class/*clase el
 * contenido del template ES una cadena de clases por construcción, así que
 * el guard de prosa (V17) solo aplica a declaraciones/cadenas fuera de
 * atributos (` archivo${...}`, `recordatorio${...}` de TareaBadges). Un
 * prefijo pegado en minúsculas dentro de un atributo (`item-${x}`) es una
 * familia real. */
export function registrarPrefijosFamilia(value: string, familyPrefixes: Set<string>, contextoAttr = false): void {
    if (!value.includes('${')) {
        return;
    }
    const { segmentos } = descomponerTemplate(value);
    /* Cada segmento salvo el último termina donde arranca la interpolación. */
    for (let i = 0; i < segmentos.length - 1; i++) {
        const segmento = segmentos[i];
        /* [318A-7V17] La familia es el token PEGADO al `${`, no el segmento
         * completo: `badgeInfo badgeInfo--${variante}` (BadgeInfo.tsx:34)
         * comparte segmento con otra clase literal y seguiría siendo una
         * familia válida `badgeInfo--`. Tomar el último run sin whitespace. */
        const ultimoRun = segmento.match(/([A-Za-z_][\w-]*)$/);
        if (!ultimoRun) {
            continue;
        }
        const ultimo = ultimoRun[1];
        if (ultimo.length <= 2) {
            continue;
        }
        /* Guard de prosa (fuera de atributos): `recordatorio${n > 1 ? 's' : ''}`,
         * ` archivo${...}`/` adjunto${...}` (TareaBadges.tsx:143,
         * usePanelRecordatorios.ts:141) interpolan PALABRAS en minúscula sin
         * guion; solo tokens con forma de clase (BEM `--` o CamelCase/dígito)
         * son familias. Verificado: `adjunto` absorbía
         * `adjuntosAreaCarga--bloqueado` (huérfana real sin consumidor). */
        if (!contextoAttr && !ultimo.endsWith('--') && !/[A-Z0-9]/.test(ultimo)) {
            continue;
        }
        familyPrefixes.add(ultimo);
    }
}

/* [299A-13 F5] Nombre portador de clases: className/contentClass o cualquier
 * identificador que empiece por un prefijo configurado (con 'clase': claseVariante,
 * claseTamano, clases...). Convención del design system del área (ver bloque V2): una
 * declaración con este nombre contiene clases por construcción, así que sus
 * templates registran familia con contextoAttr=true aunque vivan fuera de un
 * atributo (`const claseVariante = `boton${...}`` en Button.tsx:19 de NAKOMI,
 * consumido luego en className: sin esto, `boton` nunca era familia y
 * botonPrimario/botonMediano se reportaban). Fuente única para los tres
 * gates de emisión (declaraciones, compuestos, push). Exportada para tests. */
export function esNombrePortadorClase(nombre: string, prefijos: readonly string[] = []): boolean {
    if (nombre === 'className' || nombre === 'contentClass') {
        return true;
    }
    /* Cada prefijo cuenta en minuscula y con la inicial en mayuscula (clase -> Clase). */
    return prefijos.some(prefijo => prefijo !== '' && (nombre.startsWith(prefijo) || nombre.startsWith(prefijo.charAt(0).toUpperCase() + prefijo.slice(1))));
}
