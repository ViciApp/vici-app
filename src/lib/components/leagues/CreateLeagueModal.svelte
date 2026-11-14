<script lang="ts">
	import { ChevronRight, X } from '@lucide/svelte/icons';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import { LeaguePrivacy } from '#lib/enums/league.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import {
		createLeague,
		generateInviteCode,
		validateLeagueDraft
	} from '#lib/services/leagues.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import {
		LEAGUE_DESCRIPTION_MAX_LENGTH,
		LEAGUE_EMBLEM_DEFAULT,
		LEAGUE_EMBLEMS,
		LEAGUE_NAME_MAX_LENGTH,
		LEAGUE_NAME_MIN_LENGTH,
		type LeagueDoc
	} from '#lib/types/league.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
		// Fires after a successful create: parent re-fetches the list and
		// can navigate the user into the new league's detail page once it
		// lands.
		onCreated: (league: LeagueDoc) => void;
	}

	const { isOpen, onClose, onCreated }: Props = $props();

	// The emblem, colour, and privacy choice all persist onto the league
	// doc: the emblem as `emblem`, the colour as `accentColor`, and the
	// privacy choice as the league's `privacy` field, and drive the live
	// preview tile in this sheet.
	const COLORS = [
		{ id: 'laurel', value: '#e2b842' },
		{ id: 'mint', value: '#4fd3a1' },
		{ id: 'coral', value: '#ff6b6b' },
		{ id: 'hold', value: '#6b9fff' },
		{ id: 'violet', value: '#b49cff' },
		{ id: 'parch', value: '#f2ecdc' }
	] as const;
	// Two-way privacy selector: Open / Private, defaulting to Open (new
	// leagues are discoverable and battle-eligible from creation; owners
	// tighten to hidden in two taps). The chosen value persists onto the
	// league doc's `privacy` field and reads back as the detail header's
	// privacy chip.
	const PRIVACIES = [LeaguePrivacy.OPEN, LeaguePrivacy.PRIVATE] as const;

	const [DEFAULT_COLOR] = COLORS;

	let name = $state('');
	let description = $state('');
	let privacy = $state<LeaguePrivacy>(LeaguePrivacy.OPEN);
	let emblem = $state<string>(LEAGUE_EMBLEM_DEFAULT);
	let color = $state<string>(DEFAULT_COLOR.value);
	let submitting = $state(false);
	let submitError: string | null = $state(null);
	// The 6-char invite code the owner shares to bring members in. Our
	// codes are client-generated (see `createLeague`), so we mint one up
	// front and surface it on this sheet as a format affordance, then
	// hand the same value to `createLeague` so the code the owner sees is
	// the one persisted. Re-minted on every open of a fresh draft.
	let inviteCode = $state(generateInviteCode());

	const trimmedName = $derived(name.trim());
	const trimmedDescription = $derived(description.trim());

	const draftError: MessageKey | null = $derived.by(() => {
		// Don't show errors until the user has typed something, so the
		// empty initial state doesn't read as "field is invalid".
		if (name.length === 0 && description.length === 0) {
			return null;
		}

		const result = validateLeagueDraft({
			name: trimmedName,
			description: trimmedDescription || undefined
		});

		if (result.ok) {
			return null;
		}

		if (result.reason === 'name_too_short') {
			return 'leagues.create.invalid_name_too_short';
		}

		if (result.reason === 'name_too_long') {
			return 'leagues.create.invalid_name_too_long';
		}

		return 'leagues.create.invalid_description';
	});

	const canSubmit = $derived(
		!submitting &&
			validateLeagueDraft({
				name: trimmedName,
				description: trimmedDescription || undefined
			}).ok
	);

	const showPreview = $derived(trimmedName.length >= LEAGUE_NAME_MIN_LENGTH);

	const privacyLabel = (value: LeaguePrivacy): string =>
		t({ locale: $localeStore, key: `leagues.create.privacy_${value}` });

	const privacyDesc = (value: LeaguePrivacy): string =>
		t({ locale: $localeStore, key: `leagues.privacy.desc_${value}` });

	const previewMeta = $derived(
		t({
			locale: $localeStore,
			key: 'leagues.create.preview_meta',
			params: { privacy: privacyLabel(privacy).toUpperCase() }
		})
	);

	const reset = () => {
		name = '';
		description = '';
		privacy = LeaguePrivacy.OPEN;
		emblem = LEAGUE_EMBLEM_DEFAULT;
		color = DEFAULT_COLOR.value;
		submitting = false;
		submitError = null;
		// Mint a fresh code so the next draft shows (and persists) its own.
		inviteCode = generateInviteCode();
	};

	const handleClose = () => {
		reset();
		onClose();
	};

	const handleSubmit = async (event: Event) => {
		event.preventDefault();

		if (!canSubmit) {
			return;
		}

		submitting = true;
		submitError = null;

		try {
			const league = await createLeague({
				name: trimmedName,
				description: trimmedDescription || undefined,
				accentColor: color,
				emblem,
				privacy,
				inviteCode
			});
			track({ name: 'league_created', leagueId: league.id, label: privacy });
			onCreated(league);
			reset();
		} catch (err) {
			console.error('CreateLeagueModal: createLeague failed', err);
			submitError = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			submitting = false;
		}
	};
</script>

<BottomSheet {isOpen} onClose={handleClose} sidePadding="22px">
	<form class="league-form" onsubmit={handleSubmit}>
		<header class="league-form-head">
			<h2>{t({ locale: $localeStore, key: 'leagues.create.title' })}</h2>
			<button
				class="league-form-close"
				aria-label={t({ locale: $localeStore, key: 'a11y.close_modal' })}
				onclick={handleClose}
				type="button"
			>
				<X aria-hidden="true" size={18} strokeWidth={1.8} />
			</button>
		</header>

		<!-- Live preview card: mirrors the leagues-list row so the
		     owner sees exactly how their league reads before creating. -->
		{#if showPreview}
			<div
				style:--accent={color}
				style:--accent-grad={`linear-gradient(160deg, ${color}33 0%, ${color}11 40%, var(--bg-surface) 100%)`}
				class="league-preview"
				aria-hidden="true"
			>
				<span class="league-preview-logo">
					<span class="league-preview-emblem">{emblem}</span>
				</span>
				<span class="league-preview-body">
					<span class="league-preview-name">{trimmedName}</span>
					{#if trimmedDescription}
						<span class="league-preview-desc num">{trimmedDescription}</span>
					{/if}
					<span class="league-preview-meta num allcaps">{previewMeta}</span>
				</span>
			</div>
		{/if}

		<label class="league-field">
			<span class="league-field-label allcaps">
				{t({ locale: $localeStore, key: 'leagues.create.label_name' })}
			</span>
			<input
				class="league-field-input"
				autocomplete="off"
				maxlength={LEAGUE_NAME_MAX_LENGTH}
				minlength={LEAGUE_NAME_MIN_LENGTH}
				placeholder={t({ locale: $localeStore, key: 'leagues.create.placeholder_name' })}
				required
				type="text"
				bind:value={name}
			/>
		</label>

		<label class="league-field">
			<span class="league-field-label allcaps">
				{t({ locale: $localeStore, key: 'leagues.create.label_description' })}
			</span>
			<input
				class="league-field-input"
				autocomplete="off"
				maxlength={LEAGUE_DESCRIPTION_MAX_LENGTH}
				placeholder={t({
					locale: $localeStore,
					key: 'leagues.create.placeholder_description'
				})}
				type="text"
				bind:value={description}
			/>
		</label>

		<fieldset class="league-field">
			<legend id="league-privacy-label" class="league-field-label allcaps">
				{t({ locale: $localeStore, key: 'leagues.create.label_privacy' })}
			</legend>
			<div class="league-vis-list" aria-labelledby="league-privacy-label" role="radiogroup">
				{#each PRIVACIES as option (option)}
					<button
						class="league-vis-card"
						class:is-active={privacy === option}
						aria-checked={privacy === option}
						onclick={() => (privacy = option)}
						role="radio"
						type="button"
					>
						<span class="league-vis-radio" aria-hidden="true"></span>
						<span class="league-vis-body">
							<span class="league-vis-title">{privacyLabel(option)}</span>
							<span class="league-vis-sub">{privacyDesc(option)}</span>
						</span>
					</button>
				{/each}
			</div>
		</fieldset>

		<fieldset class="league-field">
			<legend class="league-field-label allcaps">
				{t({ locale: $localeStore, key: 'leagues.create.label_emblem' })}
			</legend>
			<div class="league-emblem-grid">
				{#each LEAGUE_EMBLEMS as option (option)}
					<button
						style:--emblem-color={color}
						class="league-emblem-btn"
						class:is-active={emblem === option}
						aria-label={option}
						aria-pressed={emblem === option}
						onclick={() => (emblem = option)}
						type="button"
					>
						{option}
					</button>
				{/each}
			</div>
		</fieldset>

		<fieldset class="league-field">
			<legend class="league-field-label allcaps">
				{t({ locale: $localeStore, key: 'leagues.create.label_color' })}
			</legend>
			<div class="league-color-row">
				{#each COLORS as option (option.id)}
					<button
						style:background={option.value}
						class="league-color-btn"
						class:is-active={color === option.value}
						aria-label={option.id}
						aria-pressed={color === option.value}
						onclick={() => (color = option.value)}
						type="button"
					></button>
				{/each}
			</div>
		</fieldset>

		<!-- Invite-code affordance: surfaces the league's real 6-char code
		     so the owner can share it the moment they create. Read-only;
		     the value is minted client-side and handed to `createLeague`. -->
		<div class="league-invite-code">
			<span class="num league-invite-code-value">{inviteCode}</span>
			<span class="num mute allcaps league-invite-code-label">
				{t({ locale: $localeStore, key: 'leagues.create.invite_code' })}
			</span>
		</div>

		{#if draftError}
			<p class="league-form-error" role="alert">
				{t({ locale: $localeStore, key: draftError })}
			</p>
		{:else if submitError}
			<p class="league-form-error" role="alert">{submitError}</p>
		{/if}

		<div class="league-form-actions">
			<button class="league-btn is-primary" disabled={!canSubmit} type="submit">
				<span>
					{t({
						locale: $localeStore,
						key: submitting ? 'leagues.create.submitting' : 'leagues.create.cta'
					})}
				</span>
				{#if !submitting}
					<ChevronRight aria-hidden="true" size={15} strokeWidth={2.2} />
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
	   the source design (title left, circular ghost close right). */
	.league-form-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
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

	/* ─── Live preview card ─────────────────────────────────────── */

	.league-preview {
		display: grid;
		grid-template-columns: 56px 1fr;
		gap: 12px;
		align-items: center;
		padding: 14px;
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		border-radius: 12px;
	}

	.league-preview-logo {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 56px;
		height: 56px;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		background: var(--accent-grad);
	}

	.league-preview-emblem {
		font-family: var(--font-serif, var(--font-display, serif));
		font-style: italic;
		font-size: 24px;
		color: var(--accent);
		line-height: 1;
	}

	.league-preview-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.league-preview-name {
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.005em;
		color: var(--text-base);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.league-preview-desc {
		font-size: 10.5px;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.league-preview-meta {
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
	}

	/* ─── Fields ────────────────────────────────────────────────── */

	.league-field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
		border: 0;
		padding: 0;
		margin: 0;
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
	}

	.league-field-input:focus {
		outline: 2px solid color-mix(in srgb, var(--laurel) 55%, transparent);
		outline-offset: 0;
	}

	/* ─── Privacy visibility cards ──────────────────────────────── */

	.league-vis-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.league-vis-card {
		appearance: none;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem 0.85rem;
		font: inherit;
		text-align: left;
		background: color-mix(in srgb, var(--bg-surface) 90%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		cursor: pointer;
		transition:
			border-color 160ms var(--ease-vici),
			background 160ms var(--ease-vici);
	}

	.league-vis-card.is-active {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 6%, transparent);
	}

	.league-vis-radio {
		flex: 0 0 auto;
		width: 18px;
		height: 18px;
		border-radius: var(--r-pill);
		border: 2px solid var(--border-base);
		transition: border-color 160ms var(--ease-vici);
	}

	.league-vis-card.is-active .league-vis-radio {
		border-color: var(--color-accent);
		box-shadow:
			inset 0 0 0 3px var(--bg-surface),
			inset 0 0 0 9px var(--color-accent);
	}

	.league-vis-body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.league-vis-title {
		font-size: var(--t-14);
		font-weight: 600;
		color: var(--text-base);
	}

	.league-vis-card.is-active .league-vis-title {
		color: var(--color-accent);
	}

	.league-vis-sub {
		font-size: 11.5px;
		line-height: 1.4;
		color: var(--text-muted);
	}

	/* ─── Emblem picker ─────────────────────────────────────────── */

	.league-emblem-grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 0.4rem;
	}

	.league-emblem-btn {
		appearance: none;
		aspect-ratio: 1 / 1;
		font-family: var(--font-serif, var(--font-display, serif));
		font-style: italic;
		font-size: 1.25rem;
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
		cursor: pointer;
		transition: border-color 140ms var(--ease-vici);
	}

	.league-emblem-btn.is-active {
		color: var(--emblem-color);
		border: 2px solid var(--color-accent);
	}

	/* ─── Colour picker ─────────────────────────────────────────── */

	.league-color-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.league-color-btn {
		appearance: none;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border-radius: var(--r-pill);
		border: 1.5px solid var(--border-base);
		cursor: pointer;
	}

	.league-color-btn.is-active {
		border: 2px solid var(--color-accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--laurel) 22%, transparent);
	}

	/* ─── Invite-code affordance ────────────────────────────────── */

	/* Dashed read-only box: the league's real code (accent, tracked) on
	   the left, an "Invite code" eyebrow on the right; the owner's cue
	   for what to share. */
	.league-invite-code {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.65rem 0.9rem;
		background: color-mix(in srgb, var(--laurel) 4%, transparent);
		border: 1px dashed var(--border-base);
		border-radius: var(--r-12);
	}

	.league-invite-code-value {
		font-family: var(--font-mono);
		font-size: var(--t-14);
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--color-accent);
	}

	.league-invite-code-label {
		font-size: 9.5px;
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
	}

	.league-form-error {
		margin: 0;
		font-size: var(--t-12);
		color: var(--no);
	}

	/* Single full-width CTA: no Cancel; the sheet scrim / grip is the
	   dismiss affordance, so the create action owns the row edge to edge. */
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
