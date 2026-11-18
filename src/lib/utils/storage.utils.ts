import { browser } from '$app/env';
import { nonNullish } from '@dfinity/utils';

/**
 * Best-effort JSON localStorage helpers. Failures are non-fatal because storage
 * only holds UI/operational preferences, never authoritative state.
 */

export const set = <T>({ key, value }: { key: string; value: T }) => {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch (err: unknown) {
		console.error(err);
	}
};

export const del = ({ key }: { key: string }) => {
	try {
		localStorage.removeItem(key);
	} catch (err: unknown) {
		console.error(err);
	}
};

export const get = <T>({ key }: { key: string }): T | undefined => {
	try {
		const value = browser ? localStorage.getItem(key) : null;

		return nonNullish(value) ? JSON.parse(value) : undefined;
	} catch (err: unknown) {
		console.error(err);
	}
};

/**
 * Presence check that never parses the value and stays silent on failure:
 * cheaper than `get` and, in a "storage blocked" scenario, doesn't add to the
 * `console.error` noise. Use it when you only need to know whether a key was
 * ever written, not its value (e.g. first-visit vs. returning-visit signals).
 */
export const has = ({ key }: { key: string }): boolean => {
	try {
		return browser && nonNullish(localStorage.getItem(key));
	} catch (_err: unknown) {
		return false;
	}
};
