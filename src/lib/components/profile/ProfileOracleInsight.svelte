<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import OracleChar from '#lib/components/characters/OracleChar.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface OracleRecord {
		/** `true` when the latest settled call won. */
		win: boolean;
		/** The market question (trailing "?" already stripped). */
		question: string;
	}

	interface Props {
		/** Fallback insight string: shown when no settled call is available
		 *  to surface as a record line. */
		oracleInsight: string;
		/** The latest settled call, rendered as a record headline + sub. When
		 *  present it wins over `oracleInsight`. */
		record?: OracleRecord;
	}

	let { oracleInsight, record }: Props = $props();
</script>

<section class="profile-oracle">
	<div class="profile-oracle-icon" aria-hidden="true">
		<OracleChar size={32} />
	</div>
	<div class="profile-oracle-body">
		<p class="profile-oracle-eyebrow">
			{t({ locale: $localeStore, key: 'profile.dashboard.oracle_label' })}
			<span>{t({ locale: $localeStore, key: 'profile.dashboard.oracle_weekly' })}</span>
		</p>
		{#if nonNullish(record)}
			<!-- Record line — a win reads "You called it — '{q}?'", a loss reads
			     "The market went the other way — '{q}?'". The question carries the
			     accent so the call stays the focal point. -->
			<p class="profile-oracle-text serif-italic">
				{t({
					locale: $localeStore,
					key: record.win
						? 'profile.dashboard.oracle.record_win'
						: 'profile.dashboard.oracle.record_loss'
				})}
				<span class="profile-oracle-q">“{record.question}?”</span>
			</p>
			<p class="profile-oracle-sub">
				{t({
					locale: $localeStore,
					key: record.win
						? 'profile.dashboard.oracle.record_win_sub'
						: 'profile.dashboard.oracle.record_loss_sub'
				})}
			</p>
		{:else}
			<p class="profile-oracle-text serif-italic">{oracleInsight}</p>
		{/if}
	</div>
</section>

<style lang="postcss">
	/* Accent "signal" treatment: the insight is a gold/laurel signal
	   card, not a character card: accent glow, accent border, accent
	   eyebrow, mirroring the earned-achievement emblem and the other
	   accent surfaces. Tri-theme via `--color-primary` / `--accent-glow`
	   (with a `color-mix` fallback). */
	.profile-oracle {
		display: flex;
		align-items: flex-start;
		gap: 0.85rem;
		padding: 0.9rem 1rem;
		border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--border-base));
		border-radius: var(--r-12);
		background: var(--accent-glow, color-mix(in srgb, var(--color-primary) 6%, var(--bg-popover)));
	}

	.profile-oracle-icon {
		display: flex;
		width: 2.25rem;
		height: 2.25rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--color-primary) 16%, transparent);
	}

	.profile-oracle-body {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.25rem;
	}

	.profile-oracle-eyebrow {
		margin: 0;
		color: var(--color-primary);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	.profile-oracle-text {
		margin: 0;
		color: var(--text-base);
		font-size: var(--t-14);
		line-height: var(--leading-snug);
	}

	/* The market question: accent so the call is the focal point. */
	.profile-oracle-q {
		color: var(--color-primary);
	}

	.profile-oracle-sub {
		margin: 0.375rem 0 0;
		color: var(--text-muted);
		font-size: var(--t-12);
		line-height: var(--leading-snug);
	}
</style>
