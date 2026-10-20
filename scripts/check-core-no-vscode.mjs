import fs from 'fs';
import { builtinModules } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

/* src/core es agnóstico de editor y de runtime: no importa vscode ni módulos
 * built-in de Node (fs, path, crypto, url…). Lo que los necesita vive en
 * src/vscode/ o en src/node/, y entra al core por puertos inyectados. */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = path.join(repoRoot, 'src', 'core');

const nodeBuiltins = [...new Set(builtinModules.map(name => name.replace(/^node:/, '')))];
const builtinAlternatives = nodeBuiltins.map(name => name.replace(/[/.]/g, '\\$&')).join('|');

/* Captura import/export/require/import() de 'vscode' o de un built-in, con o sin prefijo node:. */
const forbiddenImportPattern = new RegExp(
  String.raw`(?:from\s+|import\s*\(\s*|require\(\s*|import\s+)['"](?:node:)?(?:vscode|(?:${builtinAlternatives})(?:/[\w/.-]*)?)['"]`,
  'g',
);

function walk(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return walk(entryPath);
    }

    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

function lineForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

const violations = [];

for (const filePath of walk(coreRoot)) {
  const text = fs.readFileSync(filePath, 'utf8');
  forbiddenImportPattern.lastIndex = 0;

  let match;
  while ((match = forbiddenImportPattern.exec(text)) !== null) {
    const specifier = match[0].match(/['"]([^'"]+)['"]/)[1];
    violations.push({
      filePath,
      line: lineForIndex(text, match.index),
      specifier,
    });
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    const relativePath = path.relative(repoRoot, violation.filePath).replace(/\\/g, '/');
    const destino = violation.specifier.replace(/^node:/, '') === 'vscode'
      ? 'el adaptador vive en src/vscode'
      : 'el adaptador Node vive en src/node y entra por puertos';
    console.error(`${relativePath}:${violation.line}:1 error: src/core no debe importar "${violation.specifier}" (${destino})`);
  }
  process.exit(1);
}

console.log('[check-core-no-vscode] OK (sin vscode ni built-ins de Node en src/core)');
