import type { LeagueDoc } from '#lib/types/league.ts';
import { writable } from 'svelte/store';

/**
 * Cache of `leagueId → LeagueDoc` for leagues the caller is *not* a
 * member of (battle opponents) — the "everyone else" half to
 * `myLeaguesStore`. Mirrors [`profilesStore`](./profiles.store.ts) for
 * principals: populated incrementally by `loadLeaguesByIds`, and
 * intentionally survives auth transitions since leagues are public.
 */
export const leagueDirectoryStore = writable<Map<string, LeagueDoc>>(new Map());
