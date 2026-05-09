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
