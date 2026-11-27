<script lang="ts">
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { FollowedLeanSignal } from '#lib/types/market-signals.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		yesPct: number;
		followedLean?: FollowedLeanSignal;
	}

	const { yesPct, followedLean }: Props = $props();
</script>

<!-- "Who's calling what" split. Row 1 = all callers (the live price),
     row 2 = predictors you follow (dot grid), shown only when that signal
     exists. A top-accuracy row returns once a real reputation aggregate
     exists; until then it would only restate the price with an invented
     offset. -->
<section class="flow-back-block flow-split">
	<p class="eyebrow flow-back-label">
		{t({ locale: $localeStore, key: 'card.back.who_calling' })}
	</p>

	<div class="flow-split-row">
		<div class="flow-split-meta">
			<span class="flow-split-label">
				{t({ locale: $localeStore, key: 'card.back.all_callers' })}
			</span>
			<span class="flow-split-pct num">{yesPct}%</span>
		</div>
		<div class="flow-split-bar" role="presentation">
			<i style:width="{100 - yesPct}%" class="flow-split-fill-no"></i>
			<i style:width="{yesPct}%" class="flow-split-fill-yes"></i>
		</div>
	</div>

	{#if followedLean}
		<div class="flow-split-row">
			<div class="flow-split-meta">
				<span class="flow-split-label">
					{t({ locale: $localeStore, key: 'card.back.predictors_you_follow' })}
				</span>
				<span class="flow-split-pct num">
					{t({
						locale: $localeStore,
						key: 'card.back.followed_count',
						params: { count: followedLean.yes, total: followedLean.total }
					})}
				</span>
			</div>
			<div
				class="flow-followed-dots"
				aria-label={t({
					locale: $localeStore,
					key: 'card.back.followed_count',
					params: { count: followedLean.yes, total: followedLean.total }
				})}
				role="img"
			>
				{#each Array.from({ length: followedLean.total }, (_, i) => i) as i (i)}
					<span class="flow-followed-dot" class:is-yes={i < followedLean.yes}></span>
				{/each}
			</div>
		</div>
	{/if}
</section>

<style lang="postcss">
	/* Shared block wrapper + section surface: duplicated here so the
	   extracted section keeps its spacing + surface under Svelte's
	   per-component style scoping. */
	.flow-back-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.flow-split {
		padding: 0.75rem 0.85rem;
		border-radius: var(--r-12);
		border: 1px solid var(--border-base);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		box-shadow: var(--inset-hi);
	}

	.flow-back-label {
		margin: 0;
		color: var(--text-muted);
	}

	.flow-split-row {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.35rem 0;
	}
	.flow-split-row + .flow-split-row {
		border-top: 1px solid var(--border-base);
	}
	.flow-split-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px;
		font-size: var(--t-12);
		color: var(--text-muted);
	}
	.flow-split-label {
		flex: 1 1 auto;
		color: var(--text-base);
		font-weight: 500;
	}
	.flow-split-pct {
		font-weight: 700;
		color: var(--text-base);
	}
	.flow-split-bar {
		display: flex;
		height: 6px;
		border-radius: var(--r-pill);
		overflow: hidden;
		background: var(--border-base);
	}
	.flow-split-fill-no {
		display: block;
		height: 100%;
		background: var(--no);
		opacity: 0.78;
		transition: width 480ms var(--ease-vici);
	}
	.flow-split-fill-yes {
		display: block;
		height: 100%;
		background: var(--yes);
		opacity: 0.95;
		transition: width 480ms var(--ease-vici);
	}

	.flow-followed-dots {
		display: flex;
		gap: 6px;
	}
	.flow-followed-dot {
		width: 10px;
		height: 10px;
		border-radius: var(--r-pill);
		background: var(--no);
		opacity: 0.78;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
	}
	.flow-followed-dot.is-yes {
		background: var(--yes);
		opacity: 1;
	}
</style>
