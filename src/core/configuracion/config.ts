import { CoreSeverity } from '../types';
import { LENGUAJES_POR_DEFECTO, VarsenseDocumentAnalysisConfig } from '../analisis/analyzeDocument';
import { ESTILO_BOTON_POR_DEFECTO } from '../analisis/reglasBotonCss';
import { NAMESPACES_TEMA_POR_DEFECTO } from '../analisis/tokenRules';
import { esSeveridadValida } from './validacion';

/* Los llamadores siguen importando la validación desde aquí. */
export { validateVarsenseConfig } from './validacion';

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
function severityOrDefault(value: CoreSeverity | undefined, fallback: CoreSeverity): CoreSeverity {
    return esSeveridadValida(value) ? value : fallback;
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
