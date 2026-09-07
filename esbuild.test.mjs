// Compiles the tests to JS before handing them to Node's native runner
// (`node --test`). Done with the esbuild the project already uses for the
// bundle, so no new devDependency is needed and it works the same on the
// three Node versions the CI runs (20, 22 and 24), where native
// TypeScript support cannot be taken for granted.
import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import { readdirSync } from 'node:fs';

// readdirSync instead of fs.globSync: globSync is Node 22+ and the CI
// also runs on Node 20.
const entryPoints = readdirSync('tests')
	.filter((name) => name.endsWith('.test.ts'))
	.map((name) => `tests/${name}`);
if (entryPoints.length === 0) {
	console.error('No tests found in tests/*.test.ts');
	process.exit(1);
}

await esbuild.build({
	entryPoints,
	bundle: true,
	external: ['obsidian', ...builtinModules],
	format: 'esm',
	platform: 'node',
	target: 'node20',
	outdir: 'tests/dist',
	outExtension: { '.js': '.mjs' },
	sourcemap: 'inline',
	logLevel: 'warning',
});
