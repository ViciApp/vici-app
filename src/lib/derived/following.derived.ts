import { cachedListOrEmpty } from '#lib/derived/cached.derived.ts';
import { followingStore } from '#lib/stores/following.store.ts';
import type { PrincipalText } from '@junobuild/schema';
import type { Readable } from 'svelte/store';

export const following: Readable<PrincipalText[]> = cachedListOrEmpty(followingStore);
