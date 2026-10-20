import { CoreSeverity } from '../types';
import type { VarsenseConfigFile } from './config';

/* [por que] La validación vive aparte para que config.ts quede bajo el límite de 300 líneas. config.ts la reexporta: los llamadores no cambian. */

const SEVERIDADES: readonly string[] = ['error', 'warning', 'information', 'hint'];

/* Acepta solo las severidades del core; lo usan la validación y los defaults de config.ts. */
export function esSeveridadValida(value: unknown): value is CoreSeverity {
    return typeof value === 'string' && SEVERIDADES.includes(value);
}
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
    if (!esSeveridadValida(value)) {
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
