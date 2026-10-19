/* [V6] Partición de classIndexBuilder.ts: constantes y expresiones regulares del índice. Sin cambio de comportamiento. */

export const DEFAULT_CSS_PATTERNS = ['**/*.css'];
/* [318A-7V3] Los CSS también consumen clases: un selector compuesto en otro
 * archivo (.dashboardGrid en movilBase.css refiriendo la definición de
 * base.css) prueba que la clase se aplica en runtime; borrarla cambiaría el
 * diseño. El scan() excluye el archivo de definición de cada clase (por eso
 * el extractor devuelve tokens por archivo), así una clase solo pierde su
 * reporte si aparece como selector en OTRO CSS. */
export const DEFAULT_CONSUMER_PATTERNS = [
    '**/*.tsx', '**/*.jsx',
    '**/*.ts', '**/*.js',
    '**/*.php', '**/*.html',
    '**/*.css'
];
export const DEFAULT_MIN_LENGTH = 3;
/* [318A-7V2] Props que portan clases en los design systems del área:
 * className/class más cualquier prop con nombre clase/Clase al inicio
 * (claseAdicional, claseExtra, claseContenido, claseOverlay, claseContenedor,
 * clase). Verificado repo-wide: en todos los consumidores estas props se
 * concatenan al className del componente; ninguna prop *clase es dato.
 * El patrón se reutiliza en attr/template/jsx-expr para que los tres
 * formularios de valor cubran las mismas props. */
/* Los tres patrones comparten la alternancia de props portadoras:
 * className/class, cualquier prop cuyo nombre empiece por clase/Clase y
 * [299A-13 F2] cualquier prop que termine en ClassName (panelClassName en
 * ChatBell.tsx:90 / NotificationBell.tsx:71 de NAKOMI: el valor se reenvía
 * tal cual al className del dropdown). Los formularios objeto (clase: x)
 * cubren la misma alternancia. */
export const REGEX_CLASS_ATTR = /(?:className|class|[Cc]lase[\w$]*|[\w$]*ClassName)\s*=\s*["']([^"']+)["']/g;
/* [318A-7V18] Apertura de template literal en atributo de clase:
 * className/class/*clase={...`template`...}. El scanner balanceado
 * (finTemplateLiteral/finExpresion) sustituye al regex plano [J-8]
 * porque el regex no puede con templates anidados
 * (claseAdicional={`a ${x ? `b${y}` : ''}`} en SelectorNivel/ModalExperimentos)
 * ni con post-procesado tras el cierre (className={`a ${x}`.trim()} en
 * AccionesItem). */
export const REGEX_CLASS_TEMPLATE_INICIO = /(?:className|class|[Cc]lase[\w$]*|[\w$]*ClassName)\s*=\s*\{\s*`/g;
/* [J-8] JSX/TSX className={expr} con ternarios y literales: cubre
 * className={cond ? 'a' : 'b'} y className={'a b'}. Los identificadores
 * puros se resuelven por indirección de variables (ver recopilarDeclaraciones).
 * [318A-7V2] Ídem para props *clase (claseAdicional={cond ? 'a' : 'b'}). */
export const REGEX_CLASS_JSX_EXPR = /(?:className|class|[Cc]lase[\w$]*|[\w$]*ClassName)\s*=\s*\{([^{}]*)\}/g;
/* [15A-25] Apertura de la expresion de un atributo de clase, para delimitarla
 * con el escaner balanceado (finObjetoLiteral) en vez de con `[^{}]*`, que se
 * corta en la interpolacion de un template. */
export const REGEX_ATRIBUTO_CLASE = /(?:className|class|[Cc]lase[\w$]*|[\w$]*ClassName)\s*=\s*\{/g;
/* Vanilla TS/DOM factories commonly pass classes as object attributes:
 * createEl('div', { className: 'panel panel--active' }). Keep this parser
 * framework-agnostic while covering the project's createEl contract.
 * [318A-7V3] Misma familia de props portadoras que las atribuciones
 * (verificada repo-wide): { clase: 'badgePremium' }, { claseAdicional: x } —
 * el consumidor concatena el valor al className (FilaUsuario/ResumenAdmin
 * de PT). Las props de datos (estado, tipo, texto) no casan con el patrón.
 * [318A-7V21] La alternancia admite también claves camelCase que TERMINAN
 * en Class/clase (imageClass, iconClass): el nombre es la convención del
 * carrier (AGAPE AgapeLanding.tsx:20/27/34 imageClass: 'activity-image-*'
 * interpolado en className={`activity-image ${item.imageClass}`}). Solo
 * casan claves finales: classification/classList no terminan en Class y
 * quedan fuera por diseño (son dato/método, no carrier). */
export const REGEX_CLASS_OBJECT = /(?:['"]?(?:className|class|[Cc]lase[\w$]*|[\w$]*[Cc]lass|[\w$]*ClassName)['"]?)\s*:\s*(?:['"]([^'"]+)['"]|[`]([^`]+)[`])/g;
/* [318A-7V21] RC-4: propiedad objeto con VALOR VARIABLE (`className:
 * clases.join(' ')` en notifications-popover.ts:83). La vía literal de arriba
 * no casa; aquí se captura el identificador (con su `.join(...)` opcional) y
 * se resuelve por indirección contra el mapa de declaraciones + pushs. */
export const REGEX_CLASS_OBJECT_VAR = /(?:['"]?(?:className|class|[Cc]lase[\w$]*|[\w$]*[Cc]lass|[\w$]*ClassName)['"]?)\s*:\s*([A-Za-z_$][\w$]*)(?:\s*\.\s*join\s*\([^)]*\))?\s*(?=[,}])/g;
export const REGEX_CLASS_FACTORY = /createContainer\s*\(\s*['"]([^'"]+)['"]/g;
export const REGEX_EXTERNAL_LINK_CLASS = /createExternalLink\s*\([^,]+,[^,]+,\s*['"]([^'"]+)['"]/g;
/* [J-8] createElement(tag, 'clase') posicional: Glory-Laminal pasa la clase
 * como segundo argumento (helper createElement(tag, className, text)). */
export const REGEX_CREATE_ELEMENT_CLASS = /createElement\s*\(\s*['"][^'"]+['"]\s*,\s*([^)]*)\)/g;
/* [318A-7V23] Apertura de la factoría DOM posicional el(tag, cls): el
 * micro-helper el() (GH dom.ts: `el(tag, cls?) → e.className = cls`) porta
 * clases en su 2º argumento igual que createElement [J-8]. El 2º argumento se
 * extrae con el divisor balanceado (soporta ternarios/concat multilínea y
 * templates con ${}; el regex plano [J-8] no puede con paréntesis anidados).
 * Solo cuenta con 1er argumento tag literal ('div'): un el() con tag dinámico
 * u otra semántica queda fuera por diseño (retener > arriesgar FN). */
export const REGEX_EL_FACTORY = /\bel\s*\(/g;
/* [J-8] classList.add/toggle/remove: toggle('clase', cond) y remove('clase')
 * son usos reales igual que add.
 * [318A-7V23] contains/replace: classList.contains('sel') es una lectura que
 * exige la clase en runtime igual que add (glory-harness sidebarCeldas); sin
 * esta rama la clase solo se veía si otro sink la tocaba. */
export const REGEX_CLASS_LIST = /classList\.(?:add|toggle|remove|contains|replace)\s*\(([^)]*)\)/g;
/* [318A-7V23] Apertura de setAttribute('class', ...): el 2º argumento se
 * extrae balanceado (ver loop en extraerTokensDeTexto). */
export const REGEX_SET_ATTRIBUTE_CLASS = /\bsetAttribute\s*\(\s*['"]class['"]\s*,/g;
