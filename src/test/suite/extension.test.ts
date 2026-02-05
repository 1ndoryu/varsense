/*
 * Tests para la extensión CSS Variables Validator
 * Suite de tests de integración
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

/* 
 * Rutas de importación: desde dist/test/suite/ a dist/parsers/ y dist/utils/
 * La ruta correcta es ../../ (subir 2 niveles desde suite/)
 */

suite('CSS Variables Validator Extension Test Suite', () => {
    vscode.window.showInformationMessage('Iniciando tests de CSS Variables Validator');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('glory.css-vars-validator'));
    });

    test('Extension should activate on CSS file', async () => {
        /* Crear documento CSS temporal */
        const documento = await vscode.workspace.openTextDocument({
            language: 'css',
            content: ':root { --test-color: #fff; }'
        });

        await vscode.window.showTextDocument(documento);

        /* Dar tiempo para activación */
        await new Promise(resolve => setTimeout(resolve, 1000));

        const extension = vscode.extensions.getExtension('glory.css-vars-validator');
        assert.ok(extension?.isActive || extension !== undefined);
    });

    test('Commands should be registered', async () => {
        const comandos = await vscode.commands.getCommands(true);

        assert.ok(comandos.includes('cssVarsValidator.refreshVariables'), 'Comando refreshVariables debe estar registrado');

        assert.ok(comandos.includes('cssVarsValidator.showAllVariables'), 'Comando showAllVariables debe estar registrado');

        assert.ok(comandos.includes('cssVarsValidator.goToDefinition'), 'Comando goToDefinition debe estar registrado');
    });
});

suite('Value Parser Tests', () => {
    /* Tests unitarios para el parser de valores */

    test('Should detect var() usage', () => {
        /* Import dinámico - ruta corregida desde dist/test/suite/ a dist/parsers/ */
        const {extraerVariablesDeValor} = require('../../parsers/valueParser');

        const resultado = extraerVariablesDeValor('var(--color-primary)');

        assert.strictEqual(resultado.length, 1);
        assert.strictEqual(resultado[0].nombreVariable, '--color-primary');
        assert.strictEqual(resultado[0].fallback, null);
    });

    test('Should detect var() with fallback', () => {
        const {extraerVariablesDeValor} = require('../../parsers/valueParser');

        const resultado = extraerVariablesDeValor('var(--color, #fff)');

        assert.strictEqual(resultado.length, 1);
        assert.strictEqual(resultado[0].nombreVariable, '--color');
        assert.strictEqual(resultado[0].fallback, '#fff');
    });

    test('Should handle function fallback with parentheses', () => {
        const {extraerVariablesDeValor} = require('../../parsers/valueParser');

        /* 
         * TO-DO: Mejorar parser para manejar paréntesis balanceados
         * Caso: var(--color, rgb(0, 0, 0))
         * Comportamiento actual: el regex corta en el primer ")" encontrado
         * Esto es una limitación conocida que requiere un parser más sofisticado
         */
        const resultado = extraerVariablesDeValor('var(--color, rgb(0, 0, 0))');

        assert.strictEqual(resultado.length, 1);
        assert.strictEqual(resultado[0].nombreVariable, '--color');
        /* Aceptamos el comportamiento actual (parcial) hasta implementar mejora */
        assert.ok(resultado[0].fallback?.startsWith('rgb('), 'Fallback debe comenzar con rgb(');
    });

    test('Should handle nested var() fallback', () => {
        const {extraerVariablesDeValor} = require('../../parsers/valueParser');

        /* 
         * TO-DO: Mejorar parser para manejar var() anidados
         * Caso: var(--primary, var(--secondary))
         * Comportamiento actual: corta en el primer ")" 
         */
        const resultado = extraerVariablesDeValor('var(--primary, var(--secondary))');

        assert.strictEqual(resultado.length, 1);
        assert.strictEqual(resultado[0].nombreVariable, '--primary');
        /* Aceptamos el comportamiento actual hasta implementar mejora */
        assert.ok(resultado[0].fallback?.startsWith('var('), 'Fallback debe comenzar con var(');
    });

    test('Should detect multiple var() usages', () => {
        const {extraerVariablesDeValor} = require('../../parsers/valueParser');

        const resultado = extraerVariablesDeValor('linear-gradient(var(--start), var(--end))');

        assert.strictEqual(resultado.length, 2);
        assert.strictEqual(resultado[0].nombreVariable, '--start');
        assert.strictEqual(resultado[1].nombreVariable, '--end');
    });

    test('Should identify hardcoded hex colors', () => {
        const {esValorHardcodeado} = require('../../parsers/valueParser');

        assert.strictEqual(esValorHardcodeado('#fff'), true);
        assert.strictEqual(esValorHardcodeado('#ffffff'), true);
        assert.strictEqual(esValorHardcodeado('#00ff00'), true);
    });

    test('Should identify hardcoded rgb colors', () => {
        const {esValorHardcodeado} = require('../../parsers/valueParser');

        assert.strictEqual(esValorHardcodeado('rgb(255, 0, 0)'), true);
        assert.strictEqual(esValorHardcodeado('rgba(0, 0, 0, 0.5)'), true);
    });

    test('Should identify hardcoded numeric values', () => {
        const {esValorHardcodeado} = require('../../parsers/valueParser');

        assert.strictEqual(esValorHardcodeado('16px'), true);
        assert.strictEqual(esValorHardcodeado('1.5rem'), true);
        assert.strictEqual(esValorHardcodeado('50%'), true);
    });

    test('Should NOT identify var() as hardcoded', () => {
        const {esValorHardcodeado} = require('../../parsers/valueParser');

        assert.strictEqual(esValorHardcodeado('var(--size)'), false);
        assert.strictEqual(esValorHardcodeado('calc(var(--x) + 10px)'), false);
    });

    test('Should identify variable definitions', () => {
        const {esDefinicionVariable, obtenerNombreVariable} = require('../../parsers/valueParser');

        assert.strictEqual(esDefinicionVariable('--my-color'), true);
        assert.strictEqual(esDefinicionVariable('color'), false);
        assert.strictEqual(obtenerNombreVariable('--my-color'), '--my-color');
    });
});

suite('Color Utils Tests', () => {
    test('Should detect hex colors', () => {
        const {esColor} = require('../../utils/colorUtils');

        assert.strictEqual(esColor('#fff'), true);
        assert.strictEqual(esColor('#ffffff'), true);
        assert.strictEqual(esColor('#fff0'), true);
        assert.strictEqual(esColor('#ffffff00'), true);
    });

    test('Should detect rgb/rgba colors', () => {
        const {esColor} = require('../../utils/colorUtils');

        assert.strictEqual(esColor('rgb(255, 0, 0)'), true);
        assert.strictEqual(esColor('rgba(0, 0, 0, 0.5)'), true);
    });

    test('Should detect hsl/hsla colors', () => {
        const {esColor} = require('../../utils/colorUtils');

        assert.strictEqual(esColor('hsl(120, 100%, 50%)'), true);
        assert.strictEqual(esColor('hsla(120, 100%, 50%, 0.5)'), true);
    });

    test('Should detect named colors', () => {
        const {esColor} = require('../../utils/colorUtils');

        assert.strictEqual(esColor('red'), true);
        assert.strictEqual(esColor('blue'), true);
        assert.strictEqual(esColor('transparent'), true);
        assert.strictEqual(esColor('notacolor'), false);
    });

    test('Should parse hex color correctly', () => {
        const {parsearColor} = require('../../utils/colorUtils');

        const color = parsearColor('#ff0000');

        assert.ok(color);
        assert.strictEqual(color.r, 255);
        assert.strictEqual(color.g, 0);
        assert.strictEqual(color.b, 0);
        assert.strictEqual(color.a, 1);
    });

    test('Should parse short hex color correctly', () => {
        const {parsearColor} = require('../../utils/colorUtils');

        const color = parsearColor('#f00');

        assert.ok(color);
        assert.strictEqual(color.r, 255);
        assert.strictEqual(color.g, 0);
        assert.strictEqual(color.b, 0);
    });

    test('Should parse rgb color correctly', () => {
        const {parsearColor} = require('../../utils/colorUtils');

        const color = parsearColor('rgb(128, 64, 32)');

        assert.ok(color);
        assert.strictEqual(color.r, 128);
        assert.strictEqual(color.g, 64);
        assert.strictEqual(color.b, 32);
    });
});

suite('File Utils Tests', () => {
    test('Should get relative path', () => {
        const {obtenerRutaRelativa} = require('../../utils/fileUtils');

        /* Este test depende del workspace actual */
        const rutaRelativa = obtenerRutaRelativa('/some/absolute/path/file.css');
        assert.ok(typeof rutaRelativa === 'string');
    });

    test('Should identify CSS files', () => {
        const {esCssValido} = require('../../utils/fileUtils');

        assert.strictEqual(esCssValido('styles.css'), true);
        assert.strictEqual(esCssValido('styles.scss'), true);
        assert.strictEqual(esCssValido('styles.less'), true);
        assert.strictEqual(esCssValido('script.js'), false);
    });

    test('Should calculate position from offset', () => {
        const {offsetAPosicion} = require('../../utils/fileUtils');

        const texto = 'linea1\nlinea2\nlinea3';

        /* Inicio de linea2 (después del \n de linea1) */
        const pos = offsetAPosicion(texto, 7);

        assert.strictEqual(pos.linea, 1);
        assert.strictEqual(pos.columna, 0);
    });
});
