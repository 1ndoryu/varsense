import * as fs from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createCoreDocument, CoreTextDocument } from '@/core/types';
import { DocumentProvider, WorkspaceFile, WorkspaceFileProvider } from '@/core/proveedores/workspaceProviders';
import { TAMANO_MAXIMO_ARCHIVO_BYTES } from '@/core/analisis/limites';

function normalizarRuta(ruta: string): string {
    return ruta.replace(/\\/g, '/');
}

function normalizarPatron(pattern: string): string {
    return normalizarRuta(pattern.trim()).replace(/^\.\//, '');
}

function escaparRegex(char: string): string {
    return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

export function globToRegExp(pattern: string): RegExp {
    const normalizado = normalizarPatron(pattern);
    let source = '';
    let index = 0;

    while (index < normalizado.length) {
        const char = normalizado[index];
        const next = normalizado[index + 1];
        const nextAfter = normalizado[index + 2];

        if (char === '*' && next === '*') {
            if (nextAfter === '/') {
                source += '(?:.*/)?';
                index += 3;
            } else {
                source += '.*';
                index += 2;
            }
            continue;
        }

        if (char === '*') {
            source += '[^/]*';
            index++;
            continue;
        }

        if (char === '?') {
            source += '[^/]';
            index++;
            continue;
        }

        if (char === '/') {
            source += '\\/';
            index++;
            continue;
        }

        source += escaparRegex(char);
        index++;
    }

    return new RegExp(`^${source}$`);
}

export function matchesGlob(relativePath: string, pattern: string): boolean {
    return globToRegExp(pattern).test(normalizarRuta(relativePath));
}

export function matchesAnyGlob(relativePath: string, patterns: string[]): boolean {
    if (patterns.length === 0) {
        return false;
    }

    return patterns.some(pattern => matchesGlob(relativePath, pattern));
}

export function languageIdForFile(filePath: string): string {
    switch (path.extname(filePath).toLowerCase()) {
        case '.css': return 'css';
        case '.scss': return 'scss';
        case '.less': return 'less';
        case '.tsx': return 'typescriptreact';
        case '.jsx': return 'javascriptreact';
        case '.ts': return 'typescript';
        case '.js': return 'javascript';
        case '.html': return 'html';
        case '.php': return 'php';
        default: return 'plaintext';
    }
}

export class NodeWorkspaceFileProvider implements WorkspaceFileProvider {
    /* Una invocación CLI reutiliza el provider para variables, clases y
     * archivos candidatos. Cachear el snapshot por exclusiones evita repetir
     * el recorrido recursivo completo por cada etapa/patrón; el proceso es
     * one-shot, por lo que no hay cambios externos que invalidar durante el
     * análisis. Cada combinación de exclusiones conserva su propio snapshot
     * para no mezclar contratos de llamadas distintas. */
    private readonly snapshots = new Map<string, WorkspaceFile[]>();
    /* [V7] Medida de tamaño por archivo, cacheada: un archivo se mide una sola vez aunque se pida con varios patrones. */
    private readonly tamanoValido = new Map<string, Promise<boolean>>();
    /* [V7] Rutas omitidas por superar TAMANO_MAXIMO_ARCHIVO_BYTES; el CLI las informa en stderr. */
    public readonly omitidosPorTamano: string[] = [];

    constructor(private readonly rootPath: string) {}

    public async findFiles(patterns: string[], exclude: string[]): Promise<WorkspaceFile[]> {
        const snapshotKey = JSON.stringify(exclude);
        let snapshot = this.snapshots.get(snapshotKey);
        if (!snapshot) {
            snapshot = [];
            await this.walk(this.rootPath, ['**/*'], exclude, snapshot);
            this.snapshots.set(snapshotKey, snapshot);
        }

        const coincidentes = snapshot.filter(file => {
            const relativePath = normalizarRuta(path.relative(this.rootPath, file.fsPath));
            return matchesAnyGlob(relativePath, patterns);
        });
        const aceptados = await Promise.all(coincidentes.map(file => this.cabeEnLimite(file)));
        return coincidentes.filter((_, indice) => aceptados[indice]);
    }

    /* [V7] Un archivo demasiado grande no entra en el análisis; se cuenta en omitidosPorTamano. */
    private cabeEnLimite(file: WorkspaceFile): Promise<boolean> {
        let valido = this.tamanoValido.get(file.fsPath);
        if (!valido) {
            valido = this.medirTamano(file.fsPath);
            this.tamanoValido.set(file.fsPath, valido);
        }
        return valido;
    }

    private async medirTamano(fsPath: string): Promise<boolean> {
        let size: number;
        try {
            ({ size } = await fs.stat(fsPath));
        } catch {
            /* Si el archivo desapareció tras el recorrido, la lectura posterior reporta el error real. */
            return true;
        }
        if (size <= TAMANO_MAXIMO_ARCHIVO_BYTES) {
            return true;
        }
        this.omitidosPorTamano.push(fsPath);
        return false;
    }

    private async walk(
        currentPath: string,
        patterns: string[],
        exclude: string[],
        files: WorkspaceFile[]
    ): Promise<void> {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
            const absolutePath = path.join(currentPath, entry.name);
            const relativePath = normalizarRuta(path.relative(this.rootPath, absolutePath));
            const relativeForDirectory = entry.isDirectory() ? `${relativePath}/` : relativePath;

            /* [318A-7V17] Repos anidados fuera del alcance: un directorio cuyo
             * `.git` es un ARCHIVO es un submódulo/worktree git (un proyecto real en
             * los consumidores). El código de otro repo se arregla en su propio
             * repo, no desde el consumidor; analizarlo duplicaba hallazgos
             * (claseHuerfana de un proyecto real). Internals `.git` tampoco se
             * recorren: nunca son código analizable. El repo raíz tiene `.git`
             * directorio y no se ve afectado.
             *
             * [318A-7V21] La forma DIRECTORIO de `.git` también es un repo
             * anidado: un consumidor con el submódulo clonado completo (p. ej.
             * un proyecto real, `submodulo-ejemplo/.git` como directorio) escapaba al filtro y sus
             * hallazgos se atribuían al consumidor. Ambas formas se excluyen. */
            if (entry.name === '.git') {
                continue;
            }
            if (entry.isDirectory()) {
                let esSubmodulo = false;
                try {
                    const gitMarker = await fs.lstat(path.join(absolutePath, '.git'));
                    esSubmodulo = gitMarker.isFile() || gitMarker.isDirectory();
                } catch {
                    esSubmodulo = false;
                }
                if (esSubmodulo) {
                    continue;
                }
                if (relativePath && (matchesAnyGlob(relativePath, exclude) || matchesAnyGlob(relativeForDirectory, exclude))) {
                    continue;
                }
                await this.walk(absolutePath, patterns, exclude, files);
                continue;
            } else if (relativePath && (matchesAnyGlob(relativePath, exclude) || matchesAnyGlob(relativeForDirectory, exclude))) {
                continue;
            }

            if (entry.isFile() && matchesAnyGlob(relativePath, patterns)) {
                files.push({
                    uri: pathToFileURL(absolutePath).toString(),
                    fsPath: absolutePath,
                });
            }
        }
    }
}

export class NodeDocumentProvider implements DocumentProvider {
    public async openTextDocument(file: WorkspaceFile): Promise<CoreTextDocument> {
        const content = await fs.readFile(file.fsPath, 'utf8');
        return createCoreDocument({
            uri: file.uri,
            fileName: file.fsPath,
            languageId: languageIdForFile(file.fsPath),
            content,
        });
    }
}

/* [018A-5] Todos los analizadores de una ejecución comparten el snapshot de
 * documentos. Evita leer/parsing dos veces el mismo CSS/TS en scan combinado.
 * El cache no detecta cambios por sí solo: un watcher/adaptador debe invalidar
 * el fsPath antes de volver a analizarlo. */
export class CachedNodeDocumentProvider extends NodeDocumentProvider {
    private readonly cache = new Map<string, Promise<CoreTextDocument>>();

    public override openTextDocument(file: WorkspaceFile): Promise<CoreTextDocument> {
        const cached = this.cache.get(file.fsPath);
        if (cached) {
            return cached;
        }
        const pending = super.openTextDocument(file);
        this.cache.set(file.fsPath, pending);
        return pending;
    }

    public invalidate(fsPath: string): void {
        this.cache.delete(fsPath);
    }

    public clear(): void {
        this.cache.clear();
    }
}
