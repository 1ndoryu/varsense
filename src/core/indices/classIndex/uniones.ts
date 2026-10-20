/* Uniones globales del índice de clases entre archivos. [por que] Vive aparte de builder.ts,
 * que ya roza el límite de 300 líneas por archivo (gate limite-lineas). */
import type { CarrierCallSite } from './fuentes/carriers';

/* [318A-7V24] Unión global de carriers: fn → posiciones portadoras en
 * CUALQUIER archivo (la definición vive en un módulo y la llamada en
 * otro). Los literales de call-sites en esas posiciones son clases que
 * el runtime aplica: literal → archivos donde se llama. */
export function calcularLlamadasCrossCarrier(
    filesCarriers: Map<string, Map<string, Set<number>>>,
    filesLlamadas: Map<string, CarrierCallSite[]>
): Map<string, Set<string>> {
    const carriersUnion = new Map<string, Set<number>>();
    for (const carriers of filesCarriers.values()) {
        for (const [fn, posiciones] of carriers) {
            const union = carriersUnion.get(fn) ?? new Set<number>();
            for (const pos of posiciones) {union.add(pos);}
            carriersUnion.set(fn, union);
        }
    }
    const llamadasCrossCarrier = new Map<string, Set<string>>();
    for (const [fsPath, llamadas] of filesLlamadas) {
        for (const { fn, pos, literal } of llamadas) {
            if (!carriersUnion.get(fn)?.has(pos)) {continue;}
            for (const clase of literal.split(/\s+/)) {
                if (clase.length > 1 && /^[a-zA-Z_][\w-]*$/.test(clase)) {
                    const archivos = llamadasCrossCarrier.get(clase) ?? new Set<string>();
                    archivos.add(fsPath);
                    llamadasCrossCarrier.set(clase, archivos);
                }
            }
        }
    }
    return llamadasCrossCarrier;
}
