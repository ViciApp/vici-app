#!/usr/bin/env tsx
/**
 * Web2 head step: points the built shell's head at vici.app and at the
 * landing page's link preview.
 *
 * `src/app.html` carries the head of the on-chain deployment (vici.market),
 * and `generate-seo-assets.ts` rewrites that same head per market at its
 * deploy, so the source stays as it is. The web2 image serves one shell for
 * every address, and what a crawler or a chat app's link preview reads there
 * is the landing page: this step rewrites `build/index.html` in place, after
 * `npm run build`, in `Dockerfile.web`.
 *
 * It fails the image build when a tag it rewrites is missing from the shell.
 */

import {
	LANDING_SHARE_IMAGE_HEIGHT,
	LANDING_SHARE_IMAGE_PATH,
	LANDING_SHARE_IMAGE_TYPE,
	LANDING_SHARE_IMAGE_WIDTH,
	LANDING_SHARE_TITLE
} from '#lib/constants/landing-page.constants.ts';
import { enMessages } from '#lib/constants/messages/en.ts';
import { rewriteShellHead } from '#lib/utils/shell-head.utils.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = join(SCRIPT_DIR, '..', '..', 'build');
const SHELL_PATH = join(BUILD_DIR, 'index.html');

/** The origin `src/app.html` is written for, and the one the web2 image is served at. */
const SOURCE_ORIGIN = 'https://vici.market';
const WEB2_ORIGIN = 'https://vici.app';

const main = (): void => {
	if (!existsSync(join(BUILD_DIR, LANDING_SHARE_IMAGE_PATH))) {
		throw new Error(
			`[web2-head] link-preview image missing from build: ${LANDING_SHARE_IMAGE_PATH}`
		);
	}

	const shell = readFileSync(SHELL_PATH, 'utf8');

	writeFileSync(
		SHELL_PATH,
		rewriteShellHead({
			shell,
			sourceOrigin: SOURCE_ORIGIN,
			head: {
				origin: WEB2_ORIGIN,
				title: enMessages['seo.landing.title'],
				description: enMessages['seo.landing.description'],
				shareTitle: LANDING_SHARE_TITLE,
				shareImage: {
					path: LANDING_SHARE_IMAGE_PATH,
					width: LANDING_SHARE_IMAGE_WIDTH,
					height: LANDING_SHARE_IMAGE_HEIGHT,
					type: LANDING_SHARE_IMAGE_TYPE
				}
			}
		})
	);

	console.log(`[web2-head] shell head points at ${WEB2_ORIGIN}`);
};

main();
