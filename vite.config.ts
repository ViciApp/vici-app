import juno from '@junobuild/vite-plugin';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Read package.json version + best-effort short commit SHA so the Settings
// page's About line can surface `VICI · v{version} · Build {sha}`. The SHA
// is the short HEAD hash at build time — falls back to `dev` when git is
// unavailable (CI without history, fresh clone, etc.).
const pkg = JSON.parse(readFileSync(resolve('./package.json'), 'utf-8')) as {
	version?: string;
};

const buildSha = (() => {
	try {
		return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return 'dev';
	}
})();

const appVersion = pkg.version ?? '0.0.0';

// The worker build runs its own SvelteKit plugin instance, so it needs the
// same options as the app build.
const sveltekitOptions: Parameters<typeof sveltekit>[0] = {
	preprocess: vitePreprocess(),
	adapter: adapter({
		fallback: 'index.html',
		precompress: false
	}),
	version: {
		name: appVersion
	}
};

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(appVersion),
		__BUILD_SHA__: JSON.stringify(buildSha)
	},
	plugins: [sveltekit(sveltekitOptions), juno(), tailwindcss()],
	// `@lucide/svelte` ships raw `.svelte` icon sources behind a barrel that
	// re-exports ~1,600 modules (`@lucide/svelte/icons` aliases the same
	// barrel). Svelte component libraries are excluded from esbuild's
	// dependency pre-bundling by default, so in dev every route that renders
	// any icon (e.g. `BaseButton` → `LoaderCircle`, used app-wide) pulls the
	// whole barrel and the browser fetches + compiles all ~1,600 icon modules
	// on demand — making first navigation to each surface crawl. The
	// deprecated `lucide-svelte` shipped compiled `.js` and was pre-bundled
	// automatically; forcing the successor into the optimizer (compiled via
	// the svelte esbuild plugin, since `prebundleSvelteLibraries` defaults on
	// in dev) restores the single-chunk fast path.
	optimizeDeps: {
		include: ['@lucide/svelte', '@lucide/svelte/icons']
	},
	server: {
		fs: {
			allow: ['.']
		},
		proxy: {
			'/api': {
				target: 'http://localhost:5987',
				changeOrigin: true
			}
		}
	},
	worker: {
		plugins: () => [sveltekit(sveltekitOptions)],
		format: 'es'
	}
});
