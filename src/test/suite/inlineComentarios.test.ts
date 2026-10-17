/*
 * [17AA-3] `cssInlineReact` y `cssInlineScript` recorrian `document.getText()`
 * crudo, asi que un `style={}` escrito dentro de un comentario contaba como CSS
 * inline. Medido el 2026-10-17: los dos hallazgos de NAKOMI
 * (`CarruselShowcase.tsx:73`, `SeccionGaleriaServicio.tsx:29`) son la misma
 * frase de un comentario de bloque que explica el propio detector.
 *
 * Los casos de abajo llevan testigo: el mismo contenido **sin** las marcas de
 * comentario tiene que marcar, y la linea del hallazgo real tiene que seguir
 * siendo la suya (el enmascarado conserva longitudes).
 */

import * as assert from 'assert';
import { createCoreDocument } from '../../core/types';
import { analyzeVarsenseDocument } from '../../core/analyzeDocument';
import { buildAnalysisConfig } from '../../core/config';
import { enmascararComentarios } from '../../core/enmascararComentarios';

function indiceVacio() {
    return { variables: new Map(), ultimaActualizacion: 0, archivosEscaneados: [] as string[] };
}

function analizar(fileName: string, languageId: string, content: string) {
    const documento = createCoreDocument({
        uri: `file:///workspace/${fileName}`,
        fileName: `/workspace/${fileName}`,
        languageId,
        content,
    });
    return analyzeVarsenseDocument(documento, indiceVacio() as never, buildAnalysisConfig({}));
}

function inlineReact(fileName: string, content: string) {
    return analizar(fileName, 'typescriptreact', content)
        .filter(h => h.ruleId === 'cssInlineReact');
}

suite('estilo inline no lee dentro de comentarios (17AA-3)', () => {

    test('enmascararComentarios conserva longitud y saltos de linea', () => {
        const texto = 'a /* x\ny */ b // z\nc';
        const salida = enmascararComentarios(texto);
        assert.strictEqual(salida.length, texto.length);
        assert.strictEqual(salida.split('\n').length, texto.split('\n').length);
        assert.strictEqual(salida[0], 'a');
        assert.ok(!salida.includes('x') && !salida.includes('z'));
    });

    test('enmascararComentarios no se traga el fichero por un apostrofo de texto JSX', () => {
        const texto = "const V = () => <p>don't</p>;\n<div style={{ color: 'red' }} />";
        const salida = enmascararComentarios(texto);
        assert.ok(salida.includes('style='), 'el style real tiene que seguir visible');
    });

    test('enmascararComentarios no confunde un `//` dentro de una cadena', () => {
        const texto = "const u = 'https://ejemplo.test';\nconst v = 1;";
        const salida = enmascararComentarios(texto);
        assert.ok(salida.includes('https://ejemplo.test'));
        assert.ok(salida.includes('const v = 1;'), 'la linea siguiente no se enmascara');
    });

    test('un style={{}} dentro de un comentario de bloque no es cssInlineReact', () => {
        const contenido = [
            '/*',
            ' * Nota de mantenimiento: el detector (indexado por VarSense): style={}',
            ' * con --var dispara el aviso de CSS inline.',
            ' */',
            'const Carrusel = () => <div className="c" />;',
        ].join('\n');
        assert.strictEqual(inlineReact('Carrusel.tsx', contenido).length, 0);
    });

    test('un style={{}} dentro de un comentario de linea no es cssInlineReact', () => {
        const contenido = '// style={{ background: color }} pendiente de migrar\nconst a = 1;';
        assert.strictEqual(inlineReact('Vista.tsx', contenido).length, 0);
    });

    test('testigo: el mismo style={{}} fuera del comentario si marca', () => {
        const contenido = 'const Carrusel = () => <div style={{ background: color }} />;';
        assert.strictEqual(inlineReact('Carrusel.tsx', contenido).length, 1);
    });

    test('el comentario no desplaza la linea del hallazgo real', () => {
        const contenido = [
            '/*',
            ' * style={} dentro de un comentario, en la linea 2.',
            ' */',
            'const V = () => <div style={{ background: color }} />;',
        ].join('\n');
        const hallazgos = inlineReact('V.tsx', contenido);
        assert.strictEqual(hallazgos.length, 1);
        assert.strictEqual(hallazgos[0].range.start.line, 3, 'la linea 3 (0-indexada) es la del style real');
    });

    test('sigue eximiendo el objeto que solo define custom properties', () => {
        const contenido = "const V = () => <div style={{ '--top': offset }} />;";
        assert.strictEqual(inlineReact('V.tsx', contenido).length, 0);
    });

    test('un .style.x = dentro de un comentario no es cssInlineScript', () => {
        const contenido = '/* el nodo hace nodo.style.color = color mas abajo */\nconst a = 1;';
        const hallazgos = analizar('logica.ts', 'typescript', contenido)
            .filter(h => h.ruleId === 'cssInlineScript');
        assert.strictEqual(hallazgos.length, 0);
    });

    test('testigo: el .style.x = real en script si marca', () => {
        const contenido = 'nodo.style.color = color;';
        const hallazgos = analizar('logica.ts', 'typescript', contenido)
            .filter(h => h.ruleId === 'cssInlineScript');
        assert.strictEqual(hallazgos.length, 1);
    });
});
