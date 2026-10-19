import * as esbuild from 'esbuild';
import { aliasPlugin } from './scripts/alias-esbuild.mjs';

const isWatch = process.argv.includes('--watch');
const isMinify = process.argv.includes('--minify');

const extensionOptions = {
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    minify: isMinify,
    sourcemap: !isMinify,
    plugins: [aliasPlugin],
};

const cliOptions = {
    entryPoints: ['./src/cli/main.ts'],
    bundle: true,
    outfile: 'dist/cli/index.js',
    format: 'cjs',
    platform: 'node',
    minify: isMinify,
    sourcemap: !isMinify,
    plugins: [aliasPlugin],
};

const lspOptions = {
    entryPoints: ['./src/lsp/server.ts'],
    bundle: true,
    outfile: 'dist/lsp/server.js',
    format: 'cjs',
    platform: 'node',
    minify: isMinify,
    sourcemap: !isMinify,
    plugins: [aliasPlugin],
};

const builds = [extensionOptions, cliOptions, lspOptions];

if (isWatch) {
    const contexts = await Promise.all(builds.map(options => esbuild.context(options)));
    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('[esbuild] watching...');
} else {
    await Promise.all(builds.map(options => esbuild.build(options)));
}
