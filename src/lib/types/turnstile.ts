/**
 * The part of Cloudflare's Turnstile browser API (`window.turnstile`) the app
 * uses. Cloudflare ships no types; option names are theirs, kebab-case
 * included.
 */
export interface TurnstileRenderOptions {
	sitekey: string;
	action: string;
	/** `interaction-only`: invisible unless Cloudflare needs the visitor to act. */
	appearance: 'always' | 'execute' | 'interaction-only';
	theme: 'auto' | 'light' | 'dark';
	retry: 'auto' | 'never';
	'refresh-expired': 'auto' | 'manual' | 'never';
	callback: (token: string) => void;
	/** Returning true tells Turnstile the error is handled, so it does not throw. */
	'error-callback': (code: string) => boolean;
	'expired-callback': () => void;
	'timeout-callback': () => void;
}

export interface TurnstileApi {
	render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
	remove: (widgetId: string) => void;
}
