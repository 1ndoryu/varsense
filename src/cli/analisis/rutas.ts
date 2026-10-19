/* Resolución de rutas del workspace, manifiesto --files-from y filtros de alcance. */
import * as fs from 'fs/promises';
import * as path from 'path';
import { CoreFinding } from '@/core/types';
import { matchesAnyGlob } from '@/core/nodeProviders';
import type { ParsedCliArgs } from '../args';

export function pathKey(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isPathInside(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function readFilesFromManifest(args: ParsedCliArgs): Promise<Set<string> | undefined> {
    if (!args.filesFromPath) {
        return undefined;
    }

    const manifestPath = path.resolve(args.workspacePath, args.filesFromPath);
    const workspaceRealPath = await fs.realpath(args.workspacePath);
    const manifestRealPath = await fs.realpath(manifestPath);
    if (!isPathInside(workspaceRealPath, manifestRealPath)) {
        throw new Error('--files-from debe estar dentro del workspace');
    }

    const raw = await fs.readFile(manifestPath, 'utf8');
    const files = new Set<string>();
    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim().replace(/\\/g, '/');
        if (!line) {
            continue;
        }
        if (path.isAbsolute(line) || /^[A-Za-z]:\//.test(line)) {
            throw new Error('Ruta absoluta no permitida en --files-from: ' + line);
        }
        const resolved = path.resolve(args.workspacePath, line);
        if (!isPathInside(args.workspacePath, resolved)) {
            throw new Error('Ruta fuera del workspace en --files-from: ' + line);
        }
        const key = pathKey(resolved);
        if (files.has(key)) {
            throw new Error('Ruta duplicada en --files-from: ' + line);
        }
        try {
            const stats = await fs.stat(resolved);
            if (stats.isDirectory()) {
                throw new Error('Ruta directorio no permitida en --files-from: ' + line);
            }
            const realPath = await fs.realpath(resolved);
            if (!isPathInside(workspaceRealPath, realPath)) {
                throw new Error('Ruta fuera del workspace en --files-from: ' + line);
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('directorio no permitida')) {
                throw error;
            }
            const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
            if (code !== 'ENOENT') {
                throw error;
            }
        }
        files.add(key);
    }
    return files;
}

export function isScopedFile(filePath: string, scopeKeys: Set<string> | undefined): boolean {
    return !scopeKeys || scopeKeys.has(pathKey(filePath));
}

export function isFindingScoped(finding: CoreFinding, scopeKeys: Set<string> | undefined): boolean {
    if (!scopeKeys) {
        return true;
    }
    const file = finding.metadata?.file;
    return typeof file === 'string' && isScopedFile(file, scopeKeys);
}

export function isIncluded(filePath: string, workspacePath: string, includePatterns: string[]): boolean {
    const relativePath = path.relative(workspacePath, filePath).replace(/\\/g, '/');
    return matchesAnyGlob(relativePath, includePatterns);
}
