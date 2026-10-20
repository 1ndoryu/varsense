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

/* Escapa un texto para usarlo literal dentro de una regex */
function escaparRegex(texto: string): string {
    return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Un prefijo casa con la inicial en minúscula o mayúscula (clase -> clase|Clase)
 * seguido de cualquier identificador: clase, claseAdicional, Clase... */
function variantePrefijo(prefijo: string): string {
    const inicial = prefijo.charAt(0);
    const resto = escaparRegex(prefijo.slice(1));
    return `[${inicial.toLowerCase()}${inicial.toUpperCase()}]${resto}[\\w$]*`;
}

/* Alternancia de props portadoras: className/class, cada prefijo configurado y
 * cualquier prop que termine en ClassName. `extra` añade alternativas de sufijo
 * (los formularios objeto también admiten claves que terminan en Class). */
function alternanciaPortadores(prefijos: readonly string[], extra: string[] = []): string {
    const variantes = prefijos.filter(prefijo => prefijo !== '').map(variantePrefijo);
    return ['className', 'class', ...variantes, ...extra, '[\\w$]*ClassName'].join('|');
}

/* Las expresiones de atributos JSX/TSX y de formularios objeto dependen de los
 * prefijos portadores configurados; cada conjunto se construye una vez por lista. */
export interface RegexesPortadoras {
    attr: RegExp;
    templateInicio: RegExp;
    jsxExpr: RegExp;
    atributoClase: RegExp;
    object: RegExp;
    objectVar: RegExp;
}

function construirRegexesPortadoras(prefijos: readonly string[]): RegexesPortadoras {
    const atributo = alternanciaPortadores(prefijos);
    /* Los formularios objeto admiten además claves que terminan en Class (imageClass) */
    const clavesObjeto = `['"]?(?:${alternanciaPortadores(prefijos, ['[\\w$]*[Cc]lass'])})['"]?`;
    return {
        /* className/class/prop portadora = "valor" */
        attr: new RegExp(`(?:${atributo})\\s*=\\s*["']([^"']+)["']`, 'g'),
        /* Apertura de template literal en atributo de clase: className={`...`} */
        templateInicio: new RegExp(`(?:${atributo})\\s*=\\s*\\{\\s*\``, 'g'),
        /* className={expr} con ternarios y literales (sin llaves anidadas) */
        jsxExpr: new RegExp(`(?:${atributo})\\s*=\\s*\\{([^{}]*)\\}`, 'g'),
        /* Apertura de la expresión, para delimitarla con el escáner balanceado */
        atributoClase: new RegExp(`(?:${atributo})\\s*=\\s*\\{`, 'g'),
        /* Propiedad objeto con valor literal: { clase: 'a b' } o { clase: `a ${b}` } */
        object: new RegExp(`(?:${clavesObjeto})\\s*:\\s*(?:['"]([^'"]+)['"]|[\`]([^\`]+)[\`])`, 'g'),
        /* Propiedad objeto con valor variable: { className: clases.join(' ') } */
        objectVar: new RegExp(`(?:${clavesObjeto})\\s*:\\s*([A-Za-z_$][\\w$]*)(?:\\s*\\.\\s*join\\s*\\([^)]*\\))?\\s*(?=[,}])`, 'g'),
    };
}

const cacheRegexesPortadoras = new Map<string, RegexesPortadoras>();

/* Devuelve las regex de props portadoras para una lista de prefijos.
 * Las regex son globales con estado (lastIndex): quien las use debe resetearlo. */
export function regexesPortadoras(prefijos: readonly string[]): RegexesPortadoras {
    const clave = prefijos.join(',');
    let regexes = cacheRegexesPortadoras.get(clave);
    if (!regexes) {
        regexes = construirRegexesPortadoras(prefijos);
        cacheRegexesPortadoras.set(clave, regexes);
    }
    return regexes;
}
