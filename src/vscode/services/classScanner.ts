/*
 * Escaner VS Code de clases CSS huerfanas.
 * La logica de cruce vive en core/classIndexBuilder; este modulo conserva la API publica historica.
 */

import { ClassIndexBuilder, ResultadoClasesHuerfanas } from '@/core/indices/classIndexBuilder';
import { VscodeDocumentProvider, VscodeWorkspaceFileProvider } from '@/vscode/vscodeAdapter';
import { CONVENCION_AREA } from '@/configuracion/convencionArea';

export type { ClaseCssDefinida, ResultadoClasesHuerfanas } from '@/core/indices/classIndexBuilder';

/*
 * Ejecuta el escaneo completo de clases huerfanas usando providers de VS Code.
 */
export async function escanearClasesHuerfanas(
    excluidos: string[],
    longitudMinima: number = 3,
    patronesExcluidosClase: string[] = [],
    onProgress?: (fase: string, actual: number, total: number) => void,
    /* Sin valor, la raíz aplica la convención del área (nunca "ningún portador" en silencio). */
    prefijosPortadores: string[] = [...CONVENCION_AREA.prefijosPortadores]
): Promise<ResultadoClasesHuerfanas> {
    const builder = new ClassIndexBuilder(
        new VscodeWorkspaceFileProvider(),
        new VscodeDocumentProvider()
    );

    return builder.scan({
        exclude: excluidos,
        minLength: longitudMinima,
        excludedClassPatterns: patronesExcluidosClase,
        prefijosPortadores
    }, onProgress);
}
