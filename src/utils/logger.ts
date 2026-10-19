/*
 * Registro de la extensión: único punto que escribe en consola.
 * [por que] El resto del código no llama a console directamente: así todas las trazas
 * llevan el mismo prefijo y hay un solo sitio donde cambiar el destino de la salida.
 */

const PREFIJO = '[CSS Vars Validator]';

export const logger = {
    info: (mensaje: string, ...detalle: unknown[]): void => console.log(`${PREFIJO} ${mensaje}`, ...detalle),
    warn: (mensaje: string, ...detalle: unknown[]): void => console.warn(`${PREFIJO} ${mensaje}`, ...detalle),
    error: (mensaje: string, ...detalle: unknown[]): void => console.error(`${PREFIJO} ${mensaje}`, ...detalle),
};
