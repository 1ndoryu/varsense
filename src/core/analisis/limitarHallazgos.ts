/* [O2] Acota los hallazgos mostrados sin alterar el conteo real: la salida declara cuántos quedaron
 * fuera, para que nadie tome un informe recortado por completo. Los archivos quedan en orden de ruta,
 * así que el recorte es determinista. */
import { TruncadoHallazgos, VarsenseReportEntry, countBySeverity } from './report';

/* Un límite de 0 (o uno que no recorta nada) devuelve las entradas intactas y sin `truncado`. */
export function limitarHallazgos(
    entries: VarsenseReportEntry[],
    limite: number
): { entries: VarsenseReportEntry[]; truncado?: TruncadoHallazgos } {
    const hallazgosTotal = entries.reduce((total, entry) => total + entry.findings.length, 0);
    if (limite <= 0 || hallazgosTotal <= limite) {
        return { entries };
    }

    const mostrados: VarsenseReportEntry[] = [];
    let restantes = limite;
    for (const entry of entries) {
        if (restantes === 0) {
            break;
        }
        const findings = entry.findings.slice(0, restantes);
        restantes -= findings.length;
        if (findings.length > 0) {
            mostrados.push({ ...entry, findings });
        }
    }

    return {
        entries: mostrados,
        truncado: {
            limite,
            hallazgosTotal,
            hallazgosOmitidos: hallazgosTotal - limite,
            archivosConHallazgos: entries.length,
            severityCounts: countBySeverity(entries),
        },
    };
}
