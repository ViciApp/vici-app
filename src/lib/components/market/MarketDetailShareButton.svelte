<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { Share2 } from '@lucide/svelte/icons';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
	import { getMyReferralCode } from '#lib/services/referral.services.ts';
	import { notifyShareFailed } from '#lib/services/share.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { writeToClipboard } from '#lib/utils/clipboard.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { marketShareUrl } from '#lib/utils/market-slug.utils.ts';
	import { appOrigin } from '#lib/utils/nav.utils.ts';
	import { browser } from '$app/env';

	interface Props {
		/** The question as the reader reads it (translated when available), for the share sheet. */
		title: string;
		/** The original (registry) title the link's slug is built from, so it is the same for everyone. */
		originalTitle: string;
		seriesId: string;
	}

	const { title, originalTitle, seriesId }: Props = $props();

	// The sharer's referral code, so a friend who comes through the link is
	// credited to them. Read ahead of the press: an await between the tap and
	// `navigator.share` can spend the tap's user activation, which Safari
	// requires. Signed-out visitors have none; until it loads, or when the
	// read fails, the link goes out without `?ref=` rather than not at all.
	let referralCode = $state<string | undefined>();

	$effect(() => {
		if (!$userSignedIn) {
			referralCode = undefined;

			return;
		}

		let alive = true;

		getMyReferralCode()
			.then((code) => {
				if (alive) {
					referralCode = code;
				}
			})
			.catch((_err: unknown) => {
				// Expected when the read fails: the link goes out without `?ref=`.
			});

		return () => {
			alive = false;
		};
	});

	const share = async () => {
		if (!browser) {
			return;
		}

		const url = marketShareUrl({
			origin: appOrigin(),
			title: originalTitle,
			seriesId,
			ref: referralCode
		});

		try {
			if (typeof navigator.share === 'function') {
				await navigator.share({ title, url });

				return;
			}

			if (nonNullish(navigator.clipboard)) {
				const ok = await writeToClipboard(url);

				if (!ok) {
					notifyShareFailed();

					return;
				}

				notificationsStore.add({
					title: t({ locale: $localeStore, key: 'market.detail.share.copied_title' }),
					message: t({ locale: $localeStore, key: 'market.detail.share.copied' }),
					type: 'success'
				});
			}
		} catch (err) {
			// User-cancelled native share sheets reject: treat as silent no-op.
			if (err instanceof DOMException && err.name === 'AbortError') {
				return;
			}

			notifyShareFailed();
		}
	};
</script>

<!-- Share button on the Market detail appbar: shares the market's one
     share link (`/m/{slug~id8}?ref=…`), never the page's own address.
     Prefers the native Web Share sheet (mobile), falls back to clipboard
     copy on desktop with a toast acknowledgement. Wears the faint ghost icon-button look so
     it reads as one set with the back chevron and the save control. -->
<button
	class="market-detail-share"
	aria-label={t({ locale: $localeStore, key: 'market.detail.share.label' })}
	onclick={share}
	type="button"
>
	<Share2 aria-hidden="true" size={18} strokeWidth={1.8} />
</button>

<style lang="postcss">
	.market-detail-share {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px 10px;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		/* Faint foreground wash so the fill tracks every theme (dark /
		   light / peach) instead of a hardcoded dark-only rgba. */
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		color: var(--text-base);
		cursor: pointer;
		transition:
			background-color var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici);
	}

	.market-detail-share:hover {
		border-color: var(--border-strong);
		background: color-mix(in srgb, var(--text-base) 11%, transparent);
	}
</style>
