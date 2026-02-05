/*
 * Provider de autocompletado para variables CSS
 * Proporciona sugerencias contextuales basadas en la propiedad CSS actual
 * Ordena las sugerencias por frecuencia de uso
 */

import * as vscode from 'vscode';
import { CompletionInfo } from '../types';
import { obtenerPropiedadEnPosicion } from '../parsers/cssParser';
import { obtenerScanner } from '../services/variableScanner';
import { obtenerResolver } from '../services/variableResolver';
import { obtenerConfigService } from '../services/configService';
import { parsearColor } from '../utils/colorUtils';
import { obtenerRutaRelativa } from '../utils/fileUtils';

/*
 * Provider de autocompletado para CSS
 */
export class CompletionProvider implements vscode.CompletionItemProvider {
    
    /*
     * Caracteres que disparan el autocompletado
     */
    public static readonly triggerCharacters = ['-', '('];
    
    /*
     * Proporciona items de autocompletado
     */
    public provideCompletionItems(
        documento: vscode.TextDocument,
        posicion: vscode.Position,
        _token: vscode.CancellationToken,
        _contexto: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const lineaTexto = documento.lineAt(posicion.line).text;
        const textoAntesCursor = lineaTexto.substring(0, posicion.character);
        
        /* Verificar si estamos dentro de var() o escribiendo var( */
        const dentroDeVar = this.estaDentroDeVar(textoAntesCursor);
        const escribiendoVar = textoAntesCursor.endsWith('var(') || 
                              textoAntesCursor.endsWith('var(--') ||
                              /var\(--[\w-]*$/.test(textoAntesCursor);
        
        if (!dentroDeVar && !escribiendoVar) {
            /* Verificar si podemos sugerir var() */
            if (this.puedesSugerirVar(textoAntesCursor)) {
                return this.crearSugerenciasVar(documento, posicion);
            }
            return null;
        }
        
        /* Obtener la propiedad CSS actual para contexto */
        const propiedad = obtenerPropiedadEnPosicion(documento, posicion);
        
        /* Obtener todas las variables y filtrar/ordenar según contexto */
        const completionItems = this.generarCompletionItems(propiedad, textoAntesCursor);
        
        return completionItems;
    }
    
    /*
     * Proporciona información adicional para un item seleccionado
     */
    public resolveCompletionItem(
        item: vscode.CompletionItem,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CompletionItem> {
        /* Agregar documentación detallada si está disponible */
        const itemData = (item as unknown as { data?: unknown }).data;
        if (itemData && typeof itemData === 'string') {
            const nombreVariable = itemData;
            const resolver = obtenerResolver();
            const resultado = resolver.resolver(nombreVariable);
            
            if (resultado.encontrada && resultado.variable) {
                const variable = resultado.variable;
                const md = new vscode.MarkdownString();
                md.isTrusted = true;
                md.supportHtml = true;
                
                /* Valor */
                md.appendMarkdown(`**Valor:** \`${variable.valor}\`\n\n`);
                
                /* Valor resuelto si es diferente */
                if (variable.valorResuelto && variable.valorResuelto !== variable.valor) {
                    md.appendMarkdown(`**Resuelto:** \`${variable.valorResuelto}\`\n\n`);
                }
                
                /* Preview de color */
                const valorFinal = variable.valorResuelto || variable.valor;
                const infoColor = parsearColor(valorFinal);
                if (infoColor) {
                    md.appendMarkdown(`**Color:** ${infoColor.hex}\n\n`);
                }
                
                /* Ubicación */
                const rutaRelativa = obtenerRutaRelativa(variable.archivo);
                md.appendMarkdown(`📁 ${rutaRelativa}:${variable.linea + 1}`);
                
                item.documentation = md;
            }
        }
        
        return item;
    }
    
    /*
     * Verifica si el cursor está dentro de una llamada var()
     */
    private estaDentroDeVar(texto: string): boolean {
        /* Contar paréntesis abiertos y cerrados después del último var( */
        const ultimoVar = texto.lastIndexOf('var(');
        if (ultimoVar === -1) {
            return false;
        }
        
        const despuesVar = texto.substring(ultimoVar + 4);
        let profundidad = 1;
        
        for (const char of despuesVar) {
            if (char === '(') {
                profundidad++;
            } else if (char === ')') {
                profundidad--;
            }
            
            if (profundidad === 0) {
                return false;
            }
        }
        
        return true;
    }
    
    /*
     * Verifica si podemos sugerir var() en esta posición
     */
    private puedesSugerirVar(texto: string): boolean {
        /* Después de : en una declaración CSS */
        const despuesDosPuntos = /:\s*[\w-]*$/.test(texto);
        return despuesDosPuntos;
    }
    
    /*
     * Crea sugerencias de var() cuando aún no se ha escrito
     */
    private crearSugerenciasVar(
        documento: vscode.TextDocument,
        posicion: vscode.Position
    ): vscode.CompletionItem[] {
        const propiedad = obtenerPropiedadEnPosicion(documento, posicion);
        const items: vscode.CompletionItem[] = [];
        
        /* Sugerir las variables más relevantes para esta propiedad */
        const variablesRelevantes = this.obtenerVariablesRelevantes(propiedad, 5);
        
        for (let i = 0; i < variablesRelevantes.length; i++) {
            const info = variablesRelevantes[i];
            const item = new vscode.CompletionItem(
                `var(${info.variable.nombre})`,
                vscode.CompletionItemKind.Value
            );
            
            item.insertText = `var(${info.variable.nombre})`;
            item.detail = info.variable.valor;
            item.sortText = String(i).padStart(4, '0');
            (item as unknown as { data: unknown }).data = info.variable.nombre;
            
            /* Preview de color */
            const infoColor = parsearColor(info.variable.valorResuelto || info.variable.valor);
            if (infoColor) {
                item.kind = vscode.CompletionItemKind.Color;
            }
            
            items.push(item);
        }
        
        return items;
    }
    
    /*
     * Genera items de autocompletado para variables CSS
     */
    private generarCompletionItems(
        propiedad: string | null,
        textoAntesCursor: string
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        
        /* Extraer texto de búsqueda actual */
        const busquedaMatch = /var\((-*[\w-]*)$/.exec(textoAntesCursor);
        const textoBusqueda = busquedaMatch ? busquedaMatch[1].replace(/^-+/, '') : '';
        
        /* Obtener variables relevantes */
        const variablesInfo = this.obtenerVariablesRelevantes(propiedad, 50, textoBusqueda);
        
        for (let i = 0; i < variablesInfo.length; i++) {
            const info = variablesInfo[i];
            const item = this.crearCompletionItem(info, i);
            items.push(item);
        }
        
        return items;
    }
    
    /*
     * Obtiene variables relevantes ordenadas por relevancia
     */
    private obtenerVariablesRelevantes(
        propiedad: string | null,
        limite: number,
        filtro: string = ''
    ): CompletionInfo[] {
        const scanner = obtenerScanner();
        const configService = obtenerConfigService();
        const resolver = obtenerResolver();
        
        let variables = scanner.obtenerTodasVariables();
        
        /* Filtrar por texto de búsqueda */
        if (filtro) {
            const filtroLower = filtro.toLowerCase();
            variables = variables.filter(v => 
                v.nombre.toLowerCase().includes(filtroLower)
            );
        }
        
        /* Obtener palabras clave para la propiedad actual */
        const palabrasClave = propiedad 
            ? configService.obtenerSugerenciasParaPropiedad(propiedad)
            : [];
        
        /* Calcular relevancia para cada variable */
        const conRelevancia: CompletionInfo[] = variables.map(variable => {
            let relevancia = variable.frecuenciaUso;
            const etiquetasCoincidentes: string[] = [];
            const nombreLower = variable.nombre.toLowerCase();
            
            /* Bonus por coincidencia con palabras clave de la propiedad */
            for (const palabra of palabrasClave) {
                if (nombreLower.includes(palabra.toLowerCase())) {
                    relevancia += 50;
                    etiquetasCoincidentes.push(palabra);
                }
            }
            
            /* Bonus por coincidencia exacta con filtro */
            if (filtro && nombreLower.includes(filtro.toLowerCase())) {
                relevancia += 30;
            }
            
            /* Bonus si el tipo coincide (ej: propiedad color y variable es color) */
            if (propiedad) {
                const esPropColor = ['color', 'background', 'background-color', 'border-color']
                    .some(p => propiedad.includes(p));
                
                if (esPropColor && variable.esColor) {
                    relevancia += 40;
                }
            }
            
            return {
                variable: {
                    ...variable,
                    valorResuelto: resolver.obtenerValorResuelto(variable.nombre) ?? undefined
                },
                relevancia,
                etiquetasCoincidentes
            };
        });
        
        /* Ordenar por relevancia (mayor primero) */
        return conRelevancia
            .sort((a, b) => b.relevancia - a.relevancia)
            .slice(0, limite);
    }
    
    /*
     * Crea un item de completion para una variable
     */
    private crearCompletionItem(info: CompletionInfo, indice: number): vscode.CompletionItem {
        const variable = info.variable;
        
        const item = new vscode.CompletionItem(
            variable.nombre,
            vscode.CompletionItemKind.Variable
        );
        
        /* Texto a insertar (solo el nombre, ya estamos dentro de var()) */
        item.insertText = variable.nombre;
        
        /* Información de preview */
        const valorMostrar = variable.valorResuelto || variable.valor;
        item.detail = valorMostrar;
        
        /* Orden de sorting */
        item.sortText = String(indice).padStart(4, '0');
        
        /* Datos para resolución posterior */
        (item as unknown as { data: unknown }).data = variable.nombre;
        
        /* Si es un color, mostrar como Color */
        const infoColor = parsearColor(valorMostrar);
        if (infoColor) {
            item.kind = vscode.CompletionItemKind.Color;
            /* VS Code puede mostrar un cuadro de color si el detail es un color hex */
            item.detail = infoColor.hex;
        }
        
        /* Etiquetas de coincidencia */
        if (info.etiquetasCoincidentes.length > 0) {
            item.label = {
                label: variable.nombre,
                description: info.etiquetasCoincidentes.join(', ')
            };
        }
        
        /* Filtrar por texto ya escrito */
        item.filterText = variable.nombre;
        
        return item;
    }
}

/*
 * Crea y registra el completion provider
 */
export function crearCompletionProvider(): vscode.Disposable {
    return vscode.languages.registerCompletionItemProvider(
        [
            { language: 'css', scheme: 'file' },
            { language: 'scss', scheme: 'file' },
            { language: 'less', scheme: 'file' },
            { language: 'vue', scheme: 'file' }
        ],
        new CompletionProvider(),
        ...CompletionProvider.triggerCharacters
    );
}
