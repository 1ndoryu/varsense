/* Escaneo de clases huérfanas desde providers core (V6: lógica en ./classIndex/). */
export type { ClaseCssDefinida, ResultadoClasesHuerfanas, ClassIndexScanOptions, ClassScanProgress } from './classIndex/tipos';
export { extraerMapasExportados, extraerNombresImportadosRelativos } from './classIndex/fuentes/mapasJs';
export { extraerClasesDeTexto } from './classIndex/fuentes/cssClases';
export { esNombrePortadorClase } from './classIndex/plantillas/plantillas';
export { detectarCarriersMismoArchivo, extraerCarriersYLlamadas } from './classIndex/fuentes/carriers';
export type { CarrierCallSite } from './classIndex/fuentes/carriers';
export { ClassIndexBuilder } from './classIndex/builder';
export { extraerUsoVariablesDeTexto } from '../analisis/usoVariables';
