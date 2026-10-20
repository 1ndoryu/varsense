import * as assert from 'assert';
import { regexesPortadoras } from '../../../core/indices/classIndex/constantes';
import { PREFIJOS_PORTADORES_CONVENCION } from '../../../configuracion/convencionArea';
import { extraerTokensDeTexto } from '../../../core/indices/classIndex/consumo/consumidores';

/* Devuelve los grupos capturados de la primera coincidencia de una regex global */
function primeraCaptura(regex: RegExp, texto: string): string | undefined {
  regex.lastIndex = 0;
  const match = regex.exec(texto);
  regex.lastIndex = 0;
  return match ? (match[1] ?? match[2]) : undefined;
}

suite('prefijosPortadores configurables', () => {
  test('el default ["clase"] reconoce las mismas props que antes', () => {
    const re = regexesPortadoras(PREFIJOS_PORTADORES_CONVENCION);
    assert.strictEqual(primeraCaptura(re.attr, 'className="a b"'), 'a b');
    assert.strictEqual(primeraCaptura(re.attr, 'class="x"'), 'x');
    assert.strictEqual(primeraCaptura(re.attr, 'claseAdicional="extra"'), 'extra');
    assert.strictEqual(primeraCaptura(re.attr, 'Clase="mayus"'), 'mayus');
    assert.strictEqual(primeraCaptura(re.attr, 'panelClassName="dropdown"'), 'dropdown');
    assert.strictEqual(primeraCaptura(re.attr, 'classification="dato"'), undefined);
    assert.strictEqual(primeraCaptura(re.object, "{ imageClass: 'activity-image' }"), 'activity-image');
    assert.strictEqual(primeraCaptura(re.object, "{ estado: 'activo' }"), undefined);
  });

  test('un prefijo propio sustituye a clase en todas las formas', () => {
    const re = regexesPortadoras(['carrier']);
    assert.strictEqual(primeraCaptura(re.attr, 'carrierTag="btn-primary"'), 'btn-primary');
    assert.strictEqual(primeraCaptura(re.attr, 'CarrierTag="btn-x"'), 'btn-x');
    assert.strictEqual(primeraCaptura(re.attr, 'claseAdicional="no"'), undefined);
    assert.strictEqual(primeraCaptura(re.object, "{ carrierTag: 'chip' }"), 'chip');
    re.templateInicio.lastIndex = 0;
    assert.strictEqual(re.templateInicio.test('carrierTag={`a ${b}`}'), true);
    re.templateInicio.lastIndex = 0;
  });

  test('los prefijos con metacaracteres de regex se escapan', () => {
    const re = regexesPortadoras(['a.b']);
    assert.strictEqual(primeraCaptura(re.attr, 'a.bX="ok"'), 'ok');
    assert.strictEqual(primeraCaptura(re.attr, 'aXbX="no"'), undefined);
  });

  test('extraerTokensDeTexto usa los prefijos recibidos', () => {
    const texto = '<Boton carrierTag="btn-primary" claseAdicional="btn-extra" />';

    const conCarrier = new Set<string>();
    extraerTokensDeTexto(texto, conCarrier, undefined, undefined, undefined, ['carrier']);
    assert.ok(conCarrier.has('btn-primary'));
    assert.ok(!conCarrier.has('btn-extra'));

    const conClase = new Set<string>();
    extraerTokensDeTexto(texto, conClase, undefined, undefined, undefined, ['clase']);
    assert.ok(conClase.has('btn-extra'));
    assert.ok(!conClase.has('btn-primary'));
  });
});
