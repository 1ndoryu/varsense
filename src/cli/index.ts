/* API pública de la CLI: solo re-exports. La ejecución vive en main.ts. */

export {
    DEFAULT_CSS_PATTERNS,
    DEFAULT_EXCLUDE_PATTERNS,
    DEFAULT_INCLUDE_PATTERNS,
    DEFAULT_REACT_PATTERNS,
    DEFAULT_SCRIPT_PATTERNS,
    DEFAULT_VARIABLE_PATTERNS,
    buildAnalysisConfig,
    validateVarsenseConfig,
} from '@/core/configuracion/config';

export type { VarsenseConfigFile as VarsenseCliConfigFile } from '@/core/configuracion/config';
export type { CliAnalysisResult } from './tipos';
export { VARSENSE_JSON_SCHEMA_VERSION } from './tipos';
export { analyzeScanTarget, analyzeOrphanClassesTarget, analyzeAllTarget, analyzeCliTarget } from './analisis/objetivos';
export { runCli } from './run';
