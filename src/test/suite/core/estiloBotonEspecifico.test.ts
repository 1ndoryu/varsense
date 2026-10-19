/*
 * [V4] La regla `estiloBotonEspecifico` vive en el core: CSS de componente
 * con una clase tipo botón que define ≥2 propiedades estructurales.
 * Los casos llevan testigo: el mismo CSS fuera de components/ o en Button.css
 * no marca, y una desactivación en la línea anterior sí suprime.
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

function analizar(fileName: string, content: string) {
    const documento = createCoreDocument({
        uri: `file:///workspace/${fileName}`,
        fileName: `/workspace/${fileName}`,
        languageId: 'css',
        content,
    });
    return analyzeVarsenseDocument(documento, indiceVacio() as never, buildAnalysisConfig({}), parserCssVarsense)
        .filter(hallazgo => hallazgo.ruleId === DiagnosticType.EstiloBotonEspecifico);
}

const CSS_BOTON = '.btnPrimario {\n  padding: 4px;\n  background: red;\n}\n';

suite('VarSense estiloBotonEspecifico (core)', () => {
    test('marca clase tipo botón con ≥2 propiedades en components/', () => {
        const hallazgos = analizar('src/components/Tarjeta.css', CSS_BOTON);
        assert.strictEqual(hallazgos.length, 1);
        assert.strictEqual(hallazgos[0].range.start.line, 0);
        assert.strictEqual(hallazgos[0].severity, 'warning');
    });

    test('no marca fuera de components/', () => {
        assert.strictEqual(analizar('src/styles/Tarjeta.css', CSS_BOTON).length, 0);
    });

    test('excluye Button.css, el componente base', () => {
        assert.strictEqual(analizar('src/components/Button.css', CSS_BOTON).length, 0);
    });

    test('no marca con una sola propiedad estructural', () => {
        const css = '.btnPrimario {\n  padding: 4px;\n}\n';
        assert.strictEqual(analizar('src/components/Tarjeta.css', css).length, 0);
    });

    test('la desactivación en la línea anterior suprime el hallazgo', () => {
        const css = '/* varsense-disable-next-line */\n' + CSS_BOTON;
        assert.strictEqual(analizar('src/components/Tarjeta.css', css).length, 0);
    });

    /* [V4] La convención se lee de buttonStyleDetection: otro proyecto puede cambiarla. */
    test('buttonStyleDetection cambia carpeta, selector y severidad', () => {
        const config = buildAnalysisConfig({
            buttonStyleDetection: { componentFolder: 'ui', selectorPattern: 'cta', severity: 'error' },
        });
        const documento = createCoreDocument({
            uri: 'file:///workspace/src/ui/Tarjeta.css',
            fileName: '/workspace/src/ui/Tarjeta.css',
            languageId: 'css',
            content: '.ctaPrimario {\n  padding: 4px;\n  background: red;\n}\n',
        });
        const hallazgos = analyzeVarsenseDocument(documento, indiceVacio() as never, config, parserCssVarsense)
            .filter(hallazgo => hallazgo.ruleId === DiagnosticType.EstiloBotonEspecifico);
        assert.strictEqual(hallazgos.length, 1);
        assert.strictEqual(hallazgos[0].severity, 'error');
    });

    test('buttonStyleDetection.enabled false desactiva la regla', () => {
        const config = buildAnalysisConfig({ buttonStyleDetection: { enabled: false } });
        const documento = createCoreDocument({
            uri: 'file:///workspace/src/components/Tarjeta.css',
            fileName: '/workspace/src/components/Tarjeta.css',
            languageId: 'css',
            content: CSS_BOTON,
        });
        const hallazgos = analyzeVarsenseDocument(documento, indiceVacio() as never, config, parserCssVarsense)
            .filter(hallazgo => hallazgo.ruleId === DiagnosticType.EstiloBotonEspecifico);
        assert.strictEqual(hallazgos.length, 0);
    });

    test('rechaza una expresion regular invalida en la configuracion', () => {
        assert.throws(
            () => validateVarsenseConfig({ buttonStyleDetection: { selectorPattern: '(' } }),
            /no es una expresión regular válida/
        );
    });
});
