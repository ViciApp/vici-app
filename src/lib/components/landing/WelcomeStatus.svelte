<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	/**
	 * Accuracy-as-status section: an anchored headline beside a board
	 * that cycles three labelled tabs — Friends / Universities /
	 * Workplace. A gentle ~5s auto-advance pauses on hover/focus, stops
	 * for good once the visitor explicitly picks a tab, and is disabled
	 * under reduced-motion. Same footprint as a single board.
	 */
	import { onDestroy } from 'svelte';
	import {
		LANDING_STATUS_FRIENDS,
		landingStatusUniversities,
		type LandingStatusRow,
		type LandingStatusTabId
	} from '#lib/constants/landing-data.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { splitHeadline } from '#lib/utils/landing-headline.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface StatusTab {
		readonly id: LandingStatusTabId;
		readonly label: MessageKey;
		readonly caption: MessageKey;
		readonly rows: readonly LandingStatusRow[];
	}

	const tt = (key: MessageKey) => t({ locale: $localeStore, key });

	// Locale-matched universities; the leader is the highlighted "you" row with
	// the climb badge (illustrative — the board is a demo fixture, not live data).
	const uniRows = $derived<readonly LandingStatusRow[]>(
		landingStatusUniversities($localeStore).map((name, i) => ({
			rank: i + 1,
			name,
			acc: `${(71.8 - i * 1.4).toFixed(1)}%`,
			team: true,
			you: i === 0,
			delta: i === 0 ? '▲ 1' : undefined
		}))
	);

	const tabs = $derived<readonly StatusTab[]>([
		{
			id: 'friends',
			label: 'welcome.status.tab_friends',
			caption: 'welcome.status.cap_friends',
			rows: LANDING_STATUS_FRIENDS
		},
		{
			id: 'uni',
			label: 'welcome.status.tab_uni',
			caption: 'welcome.status.cap_uni',
			rows: uniRows
		},
		{
			id: 'work',
			label: 'welcome.status.tab_work',
			caption: 'welcome.status.cap_work',
			rows: [
				{
					rank: 1,
					name: tt('welcome.status.team_design'),
					acc: '76.0%',
					team: true,
					you: true,
					delta: '▲ 2'
				},
				{ rank: 2, name: tt('welcome.status.team_product'), acc: '74.6%', team: true },
				{ rank: 3, name: tt('welcome.status.team_sales'), acc: '72.2%', team: true },
				{ rank: 4, name: tt('welcome.status.team_eng'), acc: '70.9%', team: true }
			]
		}
	]);

	let active = $state(0);

	// Auto-rotation pauses while the pointer is over the slider OR keyboard
	// focus is anywhere inside it; it only resumes once BOTH are false, so
	// tabbing through a control with the pointer away never resumes mid-focus.
	let hovering = $state(false);
	let focusWithin = $state(false);
	// An explicit tab pick stops the rotation for good: once the visitor has
	// chosen a tab the board never auto-advances again this session, so it
	// can't flip away from what they're reading. This is sticky — unlike the
	// hover/focus pause above, it is never cleared.
	let userPicked = $state(false);
	const paused = $derived(hovering || focusWithin || userPicked);

	const pickTab = (i: number): void => {
		active = i;
		userPicked = true;
	};

	// `focusout`/`pointerleave` confirm focus has actually left the container
	// (relatedTarget can be null on click-away) before clearing focus-within.
	const focusStillInside = ({
		el,
		next
	}: {
		el: HTMLElement;
		next: EventTarget | null;
	}): boolean => {
		if (next instanceof Node && el.contains(next)) {
			return true;
		}

		return el.contains(document.activeElement);
	};

	const tab = $derived(tabs[active]);
	const headline = $derived(splitHeadline(tt('welcome.status.headline')));

	let timer: ReturnType<typeof setInterval> | null = null;

	const clear = (): void => {
		if (nonNullish(timer)) {
			clearInterval(timer);
			timer = null;
		}
	};

	$effect(() => {
		clear();

		if (prefersReducedMotion() || paused) {
			return;
		}

		timer = setInterval(() => {
			active = (active + 1) % tabs.length;
		}, 5000);

		return clear;
	});

	onDestroy(clear);
</script>

<section id="status" class="lpc-section lpc-status">
	<div class="lpc-wrap">
		<div class="lpc-status-grid">
			<div class="lpc-status-copy">
				<span class="lpc-kicker">{tt('welcome.status.kicker')}</span>
				<h2 class="lpc-h2">
					{headline.before}{#if headline.accent}<span class="acc">{headline.accent}</span
						>{/if}{headline.after}
				</h2>
				<p class="lpc-lede">{tt('welcome.status.body')}</p>
			</div>

			<div
				class="lpc-status-slider"
				aria-label={tt('welcome.status.kicker')}
				onfocusin={() => (focusWithin = true)}
				onfocusout={(e) =>
					(focusWithin = focusStillInside({ el: e.currentTarget, next: e.relatedTarget }))}
				onpointerenter={() => (hovering = true)}
				onpointerleave={() => (hovering = false)}
				role="group"
			>
				<div class="lpc-status-tabs" aria-label={tt('welcome.status.kicker')} role="tablist">
					{#each tabs as tb, i (tb.id)}
						<button
							class="lpc-status-tab"
							class:on={i === active}
							aria-selected={i === active}
							onclick={() => pickTab(i)}
							role="tab"
							type="button"
						>
							{tt(tb.label)}
						</button>
					{/each}
				</div>

				{#key tab.id}
					<div class="lpc-board" role="tabpanel">
						{#each tab.rows as r (r.rank)}
							<div class="lpc-board-row" class:you={r.you}>
								<span class="lpc-board-rank">{r.rank}</span>
								<span class="lpc-board-name">
									{r.team || r.you ? r.name : `@${r.name}`}
									{#if r.you && r.delta}
										<span class="lpc-board-badge">{r.delta}</span>
									{/if}
								</span>
								<span class="lpc-board-acc">{r.acc}</span>
							</div>
						{/each}
					</div>
				{/key}

				<div class="lpc-board-climb">{tt(tab.caption)}</div>
			</div>
		</div>
	</div>
</section>
