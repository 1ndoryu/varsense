/* [V6] Partición de classIndexBuilder.ts: recopilación de declaraciones de variables con clases. Sin cambio de comportamiento. */
import { isCodeMatch } from '../consumo/consumidores';
import { agregarClasesExactas, resolverExpresionClaseExacta } from '../consumo/expresiones';
import { pareceTernarioDeLiterales } from '../consumo/llamadas';
import { addClassTokens, addQuotedClassTokens, normalizarValorLiteral, previousCodeCharacter, resolverFragmentosDeArray } from '../consumo/tokens';
import { esNombrePortadorClase, extraerReturnsDeIIFE, resolverTemplatesDeVariables } from '../plantillas/plantillas';
import { escanearAsignacionesCompuestas, escanearPushs } from './carriers';
import { escanearDeclaraciones, extraerValoresDeMapaClase } from './mapasJs';

export function recopilarDeclaraciones(source: string, familyPrefixes: Set<string> | undefined, prefijos: readonly string[]): Map<string, Set<string>> {
    const variables = new Map<string, Set<string>>();

    for (const declaracion of escanearDeclaraciones(source)) {
        if (!isCodeMatch(source, declaracion.indice)) {
            continue;
        }
        const previous = previousCodeCharacter(source, declaracion.indice);
        if (previous && /[\w'"`]/.test(previous)) {
            continue;
        }
        const nombre = declaracion.nombre;
        /* className/contentClass se resuelven aparte (ver extraerTokensDeTexto). */
        if (nombre === 'className' || nombre === 'contentClass') {
            continue;
        }
        const valor = normalizarValorLiteral(declaracion.valor);
        const tokensVariable = new Set<string>();
        /* [299A-13 F5] Una declaración portadora (`const claseVariante =
         * `boton${...}``) registra su familia con contexto de clase aunque
         * el template viva fuera de un atributo. Vale para las tres formas
         * de valor (literal, ternario, array). */
        const contextoPortador = esNombrePortadorClase(nombre, prefijos);
        if (/^(['"`])[\s\S]*\1$/.test(valor)) {
            addClassTokens(valor.slice(1, -1), tokensVariable, familyPrefixes, contextoPortador);
            addQuotedClassTokens(valor, tokensVariable, familyPrefixes, contextoPortador);
        } else if (valor.startsWith('[') && valor.endsWith(']')) {
            /* [15A-25] El array va ANTES que el ternario: `pareceTernarioDeLiterales`
             * es un `?` seguido de comilla en cualquier posicion, asi que un array
             * con un elemento ternario (`['badge', mapaVariante[variante], estilo ===
             * 'borde' ? 'badgeBorde' : '']`) se clasificaba como ternario y sus
             * subindices sobre mapas locales no se resolvian: badgeXs, badgeNeutro,
             * tamanoMd... salian huerfanas. El guardia de cierre `]` mantiene el
             * ternario en su rama cuando la condicion es la que empieza por array
             * (`[a, b].includes(x) ? 'y' : 'z'`). */
            addQuotedClassTokens(valor, tokensVariable, familyPrefixes, contextoPortador);
            resolverFragmentosDeArray(valor, variables, tokensVariable);
        } else if (pareceTernarioDeLiterales(valor)) {
            addQuotedClassTokens(valor, tokensVariable, familyPrefixes, contextoPortador);
        } else if (valor.trim().startsWith('{')) {
            /* [318A-7V22][M1] Mapa/objeto literal de clases: una variable
             * tipada como Record<Tipo, string> cuyos valores son clases
             * (PanelRecordatorios.tsx:19 `CLASES_FUENTE:
             * Record<TamanoFuenteRecordatorio, string> = { pequeno:
             * 'recordatoriosTexto--pequeno', normal: '', grande:
             * 'recordatoriosTexto--grande' }` indexado en :91 por
             * `CLASES_FUENTE[config.tamanoFuente]`). Se registra la variable
             * con TodoS sus valores con forma de clase; el subíndice
             * M[clave] en un atributo de clase resuelve el set completo
             * (todas las claves del Record son alcanzables en runtime). Los
             * valores vacíos ('') se ignoran (no son clase). */
            for (const valorClase of extraerValoresDeMapaClase(valor)) {
                if (valorClase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(valorClase)) {
                    tokensVariable.add(valorClase);
                }
            }
        } else if (/^\s*\(\s*\(?\s*\)?\s*=>\s*\{/.test(valor)) {
            /* [318A-7V22][M3] IIFE flecha auto-invocada asignada a una
             * variable portadora (FilaSubHabito.tsx:51: `const claseUrgencia =
             * (() => { if (...) return 'barraRellenoCompletado'; ... })();`).
             * Sus `return <literal>` son las clases que el runtime aplica;
             * se registran en el set para la vía className={ident} /
             * interpolation. Solo flechas auto-invocadas (ver guard en el
             * helper): una flecha componente NO invocada no produce un
             * string de clases. */
            extraerReturnsDeIIFE(valor, tokensVariable, familyPrefixes);
        }
        /* [318A-7V22][M2] Templates que interpolan variables locales ya
         * declaradas: `const claseLeida = notif.leida ? \`${claseBase}--leida\`
         * : ''` con `const claseBase = 'itemNotificacion'`
         * (ItemNotificacion.tsx:77). El template compone literal + token en
         * runtime; se resuelve contra el set ya recopilado de la variable
         * interpolada (orden de declaración garantiza que la base precede a
         * su consumidora). Sin resolver, el set de claseLeida queda sin la
         * clase compuesta y `itemNotificacion--leida` se reporta huérfana. */
        resolverTemplatesDeVariables(valor, variables, tokensVariable);
        /* [149A-1 F3.11] expresiones compuestas ('a-' + v, ternarios con
         * templates) contra declaraciones previas del mismo archivo.
         * Complementa a M2 (casos distintos, mismo punto): sin esta llamada
         * caen los contratos core [149A-1] de concatenacion/ternario. */
        agregarClasesExactas(resolverExpresionClaseExacta(valor, variables), tokensVariable);
        if (tokensVariable.size > 0) {
            variables.set(nombre, tokensVariable);
        }
    }
    /* [318A-7V20] RC-1: asignaciones compuestas (`clase += 'x'`) componen el
     * set de una variable ya declarada como portadora (SelectorFechaCalendario
     * .tsx:75: clase += ' ...--hoy'). escanearDeclaraciones solo lee `x =`,
     * así que el literal añadido jamás llegaba al índice; aquí se fusiona al
     * set para la vía de indirección className={clase}. */
    for (const compuesto of escanearAsignacionesCompuestas(source)) {
        if (!isCodeMatch(source, compuesto.indice)) {
            continue;
        }
        const conjunto = variables.get(compuesto.nombre);
        if (conjunto) {
            addQuotedClassTokens(compuesto.valor, conjunto, familyPrefixes);
        }
    }
    /* [318A-7V21] RC-4: los push sobre carriers fusionan sus literales al set
     * de la variable (misma vía que la asignación compuesta), para que la
     * indirección className={clases} / className: clases.join(' ') los vea. */
    for (const push of escanearPushs(source)) {
        if (!isCodeMatch(source, push.indice)) {
            continue;
        }
        const conjunto = variables.get(push.nombre);
        if (conjunto) {
            addQuotedClassTokens(push.valor, conjunto, familyPrefixes);
        }
    }
    return variables;
}
