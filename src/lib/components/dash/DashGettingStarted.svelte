<script lang="ts">
	/**
	 * Getting-started checklist — a compact, dismissible card at the top of the
	 * first-run Dash giving cross-surface direction the starter-call list can't:
	 * make a first call, pick a team, find a league. Non-linear — each row
	 * deep-links to its surface.
	 *
	 * Steps auto-tick from real state: "Make your first call" once any call is
	 * placed, "Pick your team" once a school or country affiliation is set. "Find
	 * your league" never auto-ticks (there's no single completion signal) — it
	 * always points at the Arena hub. The card stays visible until the user
	 * dismisses it; the dismissal persists per device (identity-scoped) via the
	 * onboarding "seen" flags, so it doesn't reappear next session.
	 */
	import { nonNullish } from '@dfinity/utils';
	import { ArrowRight, Check } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { myAffiliationsStore } from '#lib/stores/affiliations.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { CHECKLIST_DASH_SEEN_KEY } from '#lib/utils/onboarding-flags.utils.ts';
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';

	interface Step {
		done: boolean;
		labelKey: MessageKey;
		subKey: MessageKey;
		go: () => void;
	}

	// Default to visible so the server render and first client render
	// agree; the persisted dismissal is read on mount to avoid a
	// hydration mismatch from touching localStorage at init.
	let dismissed = $state(false);

	onMount(() => {
		if (browser) {
			try {
				dismissed = localStorage.getItem(CHECKLIST_DASH_SEEN_KEY) === '1';
			} catch {
				// Storage unavailable — keep the card visible.
			}
		}
	});

	const callDone = $derived(($userStore.profile?.totalTrades ?? 0) >= 1);
	const teamDone = $derived(
		nonNullish($myAffiliationsStore.university) || nonNullish($myAffiliationsStore.country)
	);

	const steps = $derived<Step[]>([
		{
			done: callDone,
			labelKey: 'gst.call.label',
			subKey: 'gst.call.sub',
			go: () => void goto(resolveAppPath(AppPath.Flow))
		},
		{
			done: teamDone,
			labelKey: 'gst.team.label',
			subKey: 'gst.team.sub',
			go: () => void goto(`${resolveAppPath(AppPath.Arena)}/worlds`)
		},
		{
			done: false,
			labelKey: 'gst.league.label',
			subKey: 'gst.league.sub',
			go: () => void goto(resolveAppPath(AppPath.Arena))
		}
	]);

	const doneCount = $derived(steps.filter((step) => step.done).length);

	const dismiss = (): void => {
		dismissed = true;

		if (browser) {
			try {
				localStorage.setItem(CHECKLIST_DASH_SEEN_KEY, '1');
			} catch {
				// Storage unavailable — dismissal won't survive a reload.
			}
		}
	};
</script>

{#if !dismissed}
	<div class="gst-card">
		<div class="gst-head">
			<div class="gst-head-l">
				<span class="gst-title">{t({ locale: $localeStore, key: 'gst.title' })}</span>
				<span class="gst-count num">{doneCount}/{steps.length}</span>
			</div>
			<button class="gst-skip" onclick={dismiss} type="button">
				{t({ locale: $localeStore, key: 'gst.dismiss' })}
			</button>
		</div>
		<div class="gst-steps">
			{#each steps as step (step.labelKey)}
				<button class="gst-step" class:is-done={step.done} onclick={step.go} type="button">
					<span class="gst-check" aria-hidden="true">
						{#if step.done}
							<Check size={13} strokeWidth={3} />
						{/if}
					</span>
					<span class="gst-step-txt">
						<span class="gst-step-label">{t({ locale: $localeStore, key: step.labelKey })}</span>
						<span class="gst-step-sub">{t({ locale: $localeStore, key: step.subKey })}</span>
					</span>
					{#if !step.done}
						<span class="gst-step-arrow" aria-hidden="true">
							<ArrowRight size={14} strokeWidth={2} />
						</span>
					{/if}
				</button>
			{/each}
		</div>
	</div>
{/if}
