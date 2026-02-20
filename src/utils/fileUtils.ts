/*
 * Barrel re-export de utilidades de archivos
 * Modulos originales divididos por SRP en archivos enfocados
 */

export { buscarArchivos, leerArchivo, crearFileWatcher } from './fileOperations';
export { obtenerRutaRelativa, obtenerExtension, esCssValido, coincideConPatron } from './pathUtils';
export { offsetAPosicion, posicionAOffset, crearRango } from './positionUtils';
export { esLenguajeSoportado, esReact, obtenerLinea } from './documentUtils';
export { debounce, throttle, hashString } from './functionUtils';
