import * as fs from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createCoreDocument, CoreTextDocument } from './types';
import { DocumentProvider, WorkspaceFile, WorkspaceFileProvider } from './workspaceProviders';

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
    constructor(private readonly rootPath: string) {}

    public async findFiles(patterns: string[], exclude: string[]): Promise<WorkspaceFile[]> {
        const files: WorkspaceFile[] = [];
        await this.walk(this.rootPath, patterns, exclude, files);
        return files;
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

            if (relativePath && (matchesAnyGlob(relativePath, exclude) || matchesAnyGlob(relativeForDirectory, exclude))) {
                continue;
            }

            if (entry.isDirectory()) {
                await this.walk(absolutePath, patterns, exclude, files);
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
 * documentos. Evita leer/parsing dos veces el mismo CSS/TS en scan combinado. */
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

    public clear(): void {
        this.cache.clear();
    }
}
