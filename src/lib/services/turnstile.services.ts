import {
	TURNSTILE_ONLOAD_CALLBACK,
	TURNSTILE_SCRIPT_URL,
	TURNSTILE_TOKEN_TIMEOUT_MS
} from '#lib/constants/turnstile.constants.ts';
import { turnstileSiteKey } from '#lib/env/app.env.ts';
import type { TurnstileApi } from '#lib/types/turnstile.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Cloudflare Turnstile tokens for the anonymous endpoints that sit behind a
 * bot check. The loader is fetched on the first request only, so a page that
 * never asks for a token never contacts Cloudflare. Each token is single-use:
 * a caller spends it on one exchange with the API.
 */

type TurnstileWindow = Window & {
	turnstile?: TurnstileApi;
	[TURNSTILE_ONLOAD_CALLBACK]?: () => void;
};

let loading: Promise<TurnstileApi> | undefined;

const loadTurnstile = (): Promise<TurnstileApi> => {
	const host = window as TurnstileWindow;

	if (nonNullish(host.turnstile)) {
		return Promise.resolve(host.turnstile);
	}

	loading ??= new Promise<TurnstileApi>((resolve, reject) => {
		host[TURNSTILE_ONLOAD_CALLBACK] = () => {
			if (nonNullish(host.turnstile)) {
				resolve(host.turnstile);
			} else {
				reject(new Error('Turnstile loaded without its API'));
			}
		};

		const script = document.createElement('script');

		script.src = `${TURNSTILE_SCRIPT_URL}?render=explicit&onload=${TURNSTILE_ONLOAD_CALLBACK}`;
		script.async = true;
		script.defer = true;

		script.onerror = () => {
			script.remove();

			reject(new Error('Turnstile failed to load'));
		};

		document.head.append(script);
	}).catch((err: unknown) => {
		// A blocked or offline load must not poison every later attempt.
		loading = undefined;

		throw err;
	});

	return loading;
};

// Above the app's own layers, so a challenge Cloudflare decides to show is
// never hidden behind a sheet or a modal.
const FLOATING_HOST_Z_INDEX = '2147483000';

/** A host for the widget when the caller gives none: empty while the check is
 * invisible, docked at the bottom of the viewport when Cloudflare shows a
 * challenge. Only the slot takes pointer events, so the empty strip never
 * swallows a tap. */
const mountFloatingHost = (): { host: HTMLElement; slot: HTMLElement } => {
	const host = document.createElement('div');
	const slot = document.createElement('div');

	host.style.position = 'fixed';
	host.style.insetInline = '0';
	host.style.bottom = 'max(16px, env(safe-area-inset-bottom))';
	host.style.display = 'flex';
	host.style.justifyContent = 'center';
	host.style.zIndex = FLOATING_HOST_Z_INDEX;
	host.style.pointerEvents = 'none';
	slot.style.pointerEvents = 'auto';

	host.append(slot);
	document.body.append(host);

	return { host, slot };
};

/**
 * One fresh Turnstile token for `action`, solved invisibly unless Cloudflare
 * asks the visitor to interact. Pass `container` to place that challenge in
 * the page; without one it docks at the bottom of the viewport.
 *
 * A build without `VITE_TURNSTILE_SITE_KEY` resolves the empty token: the API
 * skips the check outside production and refuses it in production, so the
 * missing key fails closed where it matters. Rejects when the loader is
 * blocked, the challenge fails or the visitor does not answer in
 * {@link TURNSTILE_TOKEN_TIMEOUT_MS}.
 */
export const acquireTurnstileToken = async ({
	action,
	container
}: {
	action: string;
	container?: HTMLElement;
}): Promise<string> => {
	const sitekey = turnstileSiteKey();

	if (isNullish(sitekey)) {
		return '';
	}

	const api = await loadTurnstile();
	const floating = isNullish(container) ? mountFloatingHost() : undefined;
	const slot = container ?? floating?.slot;

	let widgetId: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	try {
		return await new Promise<string>((resolve, reject) => {
			if (isNullish(slot)) {
				reject(new Error('No host for the Turnstile widget'));

				return;
			}

			timer = setTimeout(
				() => reject(new Error('Turnstile timed out')),
				TURNSTILE_TOKEN_TIMEOUT_MS
			);

			widgetId = api.render(slot, {
				sitekey,
				action,
				appearance: 'interaction-only',
				theme: 'auto',
				retry: 'never',
				'refresh-expired': 'never',
				callback: resolve,
				'error-callback': (code) => {
					reject(new Error(`Turnstile error ${code}`));

					return true;
				},
				'expired-callback': () => reject(new Error('Turnstile token expired')),
				'timeout-callback': () => reject(new Error('Turnstile challenge timed out'))
			});
		});
	} finally {
		clearTimeout(timer);

		if (nonNullish(widgetId)) {
			api.remove(widgetId);
		}

		floating?.host.remove();
	}
};
