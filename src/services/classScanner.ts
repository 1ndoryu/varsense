/*
 * Escaner VS Code de clases CSS huerfanas.
 * La logica de cruce vive en core/classIndexBuilder; este modulo conserva la API publica historica.
 */

import { ClassIndexBuilder, ResultadoClasesHuerfanas } from '@/core/classIndexBuilder';
import { VscodeDocumentProvider, VscodeWorkspaceFileProvider } from '@/core/vscodeAdapter';

export type { ClaseCssDefinida, ResultadoClasesHuerfanas } from '@/core/classIndexBuilder';

/*
 * Ejecuta el escaneo completo de clases huerfanas usando providers de VS Code.
 */
export async function escanearClasesHuerfanas(
    excluidos: string[],
    longitudMinima: number = 3,
    patronesExcluidosClase: string[] = [],
    onProgress?: (fase: string, actual: number, total: number) => void
): Promise<ResultadoClasesHuerfanas> {
    const builder = new ClassIndexBuilder(
        new VscodeWorkspaceFileProvider(),
        new VscodeDocumentProvider()
    );

    return builder.scan({
        exclude: excluidos,
        minLength: longitudMinima,
        excludedClassPatterns: patronesExcluidosClase
    }, onProgress);
}
