import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/*
 * Plugin para resolver aliases @/* -> src/*
 * Equivalente a los paths de tsconfig.json para esbuild
 */
const aliasPlugin = {
    name: 'alias-path',
    setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => {
            const relativePath = args.path.replace(/^@\//, 'src/');
            const basePath = path.resolve(__dirname, relativePath);

            const candidates = [
                `${basePath}.ts`,
                path.join(basePath, 'index.ts'),
            ];

            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                    return { path: candidate };
                }
            }
            return { path: basePath };
        });
    }
};

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
    entryPoints: ['./src/cli/index.ts'],
    bundle: true,
    outfile: 'dist/cli/index.js',
    format: 'cjs',
    platform: 'node',
    minify: isMinify,
    sourcemap: !isMinify,
    plugins: [aliasPlugin],
};

const builds = [extensionOptions, cliOptions];

if (isWatch) {
    const contexts = await Promise.all(builds.map(options => esbuild.context(options)));
    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('[esbuild] watching...');
} else {
    await Promise.all(builds.map(options => esbuild.build(options)));
}
