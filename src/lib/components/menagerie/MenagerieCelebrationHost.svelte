<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import MenagerieReveal from '$lib/components/menagerie/MenagerieReveal.svelte';
	import MenagerieSprite from '$lib/components/menagerie/MenagerieSprite.svelte';
	import { myMenagerieStats } from '$lib/derived/menagerie.derived';
	import { loadMyMenagerieSignals } from '$lib/services/menagerie.services';
	import { persistEarnedMenagerie } from '$lib/services/profile.services';
	import { flowBeatActiveStore } from '$lib/stores/flow-beat.store';
	import {
		advanceMenagerieCelebration,
		enqueueMenagerieCelebrations,
		menagerieCelebrationStore,
		resetMenagerieCelebrations
	} from '$lib/stores/menagerie-celebration.store';
	import {
		myMenagerieSignalsGeneration,
		myMenagerieSignalsOwner
	} from '$lib/stores/menagerie.store';
	import { userStore } from '$lib/stores/user.store';
	import { detectNewMenagerieTiers } from '$lib/utils/menagerie.utils';

	// App-shell celebration pipeline for the Menagerie trophy layer. Mounted once
	// at the (app) shell so a freshly-crossed tier celebrates on any surface.
	//
	// Responsibilities:
	//   1. Mount the glyph sprite once (every badge across the app references it).
	//   2. Watch the owner's stats; on a genuinely new tier crossing, queue a
	//      celebration. FIRST-EVER load (the `earnedMenagerie` field is absent)
	//      seeds the ledger SILENTLY — no celebration storm for a stocked profile
	//      — once the live signals below have settled for that owner.
	//   3. Persist the celebrated-key ledger so a crossing fires exactly once.
	//   4. Render the reveal, HELD while a Flow character beat is on screen so the
	//      two never collide (card → character beat → trophy).
	//
	// Beyond the stats carried on the profile doc, the host reads the SAME shared
	// `menagerie.derived` snapshot the profile rail + album grid render from —
	// referral count + global rank folded in — so Parrot / Goat / Badger
	// celebrate from exactly the tier the user sees, never a divergent one. The
	// host is always mounted at the (app) shell, so it also hydrates those live
	// signals app-wide; any source that's missing just leaves its animal at
	// baseline. It never blocks the host.

	const profile = $derived($userStore.profile);

	// Hydrate the shared live signals once per distinct signed-in owner —
	// keyed on the owner rather than fired once at mount, because the host
	// is always mounted and can race auth: a pre-auth load has no principal
	// for the self-rank query and skips that leg, so re-firing when the
	// owner lands lets Goat's rank self-heal app-wide instead of reading
	// baseline until some other surface happens to reload the signals. The
	// key also carries the signals generation, because an auth transition
	// that keeps the same owner still clears the caches and the first-load
	// seed below waits on them. The initial `undefined` sentinel still fires
	// the signed-out load (global standings need no principal); the
	// service's in-flight dedup keeps concurrent surface mounts single-flight.
	let signalsKey = $state<string | undefined>(undefined);

	$effect(() => {
		const key = `${profile?.owner ?? ''}:${$myMenagerieSignalsGeneration}`;

		if (key === signalsKey) {
			return;
		}

		signalsKey = key;
		void loadMyMenagerieSignals();
	});

	// Guard so the seed / detect pass runs once per distinct earned-set + ledger
	// state, not on every unrelated profile tick.
	let lastSignature = $state<string | null>(null);

	$effect(() => {
		const current = profile;

		if (!current) {
			lastSignature = null;
			resetMenagerieCelebrations();

			return;
		}

		const stats = $myMenagerieStats;
		const diff = detectNewMenagerieTiers({ stats, celebrated: current.earnedMenagerie });

		// Hold the silent seed until this owner's live signals have settled. A
		// seed taken from the profile doc alone leaves out every trophy the
		// signals carry (Goat's rank, Parrot's referrals), so when the rank lands
		// a moment later Goat celebrates as a "new" crossing the owner already
		// had. Returning before `lastSignature` is set lets the signals landing
		// re-run this pass.
		if (diff.firstRun && $myMenagerieSignalsOwner !== current.owner) {
			return;
		}

		// Signature = the earned-set + whether the ledger was seeded. Re-running
		// only when one of these changes avoids reacting to unrelated profile
		// writes (avatar, settings, …); the earned-set already folds in the live
		// signals, so a referral/rank change that crosses a tier re-triggers here.
		const signature = `${isNullish(current.earnedMenagerie) ? 'seed' : 'set'}:${diff.all.join(',')}`;

		if (signature === lastSignature) {
			return;
		}

		lastSignature = signature;

		if (diff.firstRun) {
			// Seed the ledger silently — the owner has "always had" these.
			void persistEarnedMenagerie({ owner: current.owner, keys: diff.all });

			return;
		}

		if (diff.celebrate.length === 0) {
			return;
		}

		// The ledger is append-only ("already celebrated"). Persist the UNION of
		// the existing ledger and the currently-earned set, never `diff.all` alone:
		// a regressed stat (e.g. a dropped streak) shrinks the earned set, and
		// writing it raw would erase past keys → re-celebration, plus could drop
		// keys written by another surface. Then queue the reveals.
		const ledger = Array.from(new Set([...(current.earnedMenagerie ?? []), ...diff.all]));
		void persistEarnedMenagerie({ owner: current.owner, keys: ledger });
		enqueueMenagerieCelebrations(diff.celebrate);
	});

	const reveal = $derived($menagerieCelebrationStore.current);
	const beatActive = $derived($flowBeatActiveStore);
</script>

<MenagerieSprite />

{#if reveal && !beatActive}
	{#key `${reveal.slug}:${reveal.tier}`}
		<MenagerieReveal onDone={advanceMenagerieCelebration} slug={reveal.slug} tier={reveal.tier} />
	{/key}
{/if}
