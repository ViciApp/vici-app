import { default as svelteConfig } from '@dfinity/eslint-config-oisy-wallet/svelte';
import { default as vitestConfig } from '@dfinity/eslint-config-oisy-wallet/vitest';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	...vitestConfig,
	...svelteConfig,

	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'dist/',
			'static/',
			'src/declarations/',
			// Vendored copies of the generated candid bindings (see
			// backend/src/declarations/index.ts): generated code, not linted.
			'backend/src/declarations/',
			'.claude/worktrees/'
		]
	},

	{
		// Build-time globals injected by vite's `define` (see `vite.config.ts`).
		languageOptions: {
			globals: {
				__APP_VERSION__: 'readonly',
				__BUILD_SHA__: 'readonly'
			}
		}
	},

	{
		rules: {
			'svelte/no-navigation-without-resolve': 'off'
		}
	},

	{
		files: ['src/**/*'],
		rules: {
			'local-rules/no-relative-imports': 'error'
		}
	},

	{
		rules: {
			// `#lib`, `#declarations`, `#satellite` and `#root` are package.json subpath
			// imports. The resolver maps them to a parent directory, but they are
			// the project aliases, not `../` paths.
			'import/no-relative-parent-imports': [
				'error',
				{ ignore: ['^#(lib|declarations|satellite|root)(/|$)'] }
			]
		}
	},

	{
		// The Bun backend is its own TypeScript project; typed linting must
		// resolve its files through backend/tsconfig.json, not the frontend's
		// tsconfig.eslint.json.
		files: ['backend/**/*.ts'],
		languageOptions: {
			parserOptions: {
				project: ['./backend/tsconfig.json']
			}
		},
		rules: {
			// A server logs to stdout/stderr by design (Fly captures the stream);
			// the browser-console concern behind this rule does not apply.
			'no-console': 'off',
			// Positional params are the backend idiom for db helpers like
			// query(text, params); the object-params convention is a frontend rule.
			'local-rules/prefer-object-params': 'off'
		}
	},

	{
		// Frontend unit specs run on Node's built-in runner (`npm test`) until
		// Vitest is adopted; see docs/ai/frontend/testing.md.
		files: ['src/tests/**/*.spec.ts'],
		rules: {
			'vitest/no-import-node-test': 'off'
		}
	},

	{
		// The service worker legitimately uses the ServiceWorkerGlobalScope
		// surface (`self`, `caches`, `fetch`, `clients`, event listeners).
		files: ['src/service-worker/**/*.ts'],
		languageOptions: {
			globals: globals.serviceworker
		}
	},

	{
		files: ['src/**/*.svelte'],
		rules: {
			// Self-filters to .svelte files that already import #lib/utils/i18n.utils.ts.
			// See local-rules/no-bare-svelte-text.cjs and docs/ai/frontend/i18n.md.
			// Severity is 'warn' during the i18n coverage paydown — promote to
			// 'error' once docs/ai/frontend/i18n-coverage.md is empty.
			'local-rules/no-bare-svelte-text': 'warn'
		}
	},

	{
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector: "Literal[raw='0n']",
					message: 'Use the shared constant `ZERO` instead of `0n`.'
				},
				{
					selector: "ReturnStatement[argument.type='Identifier'][argument.name='undefined']",
					message:
						'Do not `return undefined;`. Use a bare `return;` for early exits, or in `catch` blocks let the function fall through with a comment explaining why the error is swallowed.'
				},
				{
					selector:
						"BinaryExpression[operator=/^===?$/]:matches([left.type='Identifier'][left.name='undefined'], [left.type='Literal'][left.raw='null'], [right.type='Identifier'][right.name='undefined'], [right.type='Literal'][right.raw='null'])",
					message:
						'Use `isNullish()` from `@dfinity/utils` instead of comparing against `null`/`undefined`.'
				},
				{
					selector:
						"BinaryExpression[operator=/^!==?$/]:matches([left.type='Identifier'][left.name='undefined'], [left.type='Literal'][left.raw='null'], [right.type='Identifier'][right.name='undefined'], [right.type='Literal'][right.raw='null'])",
					message:
						'Use `nonNullish()` from `@dfinity/utils` instead of comparing against `null`/`undefined`.'
				}
			]
		}
	},

	{
		// Size and shape limits. Code that broke them when they landed is counted, per
		// file and rule, in eslint-suppressions.json (generated, never hand-edited):
		// a file may not exceed its count, and a fixed one drops its entry with
		// `npx eslint . --prune-suppressions`. See docs/ai/pr-and-ci.md.
		rules: {
			complexity: ['error', 15],
			'max-depth': ['error', 4],
			'max-params': ['error', 4],
			'max-nested-callbacks': ['error', 4],
			'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }]
		}
	},

	{
		// Locale catalogs grow with every user-visible string; their size is data,
		// not a design smell.
		files: ['src/lib/constants/messages/**'],
		rules: {
			'max-lines': 'off'
		}
	},

	{
		rules: {
			'padding-line-between-statements': [
				'error',
				{ blankLine: 'always', prev: '*', next: 'try' },
				{ blankLine: 'always', prev: 'block-like', next: '*' },
				{ blankLine: 'always', prev: '*', next: 'block-like' },
				{ blankLine: 'always', prev: '*', next: 'return' }
			]
		}
	}
);
