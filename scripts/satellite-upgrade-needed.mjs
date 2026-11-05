#!/usr/bin/env node
/**
 * Decide whether a release must run `juno functions upgrade`.
 *
 * The upgrade STOPS the satellite while the wasm is swapped — and the same
 * canister serves the frontend, so users staring at the app during that
 * window get the HTTP gateway's "canister is stopped" page. A release that
 * doesn't change the satellite wasm can skip the upgrade entirely and ship
 * through the zero-downtime `hosting deploy` alone.
 *
 * A static folder filter (`src/satellite/**`) is NOT enough to detect wasm
 * changes: the satellite imports shared code from `#lib/**` (schemas, types,
 * constants, utils) and `#declarations`. So instead of a hand-maintained
 * path list, this script walks the REAL import graph from
 * `src/satellite/index.ts` — resolving the aliases declared in
 * `src/satellite/tsconfig.json` — and intersects that closure with the files
 * changed since the previous release tag.
 *
 * Usage: node scripts/satellite-upgrade-needed.mjs --base <git-ref>
 *
 * Prints `true` or `false` (and nothing else) on stdout; reasoning goes to
 * stderr. Everything fails safe: an unresolved import, a missing file or any
 * internal error yields `true` (or a non-zero exit, which the caller must
 * also treat as "upgrade").
 *
 * See `docs/ai/pr-and-ci.md` (deploy workflow) for how CI consumes this.
 */
import { isNullish, nonNullish } from '@dfinity/utils';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ENTRY = 'src/satellite/index.ts';
const SATELLITE_TSCONFIG = 'src/satellite/tsconfig.json';

/**
 * Paths whose change always forces an upgrade, no matter what the import
 * graph says. They feed the wasm build without being imported by it:
 * `src/satellite/**` covers generated `.did` files and the tsconfig;
 * `package(-lock).json` pins `@junobuild/functions` and every other bundled
 * npm dependency; `juno.config.ts` carries the collection rules; and the
 * workflow + this script define the decision itself.
 */
const ALWAYS_UPGRADE_PREFIXES = ['src/satellite/'];
const ALWAYS_UPGRADE_FILES = [
	'package.json',
	'package-lock.json',
	'juno.config.ts',
	'.github/workflows/deploy.yml',
	'scripts/satellite-upgrade-needed.mjs'
];

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
	encoding: 'utf8'
}).trim();

/** @param {string} absolute */
const toRepoRelative = (absolute) => path.relative(repoRoot, absolute).split(path.sep).join('/');

/**
 * Alias map from the satellite tsconfig `paths` (e.g. `#lib/*` →
 * `src/lib/*`), with targets resolved against the tsconfig directory.
 *
 * @returns {{exact: Map<string, string>, wildcard: Map<string, string>}}
 */
const readAliases = () => {
	const tsconfigPath = path.join(repoRoot, SATELLITE_TSCONFIG);
	const { config, error } = ts.readConfigFile(tsconfigPath, (p) => fs.readFileSync(p, 'utf8'));

	if (nonNullish(error)) {
		throw new Error(
			`Cannot parse ${SATELLITE_TSCONFIG}: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`
		);
	}

	const paths = config?.compilerOptions?.paths ?? {};
	const baseDir = path.dirname(tsconfigPath);

	const exact = new Map();
	const wildcard = new Map();

	for (const [pattern, targets] of Object.entries(paths)) {
		const target = path.resolve(baseDir, targets[0]);

		if (pattern.endsWith('/*')) {
			wildcard.set(pattern.slice(0, -1), `${target.replace(/\*$/, '')}`);
		} else {
			exact.set(pattern, target);
		}
	}

	return { exact, wildcard };
};

/**
 * Resolve an import specifier to an absolute path candidate (without
 * extension probing), or `null` for bare npm packages — those are covered
 * by the `package-lock.json` always-upgrade trigger instead.
 *
 * @param {{specifier: string, importerDir: string, aliases: {exact: Map<string, string>, wildcard: Map<string, string>}}} params
 * @returns {string | null}
 */
const resolveSpecifier = ({ specifier, importerDir, aliases }) => {
	if (specifier.startsWith('.')) {
		return path.resolve(importerDir, specifier);
	}

	const exact = aliases.exact.get(specifier);

	if (nonNullish(exact)) {
		return exact;
	}

	for (const [prefix, target] of aliases.wildcard) {
		if (specifier.startsWith(prefix)) {
			return path.join(target, specifier.slice(prefix.length));
		}
	}

	// Bare package specifier (`@junobuild/functions`, `zod`, …).
	return null;
};

/**
 * Probe a resolved candidate the way a bundler would (`moduleResolution:
 * "bundler"` in the satellite tsconfig) and return EVERY existing artifact,
 * not just the first hit: an extensionless specifier can resolve to a
 * declaration/runtime pair (e.g. `clearing.idl` → `clearing.idl.d.ts` for
 * types AND `clearing.idl.js` for the emitted code that actually lands in
 * the wasm). Over-collecting only errs toward upgrading.
 *
 * @param {string} candidate
 * @returns {string[]}
 */
const probeFiles = (candidate) => {
	const probes = [
		candidate,
		`${candidate}.ts`,
		`${candidate}.d.ts`,
		`${candidate}.js`,
		`${candidate}.json`,
		candidate.replace(/\.js$/, '.ts'),
		path.join(candidate, 'index.ts'),
		path.join(candidate, 'index.js')
	];

	return [...new Set(probes)].filter(
		(probe) => fs.existsSync(probe) && fs.statSync(probe).isFile()
	);
};

/**
 * Import specifiers of a TS source, EXCLUDING type-only edges
 * (`import type … from`, `export type … from`, and named imports where
 * every specifier is `type`-qualified). Type-only imports are erased at
 * compile time, so they cannot change the emitted satellite bundle —
 * following them would e.g. drag the i18n catalogs into the closure via
 * `import type { MessageKey }` and force a canister stop on every
 * copy-only release. Schema/codegen side effects of type changes are
 * still covered: the regenerated outputs land in `src/satellite/**`
 * (an always-upgrade trigger, enforced committed by CI's
 * `satellite-schema` job).
 *
 * @param {{fileName: string, source: string}} params
 * @returns {string[]}
 */
const valueImports = ({ fileName, source }) => {
	const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false);
	const specifiers = [];

	/** @param {import('typescript').Node} node */
	const visit = (node) => {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			const clause = node.importClause;
			const namedBindings = clause?.namedBindings;
			const allNamedAreTypes =
				nonNullish(namedBindings) &&
				ts.isNamedImports(namedBindings) &&
				namedBindings.elements.length > 0 &&
				namedBindings.elements.every((element) => element.isTypeOnly) &&
				isNullish(clause.name);

			if (clause?.isTypeOnly !== true && !allNamedAreTypes) {
				specifiers.push(node.moduleSpecifier.text);
			}

			return;
		}

		if (
			ts.isExportDeclaration(node) &&
			nonNullish(node.moduleSpecifier) &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			if (!node.isTypeOnly) {
				specifiers.push(node.moduleSpecifier.text);
			}

			return;
		}

		// Dynamic `import('…')`.
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length > 0 &&
			ts.isStringLiteral(node.arguments[0])
		) {
			specifiers.push(node.arguments[0].text);
		}

		ts.forEachChild(node, visit);
	};

	visit(sourceFile);

	return specifiers;
};

/**
 * Breadth-first walk of the import graph from {@link ENTRY}.
 *
 * @returns {{closure: Set<string>, unresolved: string[]}}
 */
const collectClosure = () => {
	const aliases = readAliases();
	const entry = path.join(repoRoot, ENTRY);

	if (!fs.existsSync(entry)) {
		throw new Error(`Satellite entry not found: ${ENTRY}`);
	}

	const closure = new Set();
	const unresolved = [];
	const queue = [entry];

	while (queue.length > 0) {
		const file = queue.pop();
		const relative = toRepoRelative(file);

		// `.json` / `.d.ts` are leaves; TS sources and emitted JS (e.g. the
		// generated `#declarations/**/*.idl.js` factories) declare imports.
		const scannable =
			(file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.mjs')) &&
			!file.endsWith('.d.ts');

		if (!closure.has(relative) && scannable) {
			const source = fs.readFileSync(file, 'utf8');

			for (const specifier of valueImports({ fileName: file, source })) {
				const candidate = resolveSpecifier({
					specifier,
					importerDir: path.dirname(file),
					aliases
				});

				if (nonNullish(candidate)) {
					const resolved = probeFiles(candidate);

					if (resolved.length === 0) {
						unresolved.push(`${specifier} (from ${relative})`);
					} else {
						queue.push(...resolved);
					}
				}
			}
		}

		closure.add(relative);
	}

	return { closure, unresolved };
};

/**
 * @param {string} base
 * @returns {string[]}
 */
const changedFilesSince = (base) =>
	execFileSync('git', ['diff', '--name-only', base, 'HEAD'], {
		cwd: repoRoot,
		encoding: 'utf8'
	})
		.split('\n')
		.filter((line) => line.length > 0);

const main = () => {
	const baseIndex = process.argv.indexOf('--base');
	const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined;

	if (isNullish(base) || base.length === 0) {
		throw new Error('Missing --base <git-ref>');
	}

	const changed = changedFilesSince(base);
	const { closure, unresolved } = collectClosure();

	console.error(`Diff ${base}..HEAD: ${changed.length} file(s); closure: ${closure.size} file(s).`);

	if (unresolved.length > 0) {
		// An import this script cannot follow means the closure is incomplete —
		// fail safe to upgrading and surface the gap in the CI log.
		console.error(`Unresolved import(s), forcing upgrade:\n  ${unresolved.join('\n  ')}`);
		console.log('true');

		return;
	}

	const triggers = changed.filter(
		(file) =>
			closure.has(file) ||
			ALWAYS_UPGRADE_FILES.includes(file) ||
			ALWAYS_UPGRADE_PREFIXES.some((prefix) => file.startsWith(prefix))
	);

	if (triggers.length > 0) {
		console.error(`Satellite-relevant change(s):\n  ${triggers.join('\n  ')}`);
		console.log('true');

		return;
	}

	console.error('No satellite-relevant changes — the functions upgrade can be skipped.');
	console.log('false');
};

main();
