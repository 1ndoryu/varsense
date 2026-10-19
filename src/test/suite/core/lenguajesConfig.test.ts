/*
 * [VQ5] Los identificadores de lenguaje salen de `languages` en varsense.config.json.
 * Sin esa sección valen los defaults del core (mismo comportamiento de siempre); con
 * una lista vacía, la familia deja de analizarse: un proyecto sin React no recibe
 * hallazgos de estilo inline en .tsx.
 */

import * as assert from 'assert';
import { createCoreDocument } from '../../../core/types';
import { analyzeVarsenseDocument } from '../../../core/analisis/analyzeDocument';
import { buildAnalysisConfig, validateVarsenseConfig } from '../../../core/configuracion/config';
import { DiagnosticType } from '../../../types';
import { parserCssVarsense } from '../../../parsers';

function indiceVacio() {
    return { variables: new Map(), ultimaActualizacion: 0, archivosEscaneados: [] as string[] };
}

const JSX_CON_ESTILO = 'export const T = () => <div style={{ color: "red" }} />;\n';

function estiloInline(languageId: string, config: ReturnType<typeof buildAnalysisConfig>) {
    const documento = createCoreDocument({
        uri: 'file:///workspace/src/T.tsx',
        fileName: '/workspace/src/T.tsx',
        languageId,
        content: JSX_CON_ESTILO,
    });
    return analyzeVarsenseDocument(documento, indiceVacio() as never, config, parserCssVarsense)
        .filter(hallazgo => hallazgo.ruleId === DiagnosticType.CssInlineReact);
}

suite('VarSense languages (core)', () => {
    test('por defecto React se analiza como antes', () => {
        assert.strictEqual(estiloInline('typescriptreact', buildAnalysisConfig({})).length, 1);
    });

    test('una lista react vacía desactiva el análisis de JSX', () => {
        const config = buildAnalysisConfig({ languages: { react: [] } });
        assert.strictEqual(estiloInline('typescriptreact', config).length, 0);
    });

    test('la lista react configurada admite un identificador propio', () => {
        const config = buildAnalysisConfig({ languages: { react: ['tsx-propio'] } });
        assert.strictEqual(estiloInline('tsx-propio', config).length, 1);
        assert.strictEqual(estiloInline('typescriptreact', config).length, 0);
    });

    test('rechaza languages con valores que no son lista de cadenas', () => {
        assert.throws(
            () => validateVarsenseConfig({ languages: { css: 'css' } }),
            /languages\.css' debe ser string\[\]/
        );
    });

    test('rechaza claves desconocidas dentro de languages', () => {
        assert.throws(
            () => validateVarsenseConfig({ languages: { jsx: ['x'] } }),
            /clave desconocida/
        );
    });
});
