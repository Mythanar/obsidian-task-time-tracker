import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'esbuild.test.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'tests/dist',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Las pruebas corren en Node (node --test), nunca dentro de
		// Obsidian ni en movil: las reglas de la plataforma no aplican, y
		// describe()/it() del runner nativo devuelven promesas que el
		// propio runner gestiona.
		files: ['tests/**/*.ts'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'@typescript-eslint/no-floating-promises': 'off',
		},
	},
);
