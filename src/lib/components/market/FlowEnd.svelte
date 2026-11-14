<script lang="ts">
	import { ChevronRight, Smartphone } from '@lucide/svelte/icons';
	import FlameChar from '#lib/components/characters/FlameChar.svelte';
	import OracleChar from '#lib/components/characters/OracleChar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import CountUp from '#lib/components/ui/CountUp.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { writeToClipboard } from '#lib/utils/clipboard.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface Props {
		// Calls placed this session (now pending resolution).
		pending: number;
		// VXP locked at risk across the session's calls.
		staked: number;
		// Cross-session daily streak (days in a row), already bumped.
		streak: number;
		// True when the session ran to the daily hard cap (15) via Push-to-15.
		overtime: boolean;
		// True when the session resumed after a broken streak (no-shame framing).
		comeback: boolean;
		// Whether the "Push to 15 →" opt-in is still available (regular day,
		// not yet in overtime, and the deck can supply more cards).
		canExtend: boolean;
		// CTA wiring. `onExtend` raises the session target to the hard cap and
		// continues the deck past 10; `onClose` returns to the dashboard.
		onExtend: () => void;
		onClose: () => void;
		// Install nudge: `showInstallNudge` gates the row (the host combines
		// the `a2hs.store` capability gate with the auto-prompt thresholds),
		// `onInstallPrompt` opens the shared install sheet.
		showInstallNudge?: boolean;
		onInstallPrompt?: () => void;
	}

	const {
		pending,
		staked,
		streak,
		overtime,
		comeback,
		canExtend,
		onExtend,
		onClose,
		showInstallNudge = false,
		onInstallPrompt = undefined
	}: Props = $props();

	// Reactive reduced-motion gate: the reward springs are the deliberate
	// brand exception; we keep them but fade their entrance (and drop the
	// confetti entirely) when the user opts out of motion.
	const reduce = $derived(prefersReducedMotion());

	// On fire whenever there's a live streak, a comeback, or an overtime
	// finish: the day's character then rises as Flame; a quiet day shows
	// the Oracle.
	const onFire = $derived(comeback || overtime || streak >= 1);

	// Streak day to show: a comeback re-opens at Day 1.
	const streakDay = $derived(comeback ? 1 : Math.max(1, streak));

	const eyebrowKey = $derived<MessageKey>(
		overtime
			? 'flow.end.eyebrow_overtime'
			: comeback
				? 'flow.end.eyebrow_comeback'
				: 'flow.end.eyebrow_day'
	);

	// Headline pool: one line picked once on mount (frozen for the surface's
	// lifetime). Overtime / comeback get their own framing; an on-fire day
	// reads hotter than a quiet one.
	const HEAD_POOLS = {
		overtime: ['flow.end.head_overtime_1', 'flow.end.head_overtime_2', 'flow.end.head_overtime_3'],
		comeback: ['flow.end.head_comeback_1', 'flow.end.head_comeback_2', 'flow.end.head_comeback_3'],
		fire: ['flow.end.head_fire_1', 'flow.end.head_fire_2', 'flow.end.head_fire_3'],
		day: ['flow.end.head_day_1', 'flow.end.head_day_2', 'flow.end.head_day_3']
	} as const satisfies Record<string, readonly MessageKey[]>;

	const headKey: MessageKey = (() => {
		const pool = overtime
			? HEAD_POOLS.overtime
			: comeback
				? HEAD_POOLS.comeback
				: onFire
					? HEAD_POOLS.fire
					: HEAD_POOLS.day;

		return pool[Math.floor(Math.random() * pool.length)];
	})();

	const bodyKey = $derived<MessageKey>(
		overtime ? 'flow.end.body_overtime' : comeback ? 'flow.end.body_comeback' : 'flow.end.body_day'
	);

	const pendingValue = $derived(
		pending === 1
			? t({ locale: $localeStore, key: 'flow.end.stat_pending_value_one' })
			: t({ locale: $localeStore, key: 'flow.end.stat_pending_value', params: { count: pending } })
	);

	// Confetti: a radial burst gated by reduced motion. `$derived` so the
	// burst drops cleanly if the motion preference flips while the takeover
	// is up (no hidden init-time capture of `reduce`).
	const SPARK_PALETTE = ['#E9C254', '#F08A3C', '#FFF1C2', '#FFD9A0'];
	const sparks = $derived(
		reduce
			? []
			: Array.from({ length: 26 }, (_, i) => {
					const ang = Math.PI * 2 * (i / 26) + (Math.random() * 0.4 - 0.2);
					const r = 120 + Math.random() * 150;

					return {
						dx: Math.cos(ang) * r,
						dy: Math.sin(ang) * r - 30,
						color: SPARK_PALETTE[i % SPARK_PALETTE.length],
						size: 5 + Math.random() * 8,
						rot: Math.random() * 360 - 180,
						round: i % 3 === 0,
						delay_ms: Math.random() * 120
					};
				})
	);

	const SHARE_URL = 'https://vici.market';

	// Share → clipboard → confirmation toast. `navigator.share` is absent in
	// embedded / desktop / non-secure contexts, and a bare clipboard write
	// gives the user no feedback there; the tap feels dead. So when the
	// native sheet is unavailable (or rejects for any reason other than a
	// user-initiated cancel), we copy the link and always surface a toast:
	// success on a clean copy, an error toast if even the clipboard is
	// blocked. `copiedMessageKey` is the per-action confirmation copy.
	const shareOrCopy = async ({
		text,
		copiedMessageKey
	}: {
		text: string;
		copiedMessageKey: MessageKey;
	}) => {
		if (navigator.share) {
			try {
				await navigator.share({ title: 'VICI', text, url: SHARE_URL });

				return;
			} catch (e: unknown) {
				// User dismissed the sheet: leave it silent. The rejection is a
				// DOMException that isn't reliably `instanceof Error`, so read
				// its `name` defensively rather than narrowing by prototype.
				if ((e as { name?: string } | null)?.name === 'AbortError') {
					return;
				}
				// Anything else (unsupported / blocked in an iframe) falls
				// through to the clipboard path below.
			}
		}

		const copied = await writeToClipboard(`${text} ${SHARE_URL}`);

		notificationsStore.add({
			title: t({ locale: $localeStore, key: 'flow.end.copy_toast_title' }),
			message: copied
				? t({ locale: $localeStore, key: copiedMessageKey })
				: t({ locale: $localeStore, key: 'flow.invite.toast_copy_failed' }),
			type: copied ? 'success' : 'error',
			duration: 2000
		});
	};

	// Share the day's calls: native share sheet where available, clipboard +
	// confirmation toast otherwise.
	const shareDay = () =>
		shareOrCopy({
			text: t({
				locale: $localeStore,
				key: pending === 1 ? 'flow.end.share_text_one' : 'flow.end.share_text',
				params: { count: pending }
			}),
			copiedMessageKey: 'flow.end.share_copied'
		});

	const inviteFriend = () =>
		shareOrCopy({
			text: t({ locale: $localeStore, key: 'flow.invite.share_text' }),
			copiedMessageKey: 'flow.end.invite_copied'
		});
</script>

<!-- FlowEnd: the end-of-session celebration peak. A full-stage takeover:
     the day's character rises with a confetti burst, three stats count in,
     and one flex-framed choice follows: push to 15, or done. -->
<div class="flow-end" class:is-static={reduce}>
	<!-- Confetti: decorative, suppressed under reduced motion. -->
	<div class="flow-end-confetti" aria-hidden="true">
		{#each sparks as s, i (i)}
			<i
				style:--fdx="{s.dx}px"
				style:--fdy="{s.dy}px"
				style:--frot="{s.rot}deg"
				style:width="{s.size}px"
				style:height="{s.size}px"
				style:background={s.color}
				style:border-radius={s.round ? '50%' : '2px'}
				style:animation-delay="{s.delay_ms}ms"
			></i>
		{/each}
	</div>

	<div class="flow-end-char">
		{#if onFire}
			<FlameChar animate={!reduce} size={96} stage="inferno" />
		{:else}
			<OracleChar animate={!reduce} size={96} />
		{/if}
	</div>

	<p class="eyebrow flow-end-eyebrow">{t({ locale: $localeStore, key: eyebrowKey })}</p>

	<!-- The summary is announced once it settles: `aria-live` on the head so
	     screen readers get the celebration without the decorative motion. -->
	<h2 class="flow-end-head serif-italic" aria-live="polite" role="status">
		{t({ locale: $localeStore, key: headKey })}
	</h2>

	<!-- Stats: stagger in. -->
	<div class="flow-end-stats">
		<div class="flow-end-stat flow-end-stat-1">
			<span class="eyebrow flow-end-stat-label"
				>{t({ locale: $localeStore, key: 'flow.end.stat_streak' })}</span
			>
			<span class="num flow-end-stat-value flow-end-stat-value-fire">
				{t({ locale: $localeStore, key: 'flow.end.stat_streak_value', params: { n: streakDay } })}
			</span>
		</div>
		<div class="flow-end-stat flow-end-stat-2">
			<span class="eyebrow flow-end-stat-label"
				>{t({ locale: $localeStore, key: 'flow.end.stat_pending' })}</span
			>
			<span class="num flow-end-stat-value">{pendingValue}</span>
		</div>
		<div class="flow-end-stat flow-end-stat-3">
			<span class="eyebrow flow-end-stat-label"
				>{t({ locale: $localeStore, key: 'flow.end.stat_called' })}</span
			>
			<span class="num flow-end-stat-value">
				<CountUp to={staked} /> VXP
			</span>
		</div>
	</div>

	<p class="flow-end-body">{t({ locale: $localeStore, key: bodyKey })}</p>

	<div class="flow-end-actions">
		{#if canExtend}
			<Button onclick={onExtend} size="lg"
				>{t({ locale: $localeStore, key: 'flow.end.push_to_15' })}</Button
			>
			<Button onclick={onClose} variant="ghost"
				>{t({ locale: $localeStore, key: 'flow.end.back_to_dashboard' })}</Button
			>
		{:else}
			<Button onclick={onClose} size="lg"
				>{t({ locale: $localeStore, key: 'flow.end.back_to_dashboard' })}</Button
			>
		{/if}
	</div>

	<!-- Install nudge: a calm, non-interruptive row offering Add-to-Home-Screen,
	     shown only when the app can be installed (mobile, not already a PWA).
	     Sits above the Share · Invite links; opens the shared install sheet. -->
	{#if showInstallNudge && onInstallPrompt}
		<button class="flow-end-install" onclick={onInstallPrompt} type="button">
			<span class="flow-end-install-glyph" aria-hidden="true">
				<Smartphone size={18} strokeWidth={1.7} />
			</span>
			<span class="flow-end-install-label">
				{t({ locale: $localeStore, key: 'a2hs.flow_end.row' })}
			</span>
			<ChevronRight aria-hidden="true" size={16} strokeWidth={1.7} />
		</button>
	{/if}

	<!-- Growth: subtle text links, kept quiet so they never compete with the
	     primary action. -->
	<div class="flow-end-links">
		<button class="flow-end-link" onclick={shareDay} type="button"
			>{t({ locale: $localeStore, key: 'flow.end.share_calls' })}</button
		>
		<span class="flow-end-link-dot" aria-hidden="true">·</span>
		<button class="flow-end-link" onclick={inviteFriend} type="button"
			>{t({ locale: $localeStore, key: 'flow.end.invite_friend' })}</button
		>
	</div>
</div>

<style lang="postcss">
	/* The celebration peak: a full-stage takeover. Theme-adaptive: the
	   radial wash and every surface tint resolve through the laurel / ink /
	   parchment tokens, so dark / light / peach all read correctly. The
	   `fe-pop` / `fe-spark` / `fe-rise` keyframes are shared global
	   celebration primitives (see app.css). */
	.flow-end {
		position: absolute;
		inset: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		text-align: center;
		padding: 2.5rem 1.375rem 1.75rem;
		overflow-y: auto;
		background: radial-gradient(
			circle at 50% 28%,
			color-mix(in srgb, var(--laurel) 9%, var(--bg-base)),
			var(--bg-base)
		);
	}

	.flow-end-confetti {
		position: absolute;
		left: 50%;
		top: 34%;
		width: 0;
		height: 0;
		pointer-events: none;
	}
	.flow-end-confetti > i {
		position: absolute;
		left: -4px;
		top: -4px;
		opacity: 0;
		animation: fe-spark 1100ms cubic-bezier(0.15, 0.7, 0.3, 1) both;
	}

	.flow-end-char {
		animation: fe-pop 600ms cubic-bezier(0.3, 1.5, 0.5, 1) both;
	}

	.flow-end-eyebrow {
		margin: 0.5rem 0 0;
		color: var(--laurel);
		letter-spacing: 0.24em;
		opacity: 0;
		animation: fe-rise 500ms ease 0.1s both;
	}

	.flow-end-head {
		margin: 0.375rem 0 0;
		font-size: 2.125rem;
		line-height: 1.05;
		letter-spacing: -0.02em;
		color: var(--text-base);
		opacity: 0;
		animation: fe-pop 560ms cubic-bezier(0.3, 1.5, 0.5, 1) 0.16s both;
	}

	.flow-end-stats {
		display: flex;
		gap: 0.625rem;
		justify-content: center;
		margin-top: 1.125rem;
	}
	.flow-end-stat {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 5.25rem;
		padding: 0.625rem 0.875rem;
		border-radius: var(--r-12);
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		opacity: 0;
	}
	.flow-end-stat-1 {
		animation: fe-rise 500ms ease 0.3s both;
	}
	.flow-end-stat-2 {
		animation: fe-rise 500ms ease 0.42s both;
	}
	.flow-end-stat-3 {
		animation: fe-rise 500ms ease 0.54s both;
	}
	.flow-end-stat-label {
		font-size: 0.5625rem;
		color: var(--text-muted);
	}
	.flow-end-stat-value {
		font-size: 1.0625rem;
		font-weight: 700;
		color: var(--text-base);
	}
	.flow-end-stat-value-fire {
		color: var(--char-flame, #f08a3c);
	}

	.flow-end-body {
		margin: 0.875rem 0 0;
		max-width: 32ch;
		font-size: var(--t-14);
		line-height: 1.5;
		color: var(--text-muted);
		opacity: 0;
		animation: fe-rise 500ms ease 0.66s both;
	}

	.flow-end-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5625rem;
		width: min(18.75rem, 86%);
		margin-top: 1.375rem;
		opacity: 0;
		animation: fe-rise 500ms ease 0.78s both;
	}

	/* Install nudge: a quiet bordered row, calmer than the primary CTA, that
	   inherits the staggered reveal so it lands with the growth links below. */
	.flow-end-install {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: min(18.75rem, 86%);
		margin-top: 1rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: var(--bg-surface);
		color: var(--text-base);
		text-align: left;
		cursor: pointer;
		opacity: 0;
		animation: fe-rise 500ms ease 0.88s both;
		transition: border-color var(--d-hover) var(--ease-vici);
	}

	.flow-end-install:hover {
		border-color: var(--border-strong);
	}

	.flow-end-install-glyph {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		color: var(--color-primary);
	}

	.flow-end-install-label {
		flex: 1 1 auto;
		font-size: var(--t-13);
		font-weight: 600;
		letter-spacing: -0.005em;
	}

	.flow-end-install :global(.lucide-chevron-right) {
		color: var(--text-muted);
	}

	.flow-end-links {
		display: flex;
		gap: 0.875rem;
		align-items: center;
		justify-content: center;
		margin-top: 1rem;
		opacity: 0;
		animation: fe-rise 500ms ease 0.9s both;
	}
	.flow-end-link {
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
	.flow-end-link-dot {
		color: color-mix(in srgb, var(--text-muted) 55%, transparent);
	}

	/* Reduced motion: keep the reward springs (the brand exception) but
	   fade them in place instead of springing, drop the confetti entirely,
	   and reveal every staggered element immediately. */
	.flow-end.is-static .flow-end-confetti {
		display: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.flow-end-char,
		.flow-end-eyebrow,
		.flow-end-head,
		.flow-end-stat,
		.flow-end-body,
		.flow-end-actions,
		.flow-end-install,
		.flow-end-links {
			animation: none;
			opacity: 1;
		}
	}
</style>
