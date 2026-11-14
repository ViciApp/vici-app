<script lang="ts">
	import OracleChar from '#lib/components/characters/OracleChar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { writeToClipboard } from '#lib/utils/clipboard.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface Props {
		// The daily hard cap reached (15): surfaced in the body copy.
		hardCap: number;
		// "Back to dashboard →" CTA.
		onClose: () => void;
	}

	const { hardCap, onClose }: Props = $props();

	const reduce = $derived(prefersReducedMotion());

	const SHARE_URL = 'https://vici.market';

	const inviteFriend = async () => {
		const text = t({ locale: $localeStore, key: 'flow.invite.share_text' });

		if (navigator.share) {
			try {
				await navigator.share({ title: 'VICI', text, url: SHARE_URL });

				return;
			} catch (e: unknown) {
				if (e instanceof Error && e.name === 'AbortError') {
					return;
				}
			}
		}

		await writeToClipboard(`${text} ${SHARE_URL}`);
	};
</script>

<!-- Daily hard-cap gate: all of today's calls are in. Opening Flow shows
     this "come back tomorrow" takeover instead of a fresh deck, so the
     15/day model holds across sessions. -->
<div class="flow-cap" class:is-static={reduce}>
	<div class="flow-cap-char">
		<OracleChar animate={!reduce} size={92} />
	</div>
	<p class="eyebrow flow-cap-eyebrow">{t({ locale: $localeStore, key: 'flow.cap.eyebrow' })}</p>
	<h2 class="flow-cap-title serif-italic" aria-live="polite" role="status">
		{t({ locale: $localeStore, key: 'flow.cap.title' })}
	</h2>
	<p class="flow-cap-body">
		{t({ locale: $localeStore, key: 'flow.cap.body', params: { count: hardCap } })}
	</p>
	<div class="flow-cap-actions">
		<Button onclick={onClose} size="lg"
			>{t({ locale: $localeStore, key: 'flow.end.back_to_dashboard' })}</Button
		>
	</div>
	<div class="flow-cap-links">
		<button class="flow-cap-link" onclick={inviteFriend} type="button"
			>{t({ locale: $localeStore, key: 'flow.cap.invite' })}</button
		>
	</div>
</div>

<style lang="postcss">
	.flow-cap {
		position: absolute;
		inset: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 2.5rem 1.625rem;
		background: radial-gradient(
			circle at 50% 30%,
			color-mix(in srgb, var(--laurel) 9%, var(--bg-base)),
			var(--bg-base)
		);
	}
	.flow-cap-char {
		animation: fe-pop 600ms cubic-bezier(0.3, 1.5, 0.5, 1) both;
	}
	.flow-cap-eyebrow {
		margin: 0.625rem 0 0;
		color: var(--laurel);
		letter-spacing: 0.24em;
	}
	.flow-cap-title {
		margin: 0.375rem 0 0;
		font-size: 2rem;
		line-height: 1.05;
		color: var(--text-base);
	}
	.flow-cap-body {
		margin: 0.75rem 0 0;
		max-width: 32ch;
		font-size: var(--t-14);
		line-height: 1.5;
		color: var(--text-muted);
	}
	.flow-cap-actions {
		width: min(18.75rem, 86%);
		margin-top: 1.375rem;
	}
	.flow-cap-links {
		margin-top: 1rem;
	}
	.flow-cap-link {
		background: none;
		border: 0;
		padding: 4px 2px;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		letter-spacing: 0.04em;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	@media (prefers-reduced-motion: reduce) {
		.flow-cap-char {
			animation: none;
		}
	}
</style>
