import { CoreSeverity } from '../types';
import { LENGUAJES_POR_DEFECTO, VarsenseDocumentAnalysisConfig } from '../analisis/analyzeDocument';
import { ESTILO_BOTON_POR_DEFECTO } from '../analisis/reglasBotonCss';
import { NAMESPACES_TEMA_POR_DEFECTO } from '../analisis/tokenRules';

/* [095A-4] La configuracion compartida vive en core para que CLI y LSP usen los mismos
 * defaults sin que el servidor stdio importe ni ejecute el entrypoint de la CLI. */

export interface VarsenseConfigFile {
    variableFiles?: string[];
    includePatterns?: string[];
    excludePatterns?: string[];
    scanAllFiles?: boolean;
    prefijosPortadores?: string[];
    hardcodedDetection?: {
        enabled?: boolean;
        severity?: CoreSeverity;
        properties?: Record<string, boolean>;
        allowedValues?: string[];
    };
    inlineDetection?: {
        enabled?: boolean;
        severity?: CoreSeverity;
    };
    bannedProperties?: {
        enabled?: boolean;
        severity?: CoreSeverity;
        properties?: string[];
    };
    orphanClassDetection?: {
        minClassLength?: number;
        excludeClassPatterns?: string[];
        severity?: CoreSeverity;
    };
    /* [289A-1 DEPRECADA] Aceptada pero ignorada: la regla vive en Sentinel
     * Core (`todo-prosa-sin-marcador`). Se retira en la proxima major. */
    todoProseDetection?: {
        enabled?: boolean;
        severity?: CoreSeverity;
    };
    tokenDetection?: {
        duplicate?: { enabled?: boolean; severity?: CoreSeverity; excludeTokens?: string[] };
        unused?: { enabled?: boolean; severity?: CoreSeverity; excludeTokens?: string[] };
        crossFile?: { enabled?: boolean; severity?: CoreSeverity };
        /* [AG-1] Reemplaza (no mezcla) los namespaces de tema por defecto de Tailwind v4. */
        themeNamespaces?: Array<{ namespace: string; utilities: string[] }>;
        /* [AG-1] Reconoce `bg-(--x)` (shorthand de Tailwind v4) como uso de variable; `false` lo desactiva. */
        tailwindShorthand?: boolean;
    };
    /* [VQ5] Identificadores de lenguaje por familia y extensiones CSS del índice de variables (defaults del core). */
    languages?: {
        css?: string[];
        react?: string[];
        script?: string[];
        cssExtensions?: string[];
    };
    /* [V4] Regla de estilo de botón: los valores por defecto son la convención del área; otro proyecto los cambia aquí. */
    buttonStyleDetection?: {
        enabled?: boolean;
        severity?: CoreSeverity;
        componentFolder?: string;
        selectorPattern?: string;
        excludeFilePattern?: string;
        componentName?: string;
        componentProps?: string[];
        styleProperties?: string[];
        minStyleProperties?: number;
    };
}

export const DEFAULT_VARIABLE_PATTERNS = [
    '**/variables.css',
    '**/vars.css',
    '**/_variables.scss',
    '**/tokens.css',
];
/* [VQ5] Extensiones que el índice de variables toma como CSS (por defecto, solo `.css`). */
export const EXTENSIONES_CSS_POR_DEFECTO = ['.css'];
export const DEFAULT_CSS_PATTERNS = ['**/*.css', '**/*.scss', '**/*.less'];
export const DEFAULT_REACT_PATTERNS = ['**/*.tsx', '**/*.jsx'];
export const DEFAULT_SCRIPT_PATTERNS = ['**/*.ts', '**/*.js'];
export const DEFAULT_INCLUDE_PATTERNS = ['**/*'];
/* Convencion del design system del area (NAKOMI): default del CLI, no del core. */
export const DEFAULT_PREFIJOS_PORTADORES = ['clase'];
export const DEFAULT_EXCLUDE_PATTERNS = [
    '**/node_modules/**',
    '**/vendor/**',
    '**/*.min.css',
    '**/dist/**',
    '**/build/**',
];
const DEFAULT_ALLOWED_VALUES = [
    '0', 'auto', 'inherit', 'initial', 'unset', 'none',
    '100%', '50%', 'transparent', 'currentColor',
];
const DEFAULT_HARDCODED_PROPERTIES: Record<string, boolean> = {
    'font-size': true,
    color: true,
    'background-color': true,
    background: true,
    'border-color': true,
    margin: false,
    padding: false,
    gap: false,
    'border-radius': false,
};
const VALID_SEVERITIES = new Set<CoreSeverity>(['error', 'warning', 'information', 'hint']);
const CONFIG_KEYS = new Set([
    'variableFiles', 'includePatterns', 'excludePatterns', 'scanAllFiles', 'prefijosPortadores',
    'hardcodedDetection', 'inlineDetection', 'bannedProperties', 'orphanClassDetection', 'todoProseDetection', 'tokenDetection',
    'buttonStyleDetection', 'languages',
]);
const NESTED_KEYS: Record<string, Set<string>> = {
    hardcodedDetection: new Set(['enabled', 'severity', 'properties', 'allowedValues']),
    inlineDetection: new Set(['enabled', 'severity']),
    bannedProperties: new Set(['enabled', 'severity', 'properties']),
    orphanClassDetection: new Set(['minClassLength', 'excludeClassPatterns', 'severity']),
    todoProseDetection: new Set(['enabled', 'severity']),
    /* [MN-token] 'crossFile' estaba tipada y mapeada pero ausente aquí: un
     * varsense.config.json con esa sección era rechazado por clave desconocida. */
    tokenDetection: new Set(['duplicate', 'unused', 'crossFile', 'themeNamespaces', 'tailwindShorthand']),
    buttonStyleDetection: new Set([
        'enabled', 'severity', 'componentFolder', 'selectorPattern', 'excludeFilePattern',
        'componentName', 'componentProps', 'styleProperties', 'minStyleProperties',
    ]),
    languages: new Set(['css', 'react', 'script', 'cssExtensions']),
};

function assertStringArray(value: unknown, key: string): asserts value is string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new Error(`varsense.config.json: '${key}' debe ser string[]`);
    }
}

/* [por que] Una regex inválida fallaría en cada análisis; se rechaza al cargar la configuración. */
function assertRegexSource(value: unknown, key: string): void {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`varsense.config.json: '${key}' debe ser una cadena no vacía`);
    }
    try {
        new RegExp(value, 'i');
    } catch {
        throw new Error(`varsense.config.json: '${key}' no es una expresión regular válida`);
    }
}

function assertSeverity(value: unknown, key: string): void {
    if (typeof value !== 'string' || !VALID_SEVERITIES.has(value as CoreSeverity)) {
        throw new Error(`varsense.config.json: severidad invalida en '${key}'`);
    }
}

export function validateVarsenseConfig(value: unknown): asserts value is VarsenseConfigFile {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('varsense.config.json: la raiz debe ser un objeto');
    }

    const config = value as Record<string, unknown>;
    for (const key of Object.keys(config)) {
        if (!CONFIG_KEYS.has(key)) {
            throw new Error(`varsense.config.json: clave desconocida '${key}'`);
        }
    }
    for (const key of ['variableFiles', 'includePatterns', 'excludePatterns', 'prefijosPortadores'] as const) {
        if (config[key] !== undefined) {
            assertStringArray(config[key], key);
        }
    }
    if (config.scanAllFiles !== undefined && typeof config.scanAllFiles !== 'boolean') {
        throw new Error("varsense.config.json: 'scanAllFiles' debe ser boolean");
    }

    for (const [section, allowedKeys] of Object.entries(NESTED_KEYS)) {
        const rawSection = config[section];
        if (rawSection === undefined) {
            continue;
        }
        if (!rawSection || typeof rawSection !== 'object' || Array.isArray(rawSection)) {
            throw new Error(`varsense.config.json: '${section}' debe ser un objeto`);
        }
        const nested = rawSection as Record<string, unknown>;
        for (const key of Object.keys(nested)) {
            if (!allowedKeys.has(key)) {
                throw new Error(`varsense.config.json: clave desconocida '${section}.${key}'`);
            }
        }
        if (nested.enabled !== undefined && typeof nested.enabled !== 'boolean') {
            throw new Error(`varsense.config.json: '${section}.enabled' debe ser boolean`);
        }
        if (nested.severity !== undefined) {
            assertSeverity(nested.severity, `${section}.severity`);
        }
    }

    const hardcoded = config.hardcodedDetection as Record<string, unknown> | undefined;
    if (hardcoded?.properties !== undefined &&
        (!hardcoded.properties || typeof hardcoded.properties !== 'object' || Array.isArray(hardcoded.properties) ||
         Object.values(hardcoded.properties as Record<string, unknown>).some(item => typeof item !== 'boolean'))) {
        throw new Error("varsense.config.json: 'hardcodedDetection.properties' debe ser Record<string, boolean>");
    }
    if (hardcoded?.allowedValues !== undefined) {
        assertStringArray(hardcoded.allowedValues, 'hardcodedDetection.allowedValues');
    }
    const banned = config.bannedProperties as Record<string, unknown> | undefined;
    if (banned?.properties !== undefined) {
        assertStringArray(banned.properties, 'bannedProperties.properties');
    }
    const orphan = config.orphanClassDetection as Record<string, unknown> | undefined;
    if (orphan?.excludeClassPatterns !== undefined) {
        assertStringArray(orphan.excludeClassPatterns, 'orphanClassDetection.excludeClassPatterns');
    }
    if (orphan?.minClassLength !== undefined &&
        (typeof orphan.minClassLength !== 'number' || !Number.isInteger(orphan.minClassLength) || orphan.minClassLength < 1)) {
        throw new Error("varsense.config.json: 'orphanClassDetection.minClassLength' debe ser un entero positivo");
    }

    const tokens = config.tokenDetection as Record<string, unknown> | undefined;
    for (const key of ['duplicate', 'unused', 'crossFile'] as const) {
        const section = tokens?.[key] as Record<string, unknown> | undefined;
        if (section?.enabled !== undefined && typeof section.enabled !== 'boolean') {
            throw new Error(`varsense.config.json: 'tokenDetection.${key}.enabled' debe ser boolean`);
        }
        if (section?.severity !== undefined) {
            assertSeverity(section.severity, `tokenDetection.${key}.severity`);
        }
    }
    /* `excludeTokens` lo tienen las dos reglas de tokens: en `unused` exime del
     * aviso de "sin uso" y en `duplicate` declara alias deliberados. */
    for (const key of ['duplicate', 'unused'] as const) {
        const section = tokens?.[key] as Record<string, unknown> | undefined;
        if (section?.excludeTokens !== undefined) {
            assertStringArray(section.excludeTokens, `tokenDetection.${key}.excludeTokens`);
        }
    }
    if (tokens?.themeNamespaces !== undefined) {
        validarThemeNamespaces(tokens.themeNamespaces);
    }
    if (tokens?.tailwindShorthand !== undefined && typeof tokens.tailwindShorthand !== 'boolean') {
        throw new Error("varsense.config.json: 'tokenDetection.tailwindShorthand' debe ser boolean");
    }

    const lenguajes = config.languages as Record<string, unknown> | undefined;
    for (const key of ['css', 'react', 'script', 'cssExtensions'] as const) {
        if (lenguajes?.[key] !== undefined) {
            assertStringArray(lenguajes[key], `languages.${key}`);
        }
    }

    const boton = config.buttonStyleDetection as Record<string, unknown> | undefined;
    if (boton?.componentFolder !== undefined &&
        (typeof boton.componentFolder !== 'string' || !/^[^/\\]+$/.test(boton.componentFolder))) {
        throw new Error("varsense.config.json: 'buttonStyleDetection.componentFolder' debe ser un nombre de carpeta (sin '/')");
    }
    if (boton?.selectorPattern !== undefined) {
        assertRegexSource(boton.selectorPattern, 'buttonStyleDetection.selectorPattern');
    }
    if (boton?.excludeFilePattern !== undefined) {
        assertRegexSource(boton.excludeFilePattern, 'buttonStyleDetection.excludeFilePattern');
    }
    if (boton?.componentName !== undefined &&
        (typeof boton.componentName !== 'string' || !/^[A-Za-z][\w.]*$/.test(boton.componentName))) {
        throw new Error("varsense.config.json: 'buttonStyleDetection.componentName' debe ser un identificador JSX (p. ej. Button)");
    }
    if (boton?.componentProps !== undefined) {
        assertNombresCss(boton.componentProps, 'buttonStyleDetection.componentProps', /^[A-Za-z][\w-]*$/);
    }
    if (boton?.styleProperties !== undefined) {
        assertNombresCss(boton.styleProperties, 'buttonStyleDetection.styleProperties', /^[a-z-]+$/i);
    }
    if (boton?.minStyleProperties !== undefined &&
        (typeof boton.minStyleProperties !== 'number' || !Number.isInteger(boton.minStyleProperties) || boton.minStyleProperties < 1)) {
        throw new Error("varsense.config.json: 'buttonStyleDetection.minStyleProperties' debe ser un entero positivo");
    }
}

/* [por que] Estas listas se usan en el mensaje y en una expresión regular: se
 * limitan a nombres (sin metacaracteres) para que no inyecten patrones. */
function assertNombresCss(value: unknown, key: string, patron: RegExp): void {
    assertStringArray(value, key);
    if ((value as string[]).length === 0 || (value as string[]).some(item => !patron.test(item))) {
        throw new Error(`varsense.config.json: '${key}' debe ser una lista no vacía de nombres válidos`);
    }
}

/* [AG-1] `namespace` debe tener forma `--prefijo-` (así `--color-primary` cuadra con `bg-primary`). */
function validarThemeNamespaces(value: unknown): void {
    const clave = 'tokenDetection.themeNamespaces';
    if (!Array.isArray(value)) {
        throw new Error(`varsense.config.json: '${clave}' debe ser un array de { namespace, utilities }`);
    }
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`varsense.config.json: '${clave}' debe contener objetos { namespace, utilities }`);
        }
        const { namespace, utilities } = item as Record<string, unknown>;
        if (typeof namespace !== 'string' || !/^--[\w-]+-$/.test(namespace)) {
            throw new Error(`varsense.config.json: '${clave}[].namespace' debe tener la forma '--prefijo-'`);
        }
        assertNombresCss(utilities, `${clave}[].utilities`, /^[a-z][\w-]*$/i);
    }
}

function severityOrDefault(value: CoreSeverity | undefined, fallback: CoreSeverity): CoreSeverity {
    return value && VALID_SEVERITIES.has(value) ? value : fallback;
}

export function buildAnalysisConfig(config: VarsenseConfigFile): VarsenseDocumentAnalysisConfig {
    return {
        hardcoded: {
            habilitado: config.hardcodedDetection?.enabled ?? true,
            severidad: severityOrDefault(config.hardcodedDetection?.severity, 'warning'),
            propiedades: config.hardcodedDetection?.properties ?? DEFAULT_HARDCODED_PROPERTIES,
            valoresPermitidos: config.hardcodedDetection?.allowedValues ?? DEFAULT_ALLOWED_VALUES,
        },
        inline: {
            habilitado: config.inlineDetection?.enabled ?? true,
            severidad: severityOrDefault(config.inlineDetection?.severity, 'error'),
        },
        bannedProperties: {
            habilitado: config.bannedProperties?.enabled ?? true,
            severidad: severityOrDefault(config.bannedProperties?.severity, 'warning'),
            propiedades: config.bannedProperties?.properties ?? ['box-shadow'],
        },
        /* [289A-1] todoProseDetection aceptada-pero-ignorada (compat): la
         * regla vive en Sentinel Core. `CONFIG_KEYS`/`NESTED_KEYS` la siguen
         * aceptando para no romper `varsense.config.json` existentes. */
        tokens: {
            duplicate: {
                habilitado: config.tokenDetection?.duplicate?.enabled ?? true,
                severidad: severityOrDefault(config.tokenDetection?.duplicate?.severity, 'warning'),
                excluirTokens: config.tokenDetection?.duplicate?.excludeTokens ?? [],
            },
            unused: {
                habilitado: config.tokenDetection?.unused?.enabled ?? true,
                severidad: severityOrDefault(config.tokenDetection?.unused?.severity, 'hint'),
                excluirTokens: config.tokenDetection?.unused?.excludeTokens ?? [],
            },
            crossFile: {
                habilitado: config.tokenDetection?.crossFile?.enabled ?? true,
                severidad: severityOrDefault(config.tokenDetection?.crossFile?.severity, 'information'),
            },
            temaNamespaces: config.tokenDetection?.themeNamespaces?.map(item => ({
                namespace: item.namespace,
                prefijos: item.utilities,
            })) ?? NAMESPACES_TEMA_POR_DEFECTO,
            shorthandTailwind: config.tokenDetection?.tailwindShorthand ?? true,
        },
        lenguajes: {
            css: config.languages?.css ?? LENGUAJES_POR_DEFECTO.css,
            react: config.languages?.react ?? LENGUAJES_POR_DEFECTO.react,
            script: config.languages?.script ?? LENGUAJES_POR_DEFECTO.script,
        },
        estiloBoton: {
            habilitado: config.buttonStyleDetection?.enabled ?? ESTILO_BOTON_POR_DEFECTO.habilitado,
            severidad: severityOrDefault(config.buttonStyleDetection?.severity, ESTILO_BOTON_POR_DEFECTO.severidad),
            carpeta: config.buttonStyleDetection?.componentFolder ?? ESTILO_BOTON_POR_DEFECTO.carpeta,
            patronSelector: config.buttonStyleDetection?.selectorPattern ?? ESTILO_BOTON_POR_DEFECTO.patronSelector,
            patronExcluirArchivo: config.buttonStyleDetection?.excludeFilePattern ?? ESTILO_BOTON_POR_DEFECTO.patronExcluirArchivo,
            nombreComponente: config.buttonStyleDetection?.componentName ?? ESTILO_BOTON_POR_DEFECTO.nombreComponente,
            propiedadesComponente: config.buttonStyleDetection?.componentProps ?? ESTILO_BOTON_POR_DEFECTO.propiedadesComponente,
            propiedadesEstilo: config.buttonStyleDetection?.styleProperties ?? ESTILO_BOTON_POR_DEFECTO.propiedadesEstilo,
            minimoPropiedadesEstilo: config.buttonStyleDetection?.minStyleProperties ?? ESTILO_BOTON_POR_DEFECTO.minimoPropiedadesEstilo,
        },
    };
}
