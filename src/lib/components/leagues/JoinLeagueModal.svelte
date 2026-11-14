<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { Check, ChevronRight, X } from '@lucide/svelte/icons';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import { joinLeagueByInvite, lookupLeagueByInvite } from '#lib/services/leagues.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import {
		LEAGUE_INVITE_CODE_EXAMPLE,
		LEAGUE_INVITE_CODE_REGEX,
		leagueEmblem,
		type LeagueDoc
	} from '#lib/types/league.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
		onJoined: (league: LeagueDoc) => void;
	}

	const { isOpen, onClose, onJoined }: Props = $props();

	// The helper sentence carries a `{code}` slot so spacing and trailing
	// punctuation stay locale-correct (zh-Hans ends on 。, not "."); we split
	// the localized copy on that slot and drop the accent-tinted sample
	// token (our real 6-char invite shape) into the gap. Mirrors the field
	// placeholder, which renders the same shared sample.
	const subParts = $derived(t({ locale: $localeStore, key: 'leagues.join.sub' }).split('{code}'));

	let code = $state('');
	let submitting = $state(false);
	let submitError: MessageKey | string | null = $state(null);
	// Live preview: the league a fully-typed code resolves to. Drives
	// the green-bordered match card + the join button label so the user
	// sees who they're about to join before committing.
	let matched: LeagueDoc | undefined = $state();
	let resolving = $state(false);
	// A code found on the clipboard at open-time. Tapping the hint fills
	// the field: saves the user a manual paste on mobile.
	let pasteHint: string | null = $state(null);

	const normalisedCode = $derived(code.trim().toUpperCase());
	const codeIsValid = $derived(LEAGUE_INVITE_CODE_REGEX.test(normalisedCode));
	const canSubmit = $derived(!submitting && nonNullish(matched));

	// Resolve the league as the user finishes typing a valid code. Each
	// keystroke that yields a complete code kicks off a lookup; stale
	// results are discarded by comparing against the live `normalisedCode`.
	$effect(() => {
		const current = normalisedCode;

		if (!LEAGUE_INVITE_CODE_REGEX.test(current)) {
			matched = undefined;
			resolving = false;

			return;
		}

		resolving = true;
		let cancelled = false;

		void (async () => {
			try {
				const found = await lookupLeagueByInvite({ inviteCode: current });

				if (cancelled || current !== normalisedCode) {
					return;
				}

				matched = found;
			} catch {
				if (!cancelled) {
					matched = undefined;
				}
			} finally {
				if (!cancelled) {
					resolving = false;
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	// On open, peek at the clipboard for a code-shaped string and offer
	// it as a one-tap fill. Clipboard reads can reject (permissions /
	// insecure context); a failure just skips the hint silently.
	$effect(() => {
		if (!isOpen) {
			pasteHint = null;

			return;
		}

		void (async () => {
			try {
				const text = await navigator.clipboard?.readText?.();
				const cleaned = (text ?? '').trim().toUpperCase();

				if (LEAGUE_INVITE_CODE_REGEX.test(cleaned) && cleaned !== normalisedCode) {
					pasteHint = cleaned;
				}
			} catch {
				// No clipboard access: skip the hint.
			}
		})();
	});

	const reset = () => {
		code = '';
		submitting = false;
		submitError = null;
		matched = undefined;
		resolving = false;
		pasteHint = null;
	};

	const handleClose = () => {
		reset();
		onClose();
	};

	const usePasteHint = () => {
		if (pasteHint) {
			code = pasteHint;
			pasteHint = null;
		}
	};

	const handleSubmit = async (event: Event) => {
		event.preventDefault();

		if (!canSubmit || !matched) {
			return;
		}

		submitting = true;
		submitError = null;

		try {
			const league = await joinLeagueByInvite({ inviteCode: normalisedCode });
			onJoined(league);
			reset();
		} catch (err) {
			const message = err instanceof Error ? err.message : '';

			// Map known error strings to localised keys; fall back to the
			// generic message for anything else (raw error logged below).
			if (message === 'No league found for that invite code.') {
				submitError = 'leagues.join.error_not_found';
			} else if (message === 'Already a member of this league.') {
				submitError = 'leagues.join.error_already_member';
			} else {
				console.error('JoinLeagueModal: joinLeagueByInvite failed', err);
				submitError = 'common.error.generic';
			}
		} finally {
			submitting = false;
		}
	};
</script>

<BottomSheet {isOpen} onClose={handleClose} sidePadding="22px">
	<form class="league-form" onsubmit={handleSubmit}>
		<header class="league-form-head">
			<div class="league-form-head-row">
				<h2>{t({ locale: $localeStore, key: 'leagues.join.title' })}</h2>
				<button
					class="league-form-close"
					aria-label={t({ locale: $localeStore, key: 'a11y.close_modal' })}
					onclick={handleClose}
					type="button"
				>
					<X aria-hidden="true" size={18} strokeWidth={1.8} />
				</button>
			</div>
			<p>
				{subParts[0]}<code class="league-code-example num">{LEAGUE_INVITE_CODE_EXAMPLE}</code
				>{subParts[1] ?? ''}
			</p>
		</header>

		{#if pasteHint}
			<button class="league-paste-hint" onclick={usePasteHint} type="button">
				<span class="num acc">{pasteHint}</span>
				<span class="num mute allcaps">
					{t({ locale: $localeStore, key: 'leagues.join.paste_hint' })}
				</span>
			</button>
		{/if}

		<label class="league-field">
			<span class="league-field-label allcaps">
				{t({ locale: $localeStore, key: 'leagues.join.label_code' })}
			</span>
			<input
				class="league-field-input is-code num"
				class:is-matched={nonNullish(matched)}
				aria-invalid={codeIsValid && !resolving && isNullish(matched)}
				autocapitalize="characters"
				autocomplete="off"
				maxlength="6"
				minlength="6"
				placeholder={LEAGUE_INVITE_CODE_EXAMPLE}
				required
				spellcheck="false"
				type="text"
				bind:value={code}
			/>
		</label>

		{#if matched}
			<div class="league-match-preview" aria-live="polite">
				<span
					style:--accent={matched.accentColor ?? 'var(--laurel)'}
					style:--accent-grad={`linear-gradient(160deg, ${matched.accentColor ?? '#e2b842'}33 0%, ${matched.accentColor ?? '#e2b842'}11 40%, var(--bg-surface) 100%)`}
					class="league-match-logo"
				>
					<span class="league-match-emblem">
						{leagueEmblem(matched)}
					</span>
				</span>
				<span class="league-match-body">
					<span class="league-match-name">{matched.name}</span>
					<span class="num mute league-match-sub">
						{t({ locale: $localeStore, key: 'leagues.join.match_sub' })}
					</span>
				</span>
				<Check class="league-match-check" aria-hidden="true" size={16} strokeWidth={2.4} />
			</div>
		{/if}

		{#if nonNullish(submitError)}
			<p class="league-form-error" role="alert">
				{typeof submitError === 'string' && !submitError.includes('.')
					? submitError
					: t({ locale: $localeStore, key: submitError as MessageKey })}
			</p>
		{/if}

		<div class="league-form-actions">
			<button class="league-btn is-primary" disabled={!canSubmit} type="submit">
				{#if submitting}
					{t({ locale: $localeStore, key: 'leagues.join.submitting' })}
				{:else if matched}
					<span>
						{t({
							locale: $localeStore,
							key: 'leagues.join.cta_named',
							params: { name: matched.name }
						})}
					</span>
					<ChevronRight aria-hidden="true" size={15} strokeWidth={2.2} />
				{:else}
					{t({ locale: $localeStore, key: 'leagues.join.cta' })}
				{/if}
			</button>
		</div>
	</form>
</BottomSheet>

<style lang="postcss">
	.league-form {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	/* Title + top-right close × on one row: mirrors the sheet header in
	   the source design (title left, circular ghost close right). The
	   helper paragraph stays below the row. */
	.league-form-head-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.league-form-head h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--t-18, 1.1rem);
		color: var(--text-base);
	}

	.league-form-close {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		padding: 0;
		color: var(--text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			color 140ms var(--ease-vici),
			background 140ms var(--ease-vici);
	}

	.league-form-close:hover {
		color: var(--text-base);
		background: color-mix(in srgb, var(--text-base) 8%, transparent);
	}

	.league-form-head p {
		margin: 0;
		font-size: var(--t-13);
		color: var(--text-muted);
		line-height: 1.5;
	}

	/* Inline sample code: mono, accent-tinted, so the expected format
	   stands out from the surrounding helper sentence. */
	.league-code-example {
		font-family: var(--font-mono);
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--color-accent);
	}

	/* ─── Clipboard paste hint ──────────────────────────────────── */

	.league-paste-hint {
		appearance: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		padding: 0.65rem 0.9rem;
		font: inherit;
		background: color-mix(in srgb, var(--laurel) 6%, transparent);
		border: 1px dashed color-mix(in srgb, var(--laurel) 25%, transparent);
		border-radius: var(--r-12);
		cursor: pointer;
	}

	.league-paste-hint .num {
		font-family: var(--font-mono);
		font-size: var(--t-13);
		font-weight: 700;
		letter-spacing: 0.1em;
	}

	.league-paste-hint .num.mute {
		font-weight: 500;
		font-size: var(--t-10);
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	/* ─── Fields ────────────────────────────────────────────────── */

	.league-field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.league-field-label {
		font-size: var(--t-11);
		color: var(--text-muted);
	}

	.league-field-input {
		appearance: none;
		padding: 0.7rem 0.85rem;
		font: inherit;
		font-size: var(--t-14);
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		transition: border-color 160ms var(--ease-vici);
	}

	.league-field-input:focus {
		outline: 2px solid color-mix(in srgb, var(--laurel) 55%, transparent);
		outline-offset: 0;
	}

	.league-field-input.is-code {
		font-size: var(--t-20, 1.25rem);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-align: center;
		text-transform: uppercase;
	}

	.league-field-input.is-matched {
		border-color: var(--yes);
	}

	/* ─── Live match preview ────────────────────────────────────── */

	.league-match-preview {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.75rem 0.9rem;
		background: color-mix(in srgb, var(--yes) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--yes) 22%, transparent);
		border-radius: var(--r-12);
	}

	.league-match-logo {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--r-8);
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		background: var(--accent-grad);
	}

	.league-match-emblem {
		font-family: var(--font-serif, var(--font-display, serif));
		font-style: italic;
		font-size: var(--t-16);
		color: var(--accent);
		line-height: 1;
	}

	.league-match-body {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		flex: 1;
		min-width: 0;
	}

	.league-match-name {
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-base);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.league-match-sub {
		font-size: 10.5px;
		color: var(--text-muted);
	}

	:global(.league-match-check) {
		flex-shrink: 0;
		color: var(--yes);
	}

	.league-form-error {
		margin: 0;
		font-size: var(--t-12);
		color: var(--no);
	}

	/* Single full-width CTA: no Cancel; the disabled label doubles as
	   the inline hint ("Enter a valid code") until a code resolves. */
	.league-form-actions {
		display: flex;
		margin-top: 0.35rem;
	}

	.league-btn {
		appearance: none;
		display: inline-flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		padding: 0.875rem 1rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 700;
		border-radius: var(--r-pill);
		cursor: pointer;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition:
			background 140ms ease,
			color 140ms ease,
			border-color 140ms ease;
	}

	.league-btn.is-primary {
		color: var(--text-on-accent, #fff);
		background: var(--laurel);
		border: 1px solid var(--laurel);
	}

	.league-btn.is-primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--laurel) 88%, var(--text-base));
	}

	.league-btn.is-primary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
