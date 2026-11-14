<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { Copy, Image as ImageIcon } from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import IconFacebook from '#lib/components/icons/IconFacebook.svelte';
	import IconInstagram from '#lib/components/icons/IconInstagram.svelte';
	import IconSnapchat from '#lib/components/icons/IconSnapchat.svelte';
	import IconTelegram from '#lib/components/icons/IconTelegram.svelte';
	import IconTikTok from '#lib/components/icons/IconTikTok.svelte';
	import IconWhatsApp from '#lib/components/icons/IconWhatsApp.svelte';
	import IconX from '#lib/components/icons/IconX.svelte';
	import { referrerRewardVxp } from '#lib/constants/referral.constants.ts';
	import { getMyReferralCode, listMyReferrals } from '#lib/services/referral.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import { writeToClipboard } from '#lib/utils/clipboard.utils.ts';
	import { type FlowArtCategory, resolveFlowArtCategory } from '#lib/utils/flow-art.utils.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { marketShareParam } from '#lib/utils/market-slug.utils.ts';
	import { renderPredictionCard, type ShareCardResult } from '#lib/utils/share-card.utils.ts';
	import { browser } from '$app/env';

	/**
	 * SharePopover: the prediction-share menu anchored above the card.
	 *
	 * The headline is a slim card-image preview of the actual prediction,
	 * rendered client-side to a 1080×1920 story PNG (`renderPredictionCard`)
	 * and offered as the primary CTA. Two labelled rows of circular channel
	 * tiles follow: POST TO STORY (image-only surfaces: Instagram, TikTok,
	 * Snapchat, Facebook) routes through the OS share sheet
	 * (`navigator.share({ files })`); OR SEND A LINK (WhatsApp, Telegram, X,
	 * Copy) shares the referral URL. Desktop / no-file-share falls back to
	 * saving the PNG and opening the target app. A referral hook sits at
	 * the foot: its headline VXP figure reflects the sharer's *next*
	 * referrer-reward tier on the diminishing curve, derived client-side
	 * from their own redemption rows.
	 */
	interface PriorCallLite {
		side: 'YES' | 'NO';
	}

	interface Props {
		market: Market;
		category?: FlowArtCategory;
		priorCall?: PriorCallLite | null;
		onClose?: () => void;
		onCopied?: (message?: string) => void;
		/**
		 * Translated market title for the active locale; defaults to the
		 * on-chain original. Used in the share copy and the rendered card so a
		 * reader shares the question in the language they're reading it.
		 */
		displayTitle?: string;
	}

	const { market, category, priorCall = null, onClose, onCopied, displayTitle }: Props = $props();

	const shareTitle = $derived(displayTitle ?? market.title);

	// Crowd YES percentage, or `undefined` when the probability is unknown
	// (book unread / no liquidity). The share text and card must not claim a
	// fabricated 50%: when unknown we drop the stat from the copy entirely and
	// suppress the percentage-bearing card image rather than minting a number.
	const yesPct = $derived<number | undefined>(
		isNullish(market.yesProbability) ? undefined : Math.round(market.yesProbability * 100)
	);

	// The shareable card image renders the YES percentage prominently, so it's
	// only offered once the probability is known. Until then the image surfaces
	// (preview, "Share card" CTA, story tiles) are disabled: link sharing,
	// which carries no percentage, stays available.
	const cardAvailable = $derived(nonNullish(yesPct));

	// Category for the card artwork accent + tag. Falls back to a
	// deterministic per-market resolution when the host didn't supply one.
	const cardCategory = $derived<FlowArtCategory>(
		category ?? resolveFlowArtCategory({ tags: [], seed: market.id })
	);

	const handle = $derived(
		($userStore.profile?.nickname ?? '').replace(/[^a-z0-9]/gi, '') || 'predictor'
	);
	const accuracy = $derived($userStore.profile?.accuracy);

	// Referral code resolved from the satellite; the share URL carries it
	// so a friend's signup is attributed to the sharer. Falls back to the
	// handle until the code loads (or if it's unavailable), so the link is
	// always shareable.
	let referralCode = $state<string | undefined>(undefined);

	// The sharer's lifetime count of *paid* referrals (rows still within the
	// hard cap). The referrer reward diminishes with each one, so the footer
	// headline shows the reward for the *next* friend, not a flat figure.
	// Authoritative payout stays server-side; this is cosmetic and starts at
	// the top tier until the list resolves.
	let priorPaidCount = $state(0);
	const nextRewardVxp = $derived(referrerRewardVxp(priorPaidCount));

	const refToken = $derived(referralCode ?? handle);
	const origin = $derived(browser ? window.location.origin : 'https://vici.market');
	// Slugged from the on-chain (EN) title, never `displayTitle`: the SEO
	// generator derives the same param from the registry title, and the two
	// must agree for a shared link to land on its prerendered crawler page.
	const url = $derived(
		`${origin}/m/${marketShareParam({ title: market.title, seriesId: market.id })}?ref=${refToken}`
	);

	const text = $derived.by(() => {
		if (nonNullish(priorCall)) {
			return t({ locale: $localeStore, key: 'flow.share.text_post' });
		}

		// No probability yet → percent-free copy (the `text_pre` template
		// embeds `{yes}%`, which would read as a fabricated 50% here).
		if (isNullish(yesPct)) {
			return t({
				locale: $localeStore,
				key: 'flow.share.text_pre_no_pct',
				params: { title: shareTitle }
			});
		}

		return t({
			locale: $localeStore,
			key: 'flow.share.text_pre',
			params: { title: shareTitle, yes: yesPct }
		});
	});

	// Native share sheet: Safari (iOS) and Chrome (Android) expose
	// `navigator.share`. File-share is a narrower capability (story apps
	// need it); desktop typically has neither.
	const hasNativeShare = $derived(
		browser && typeof navigator !== 'undefined' && typeof navigator.share === 'function'
	);

	const canShareFiles = $derived.by(() => {
		if (!browser || typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') {
			return false;
		}

		try {
			return navigator.canShare({
				files: [new File([new Blob()], 'card.png', { type: 'image/png' })]
			});
		} catch {
			return false;
		}
	});

	let preview = $state<string | undefined>(undefined);
	let busy = $state(false);

	// Render the preview once per market; the card is deterministic given
	// the market + prior call, so a single render covers the popover's life.
	onMount(() => {
		let alive = true;

		void (async () => {
			// The share card draws the YES percentage prominently; without a
			// known probability we skip the preview entirely rather than render
			// a fabricated 50%. Link-sharing stays available below.
			if (isNullish(yesPct)) {
				return;
			}

			try {
				const result = await renderPredictionCard({
					market: {
						id: market.id,
						question: shareTitle,
						yesPercent: yesPct,
						category: cardCategory
					},
					priorCall,
					identity: { handle, accuracy: nonNullish(accuracy) ? accuracy / 100 : undefined }
				});

				if (alive && nonNullish(result)) {
					preview = result.dataUrl;
				}
			} catch {
				// Preview is decorative: leave the placeholder on failure.
			}
		})();

		void (async () => {
			try {
				const code = await getMyReferralCode();

				if (alive) {
					referralCode = code;
				}
			} catch {
				referralCode = undefined;
			}
		})();

		void (async () => {
			try {
				const items = await listMyReferrals();

				if (alive) {
					// Mirror the satellite's authoritative credited-referrals tally (the
					// count that feeds the tier curve): rows whose `referrerPayout.status`
					// has left `none` (owed / processing / paid). Anything still `none`,
					// including over-cap monitoring rows, does not count.
					priorPaidCount = items.filter(
						({ referrerPayout }) => referrerPayout.status !== 'none'
					).length;
				}
			} catch {
				// Keep the optimistic top-tier figure on failure; the footer is a
				// soft nudge, and the satellite is authoritative on the real payout.
			}
		})();

		return () => {
			alive = false;
		};
	});

	interface StoryApp {
		key: string;
		labelKey:
			'flow.share.instagram' | 'flow.share.tiktok' | 'flow.share.snapchat' | 'flow.share.facebook';
		tint: string;
		bg?: string;
		web?: string;
	}

	const storyApps: StoryApp[] = [
		{
			key: 'instagram',
			labelKey: 'flow.share.instagram',
			tint: '#E1306C',
			web: 'https://instagram.com'
		},
		{
			key: 'tiktok',
			labelKey: 'flow.share.tiktok',
			tint: 'var(--text-base)',
			web: 'https://tiktok.com'
		},
		{
			key: 'snapchat',
			labelKey: 'flow.share.snapchat',
			tint: '#000',
			bg: '#FFFC00',
			web: 'https://snapchat.com'
		},
		{
			key: 'facebook',
			labelKey: 'flow.share.facebook',
			tint: '#1877F2',
			web: 'https://facebook.com'
		}
	];

	const enc = encodeURIComponent;

	interface LinkApp {
		key: string;
		labelKey:
			'flow.share.whatsapp' | 'flow.share.telegram' | 'flow.share.twitter' | 'flow.share.copy';
		tint: string;
		href?: string;
	}

	const linkApps = $derived<LinkApp[]>([
		{
			key: 'whatsapp',
			labelKey: 'flow.share.whatsapp',
			tint: '#25D366',
			href: `https://wa.me/?text=${enc(`${text} ${url}`)}`
		},
		{
			key: 'telegram',
			labelKey: 'flow.share.telegram',
			tint: '#229ED9',
			href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`
		},
		{
			key: 'twitter',
			labelKey: 'flow.share.twitter',
			tint: 'var(--text-base)',
			href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`
		},
		{ key: 'copy', labelKey: 'flow.share.copy', tint: 'var(--accent)' }
	]);

	// Primary CTA label: depends on whether the OS can ingest the file
	// (true "share") or we must save it locally first ("save").
	const cardCtaKey = $derived<
		'flow.share.preparing' | 'flow.share.share_card' | 'flow.share.save_card'
	>(
		busy ? 'flow.share.preparing' : canShareFiles ? 'flow.share.share_card' : 'flow.share.save_card'
	);

	// Image share: routes to the OS share sheet (IG / TikTok / Snapchat /
	// Facebook stories all live there). Desktop with no file-share support
	// saves the PNG and opens the target app's web home.
	const shareImage = async (app?: StoryApp) => {
		if (!browser || busy) {
			return;
		}

		// Without a known probability the card image is unavailable (it would
		// claim a fabricated 50%); degrade to a plain link share instead.
		if (isNullish(yesPct)) {
			await fallbackShareLink();

			return;
		}

		haptic('light-tap');
		busy = true;

		try {
			const result: ShareCardResult | null = await renderPredictionCard({
				market: {
					id: market.id,
					question: shareTitle,
					yesPercent: yesPct,
					category: cardCategory
				},
				priorCall,
				identity: { handle, accuracy: nonNullish(accuracy) ? accuracy / 100 : undefined }
			});

			if (isNullish(result)) {
				// No canvas: degrade to a plain link share / copy.
				await fallbackShareLink();

				return;
			}

			const file = new File([result.blob], `vici-${market.id}.png`, { type: 'image/png' });

			if (canShareFiles && typeof navigator.share === 'function') {
				await navigator.share({ files: [file], text, url, title: 'VICI' });
				onClose?.();
			} else {
				const href = URL.createObjectURL(result.blob);
				const anchor = document.createElement('a');
				anchor.href = href;
				anchor.download = file.name;
				anchor.click();
				setTimeout(() => URL.revokeObjectURL(href), 3000);
				onCopied?.(t({ locale: $localeStore, key: 'flow.share.card_saved' }));

				if (nonNullish(app?.web)) {
					window.open(app.web, '_blank', 'noopener');
				}
			}
		} catch (e: unknown) {
			// User-cancelled share sheets reject with AbortError: silent.
			if (e instanceof DOMException && e.name === 'AbortError') {
				busy = false;

				return;
			}
		}

		busy = false;
	};

	// Link-only fallback when no canvas / file share is available.
	const fallbackShareLink = async () => {
		if (hasNativeShare && typeof navigator.share === 'function') {
			try {
				await navigator.share({ title: 'VICI', text, url });
				onClose?.();

				return;
			} catch (e: unknown) {
				if (e instanceof DOMException && e.name === 'AbortError') {
					return;
				}
			}
		}

		await copyLink();
	};

	const copyLink = async () => {
		if (!browser) {
			onClose?.();

			return;
		}

		haptic('light-tap');
		const copied = await writeToClipboard(url);

		if (copied) {
			onCopied?.();
			onClose?.();
		}
	};

	const stop = (event: Event) => {
		event.stopPropagation();
	};
</script>

<!-- eslint-disable-next-line svelte/valid-compile -- the click is intentional;
     bubble-stop keeps an outer dismiss-on-click handler from firing. -->
<div class="share-pop" onclick={stop} onkeydown={stop} role="dialog" tabindex="-1">
	<span class="share-pop-eyebrow">
		{t({ locale: $localeStore, key: 'flow.share.eyebrow' })}
	</span>

	<!-- Header: small card preview + slim primary action -->
	<div class="share-card-head">
		<div class="share-card-thumb">
			{#if nonNullish(preview)}
				<img alt={t({ locale: $localeStore, key: 'flow.share.preview_alt' })} src={preview} />
			{:else}
				<span class="share-card-thumb-placeholder" aria-hidden="true">…</span>
			{/if}
		</div>
		<div class="share-card-cta-col">
			<span class="share-card-pitch">
				{t({ locale: $localeStore, key: 'flow.share.card_pitch' })}
			</span>
			<button
				class="share-card-cta"
				disabled={busy || !cardAvailable}
				onclick={() => shareImage()}
				type="button"
			>
				<ImageIcon aria-hidden="true" size={15} strokeWidth={2} />
				{t({ locale: $localeStore, key: cardCtaKey })}
			</button>
		</div>
	</div>

	<!-- Post to story: image-only surfaces via the OS share sheet -->
	<span class="share-row-label">
		{t({ locale: $localeStore, key: 'flow.share.post_to_story' })}
	</span>
	<div class="share-tile-row share-tile-row-story">
		{#each storyApps as app (app.key)}
			<button
				class="share-tile"
				aria-label={t({ locale: $localeStore, key: app.labelKey })}
				disabled={busy || !cardAvailable}
				onclick={() => shareImage(app)}
				type="button"
			>
				<span
					style:color={app.tint}
					style:background={app.bg ?? 'var(--bg-popover)'}
					class="share-tile-icon"
					class:branded={nonNullish(app.bg)}
				>
					{#if app.key === 'instagram'}
						<IconInstagram />
					{:else if app.key === 'tiktok'}
						<IconTikTok />
					{:else if app.key === 'snapchat'}
						<IconSnapchat />
					{:else if app.key === 'facebook'}
						<IconFacebook />
					{/if}
				</span>
				<span class="share-tile-label">{t({ locale: $localeStore, key: app.labelKey })}</span>
			</button>
		{/each}
	</div>

	<!-- Or send a link -->
	<span class="share-row-label">
		{t({ locale: $localeStore, key: 'flow.share.send_a_link' })}
	</span>
	<div class="share-tile-row">
		{#each linkApps as app (app.key)}
			{#if nonNullish(app.href)}
				<a
					class="share-tile"
					href={app.href}
					onclick={() => onClose?.()}
					rel="noopener noreferrer"
					target="_blank"
				>
					<span style:color={app.tint} class="share-tile-icon">
						{#if app.key === 'whatsapp'}
							<IconWhatsApp />
						{:else if app.key === 'telegram'}
							<IconTelegram />
						{:else if app.key === 'twitter'}
							<IconX />
						{/if}
					</span>
					<span class="share-tile-label">{t({ locale: $localeStore, key: app.labelKey })}</span>
				</a>
			{:else}
				<button
					class="share-tile"
					aria-label={t({ locale: $localeStore, key: app.labelKey })}
					onclick={copyLink}
					type="button"
				>
					<span style:color={app.tint} class="share-tile-icon">
						<Copy aria-hidden="true" size={16} strokeWidth={2} />
					</span>
					<span class="share-tile-label">{t({ locale: $localeStore, key: app.labelKey })}</span>
				</button>
			{/if}
		{/each}
	</div>

	<!-- Referral incentive: quiet growth hook. The headline VXP reflects the
	     sharer's next referrer-reward tier; past the cap it falls back to the
	     friend's guaranteed bonus so the promise stays honest. -->
	<div class="share-pop-referral">
		<span class="share-referral-icon" aria-hidden="true">✦</span>
		{#if nextRewardVxp > 0}
			<span>
				<b>
					{t({
						locale: $localeStore,
						key: 'flow.share.referral_amount',
						params: { amount: nextRewardVxp }
					})}
				</b>
				{t({ locale: $localeStore, key: 'flow.share.referral_tail' })}
			</span>
		{:else}
			<span>
				<b>{t({ locale: $localeStore, key: 'flow.share.referral_capped_amount' })}</b>
				{t({ locale: $localeStore, key: 'flow.share.referral_capped_tail' })}
			</span>
		{/if}
	</div>
</div>

<style lang="postcss">
	.share-pop {
		position: absolute;
		top: 50px;
		right: 14px;
		z-index: 30;
		display: flex;
		width: 304px;
		max-width: calc(100vw - 40px);
		flex-direction: column;
		gap: 12px;
		padding: 14px;
		border: 1px solid var(--border-strong);
		border-radius: 14px;
		background: var(--bg-popover);
		box-shadow: 0 18px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.share-pop-eyebrow {
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	/* Header: card-image preview + primary CTA */
	.share-card-head {
		display: flex;
		gap: 14px;
		align-items: center;
		/* The 2px top nudge stays; the 12px flex gap on .share-pop already
		   supplies the spacing below this header; no extra margin-bottom. */
		margin: 2px 0;
	}

	.share-card-thumb {
		flex: 0 0 auto;
		overflow: hidden;
		width: 78px;
		height: 139px;
		border: 1px solid var(--border-base);
		border-radius: 11px;
		background: var(--bg-popover);
		box-shadow: 0 8px 20px -10px rgba(0, 0, 0, 0.6);
	}
	.share-card-thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.share-card-thumb-placeholder {
		display: flex;
		width: 100%;
		height: 100%;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--fg-faint);
	}

	.share-card-cta-col {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 8px;
	}
	.share-card-pitch {
		font-size: var(--t-13);
		line-height: 1.4;
		color: var(--fg-dim);
	}
	.share-card-cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		padding: 10px 14px;
		border: 0;
		border-radius: 10px;
		background: var(--accent);
		color: var(--ink);
		font-family: var(--font-display);
		font-size: var(--t-13);
		font-weight: 600;
		cursor: pointer;
		transition: transform 80ms var(--ease-vici);
	}
	.share-card-cta:active {
		transform: scale(0.98);
	}
	.share-card-cta:disabled {
		opacity: 0.6;
		cursor: default;
	}

	/* Row label above each tile group. The 12px flex gap on .share-pop is
	   wider than the intended 8px label→tiles rhythm, so pull the tiles up
	   by 4px (12 − 4 = 8px effective). */
	.share-row-label {
		display: block;
		margin-bottom: -4px;
		font-family: var(--font-mono);
		font-size: var(--t-10);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--fg-faint);
	}

	/* Circular channel tiles in a four-up row */
	.share-tile-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
	}
	/* Breathing room below the story row before the next group: the 12px
	   flex gap on .share-pop already supplies it, so no extra margin. */
	.share-tile-row-story {
		margin-bottom: 0;
	}
	.share-tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
		border: 0;
		background: transparent;
		text-decoration: none;
		cursor: pointer;
		font-family: inherit;
	}
	.share-tile:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.share-tile-icon {
		display: flex;
		width: 40px;
		height: 40px;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-base);
		border-radius: 50%;
		background: var(--bg-popover);
		transition:
			border-color var(--d-hover) var(--ease-vici),
			background var(--d-hover) var(--ease-vici);
	}
	.share-tile-icon.branded {
		border-color: transparent;
	}
	.share-tile:hover .share-tile-icon:not(.branded) {
		border-color: var(--border-strong);
	}
	.share-tile-label {
		font-family: var(--font-mono);
		font-size: 9.5px;
		letter-spacing: 0.02em;
		color: var(--text-muted);
	}

	/* Referral incentive footer */
	.share-pop-referral {
		display: flex;
		align-items: center;
		gap: 8px;
		/* Intended 14px above the footer; the 12px flex gap on .share-pop
		   already contributes, so add 2px (12 + 2 = 14px effective). */
		margin-top: 2px;
		padding: 9px 11px;
		border: 1px solid rgba(79, 211, 161, 0.3);
		border-radius: 10px;
		background: linear-gradient(90deg, rgba(79, 211, 161, 0.1), rgba(79, 211, 161, 0.04));
		font-size: var(--t-12);
		line-height: 1.4;
		color: var(--fg-dim);
	}
	.share-pop-referral b {
		color: var(--yes);
		font-weight: 700;
	}
	.share-referral-icon {
		flex-shrink: 0;
		color: var(--yes);
		font-size: var(--t-14);
		line-height: 1;
	}
</style>
