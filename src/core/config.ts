import { CoreSeverity } from './types';
import { VarsenseDocumentAnalysisConfig } from './analyzeDocument';

/* [095A-4] La configuracion compartida vive en core para que CLI y LSP usen los mismos
 * defaults sin que el servidor stdio importe ni ejecute el entrypoint de la CLI. */

export interface VarsenseConfigFile {
    variableFiles?: string[];
    includePatterns?: string[];
    excludePatterns?: string[];
    scanAllFiles?: boolean;
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
}

export const DEFAULT_VARIABLE_PATTERNS = [
    '**/variables.css',
    '**/vars.css',
    '**/_variables.scss',
    '**/tokens.css',
];
export const DEFAULT_CSS_PATTERNS = ['**/*.css', '**/*.scss', '**/*.less'];
export const DEFAULT_REACT_PATTERNS = ['**/*.tsx', '**/*.jsx'];
export const DEFAULT_SCRIPT_PATTERNS = ['**/*.ts', '**/*.js'];
export const DEFAULT_INCLUDE_PATTERNS = ['**/*'];
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
    'variableFiles', 'includePatterns', 'excludePatterns', 'scanAllFiles',
    'hardcodedDetection', 'inlineDetection', 'bannedProperties', 'orphanClassDetection',
]);
const NESTED_KEYS: Record<string, Set<string>> = {
    hardcodedDetection: new Set(['enabled', 'severity', 'properties', 'allowedValues']),
    inlineDetection: new Set(['enabled', 'severity']),
    bannedProperties: new Set(['enabled', 'severity', 'properties']),
    orphanClassDetection: new Set(['minClassLength', 'excludeClassPatterns', 'severity']),
};

function assertStringArray(value: unknown, key: string): asserts value is string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new Error(`varsense.config.json: '${key}' debe ser string[]`);
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
    for (const key of ['variableFiles', 'includePatterns', 'excludePatterns'] as const) {
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
    };
}
