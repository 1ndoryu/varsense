/*
 * Provider de hover para variables CSS
 * Muestra información detallada al posicionar el cursor sobre una variable
 * Incluye valor, archivo de origen, y preview de color si aplica
 */

import * as vscode from 'vscode';
import { encontrarVariableEnPosicion } from '@/parsers/cssParser';
import { VariableScanner } from '@/services/variableScanner';
import { obtenerResolver } from '@/services/variableResolver';
import { parsearColor, generarMarkdownColor } from '@/utils/colorUtils';
import { obtenerRutaRelativa } from '@/utils/fileUtils';

/*
 * Provider de hover para CSS
 */
export class HoverProvider implements vscode.HoverProvider {
    
    /*
     * Proporciona información de hover
     */
    public provideHover(
        documento: vscode.TextDocument,
        posicion: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        /* Buscar variable en la posición del cursor */
        const variableEnPosicion = encontrarVariableEnPosicion(documento, posicion);
        
        if (!variableEnPosicion) {
            return null;
        }
        
        const { nombre, rango } = variableEnPosicion;
        
        /* Obtener información de la variable */
        const variable = VariableScanner.obtenerInstancia().obtenerVariable(nombre);
        
        if (!variable) {
            /* Variable no encontrada - mostrar mensaje de error */
            return new vscode.Hover(
                this.crearMensajeNoEncontrada(nombre),
                rango
            );
        }
        
        /* Crear contenido del hover */
        const contenido = this.crearContenidoHover(variable.nombre);
        
        return new vscode.Hover(contenido, rango);
    }
    
    /*
     * Crea el contenido markdown del hover para una variable
     */
    private crearContenidoHover(nombreVariable: string): vscode.MarkdownString {
        const resolver = obtenerResolver();
        const resultado = resolver.resolver(nombreVariable);
        
        if (!resultado.encontrada || !resultado.variable) {
            return this.crearMensajeNoEncontrada(nombreVariable);
        }
        
        const variable = resultado.variable;
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;
        
        /* Encabezado con nombre de variable */
        md.appendMarkdown(`### \`${variable.nombre}\`\n\n`);
        
        /* Preview de color si aplica */
        const valorFinal = variable.valorResuelto || variable.valor;
        const infoColor = parsearColor(valorFinal);
        
        if (infoColor) {
            /* Mostrar preview de color */
            md.appendMarkdown(generarMarkdownColor(infoColor));
            md.appendMarkdown('\n\n---\n\n');
        }
        
        /* Valor definido */
        md.appendMarkdown(`**Valor:** \`${variable.valor}\`\n\n`);
        
        /* Valor resuelto si es diferente (cuando referencia otras variables) */
        if (variable.valorResuelto && variable.valorResuelto !== variable.valor) {
            md.appendMarkdown(`**Valor Resuelto:** \`${variable.valorResuelto}\`\n\n`);
            
            /* Mostrar cadena de resolución */
            if (resultado.cadenaResolucion && resultado.cadenaResolucion.length > 1) {
                const cadena = resultado.cadenaResolucion.map(v => `\`${v}\``).join(' → ');
                md.appendMarkdown(`**Cadena:** ${cadena}\n\n`);
            }
        }
        
        md.appendMarkdown('---\n\n');
        
        /* Ubicación de la definición */
        const rutaRelativa = obtenerRutaRelativa(variable.archivo);
        const lineaHumana = variable.linea + 1;
        
        /* Crear link clickeable al archivo */
        const uri = vscode.Uri.file(variable.archivo);
        const _args = encodeURIComponent(JSON.stringify({
            path: variable.archivo,
            line: variable.linea
        }));
        
        md.appendMarkdown(`📁 **Definido en:** [${rutaRelativa}:${lineaHumana}](${uri.toString()}#L${lineaHumana})\n\n`);
        
        /* Estadísticas de uso */
        if (variable.frecuenciaUso > 0) {
            md.appendMarkdown(`📊 **Usos detectados:** ${variable.frecuenciaUso}\n`);
        }
        
        return md;
    }
    
    /*
     * Crea mensaje para variables no encontradas
     */
    private crearMensajeNoEncontrada(nombreVariable: string): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        
        md.appendMarkdown(`### ⚠️ Variable No Encontrada\n\n`);
        md.appendMarkdown(`La variable \`${nombreVariable}\` no está definida en ninguno de los archivos de variables configurados.\n\n`);
        
        /* Sugerir variables similares usando el scanner */
        const similares = VariableScanner.obtenerInstancia().buscarSimilares(nombreVariable, 3);
        
        if (similares.length > 0) {
            md.appendMarkdown(`**¿Quisiste decir?**\n`);
            for (const variable of similares) {
                md.appendMarkdown(`- \`${variable.nombre}\`\n`);
            }
        }
        
        return md;
    }
}

/*
 * Crea y registra el hover provider
 */
export function crearHoverProvider(): vscode.Disposable {
    return vscode.languages.registerHoverProvider(
        [
            { language: 'css', scheme: 'file' },
            { language: 'scss', scheme: 'file' },
            { language: 'less', scheme: 'file' },
            { language: 'vue', scheme: 'file' }
        ],
        new HoverProvider()
    );
}
