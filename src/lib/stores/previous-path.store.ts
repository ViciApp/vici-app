import { writable } from 'svelte/store';

/**
 * Most recently visited in-app URL (pathname + search).
 *
 * Updated by `afterNavigate` in the root layout. `null` until the
 * first in-app navigation completes: used by `goBack` to decide
 * between `history.back()` and a fallback `goto(...)`.
 */
export const previousPathStore = writable<string | null>(null);
