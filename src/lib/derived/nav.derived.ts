import { page } from '$app/state';
import { toStore, type Readable } from 'svelte/store';

export const routeMarketId: Readable<string | undefined> = toStore(() => page.params.id);

export const routeSide: Readable<string | undefined> = toStore(
	() => page.url.searchParams.get('side') ?? undefined
);
