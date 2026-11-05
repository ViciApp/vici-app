<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { signOut } from '@junobuild/core';
	import { ArrowLeftRight, Check, ChevronRight, Mail } from '@lucide/svelte/icons';
	import { onDestroy } from 'svelte';
	import IconGoogle from '#lib/components/icons/IconGoogle.svelte';
	import IconIc from '#lib/components/icons/IconIC.svelte';
	import IconPasskey from '#lib/components/icons/IconPasskey.svelte';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import { AppPath, PublicPath } from '#lib/constants/routes.constants.ts';
	import { flushEvents, track } from '#lib/services/analytics.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { resolveSignInMethod } from '#lib/utils/signin-method.utils.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	/**
	 * Account settings — current sign-in method + email address. Two
	 * editorial cards: the method tile (glyph + label + address) over a
	 * switch action, and the email card with an `idle → editing → sent`
	 * change flow.
	 *
	 * Sign-in method is derived from the provider Juno records on the
	 * `#user` doc (`user.data.provider`), refined by whether an address is
	 * on file: an email surfaces the email-shaped card, `google` / a plain
	 * `webauthn` passkey surface their own glyph + label, and Internet
	 * Identity (including Apple, which signs in through II) is the fallback.
	 * Shared with the Settings summary row via `resolveSignInMethod`.
	 *
	 * Switching always signs the user out and returns them to the
	 * sign-in screen, where the full provider stack lives; rather than
	 * list each provider here (every one would route to the same place)
	 * we expose one switch action under the canonical card shell.
	 *
	 * The email-change flow is wired as a state machine but its submit
	 * is inert: the back-end that would mint the confirmation link has
	 * not shipped, so the send action is disabled with a
	 * "Soon" note. When the back-end lands, `sendVerify` flips to the
	 * `sent` state and the existing copy/layout carries through.
	 */

	const EMAIL_CHANGE_ENABLED = false;

	// The address lives on the owner-private `profile_private` doc (hydrated
	// into the store at sign-in), never on the public profile.
	const email = $derived($userStore.email);
	const hasEmail = $derived(email.length > 0);

	const method = $derived(resolveSignInMethod({ user: $userStore.user, hasEmail }));

	const methodLabel = $derived.by(() => {
		switch (method) {
			case 'email':
				return t({ locale: $localeStore, key: 'account.method.email' });
			case 'google':
				return t({ locale: $localeStore, key: 'account.method.google' });
			case 'passkey':
				return t({ locale: $localeStore, key: 'account.method.passkey' });
			default:
				return t({ locale: $localeStore, key: 'account.method.ii' });
		}
	});

	let switchingMethod = $state(false);

	let editingEmail = $state(false);
	let emailSent = $state(false);
	let newEmail = $state('');
	let sentResetTimer: ReturnType<typeof setTimeout> | undefined;

	const newEmailValid = $derived(/\S+@\S+\.\S+/.test(newEmail));

	// Split the sent-body sentence around {email} so we can emphasise
	// the address with a <span> without reaching for {@html}.
	const sentBodyParts = $derived.by(() => {
		const full = t({
			locale: $localeStore,
			key: 'account.email.sent_body',
			params: { email: '\x00' }
		});
		const idx = full.indexOf('\x00');

		if (idx === -1) {
			return { before: full, after: '' };
		}

		return { before: full.slice(0, idx), after: full.slice(idx + 1) };
	});

	const handleSwitchMethod = async () => {
		if (switchingMethod) {
			return;
		}

		switchingMethod = true;

		// Emit + flush before the auth drop so the principal is still
		// stitched onto the event; fire-and-forget, never blocks sign-out.
		track({ name: 'signed_out', source: 'account_settings', label: 'switch_method' });
		void flushEvents();

		try {
			await signOut();
			void goto(resolve(PublicPath.SignIn));
		} catch (err: unknown) {
			console.warn('Sign-out failed:', err);
		} finally {
			switchingMethod = false;
		}
	};

	const clearSentTimer = () => {
		if (nonNullish(sentResetTimer)) {
			clearTimeout(sentResetTimer);
			sentResetTimer = undefined;
		}
	};

	const startEdit = () => {
		clearSentTimer();
		editingEmail = true;
		emailSent = false;
		newEmail = '';
	};

	const cancelEdit = () => {
		clearSentTimer();
		editingEmail = false;
		newEmail = '';
	};

	const sendVerify = () => {
		// Inert until the confirmation-link back-end ships. The branch below is
		// the one-line swap: flip `emailSent` and schedule the reset.
		if (!EMAIL_CHANGE_ENABLED || !newEmailValid) {
			return;
		}

		emailSent = true;
		sentResetTimer = setTimeout(() => {
			editingEmail = false;
			emailSent = false;
			newEmail = '';
			sentResetTimer = undefined;
		}, 2400);
	};

	onDestroy(() => {
		clearSentTimer();
	});
</script>

<div class="account-page">
	<ScreenHeader
		back={{
			label: t({ locale: $localeStore, key: 'account.back' }),
			onBack: () => goBack(resolveAppPath(AppPath.Settings))
		}}
		title={t({ locale: $localeStore, key: 'account.title' })}
	/>

	<p class="account-intro serif-italic">
		{t({ locale: $localeStore, key: 'account.intro' })}
	</p>

	<section class="account-card">
		<h2 class="eyebrow account-section-title">
			{t({ locale: $localeStore, key: 'account.method.eyebrow' })}
		</h2>

		<div class="account-method-row">
			<div class="account-method-glyph" aria-hidden="true">
				{#if method === 'email'}
					<Mail size={20} strokeWidth={1.8} />
				{:else if method === 'google'}
					<IconGoogle size="20px" />
				{:else if method === 'passkey'}
					<IconPasskey size="20px" />
				{:else}
					<IconIc size="20px" />
				{/if}
			</div>
			<div class="account-method-text">
				<span class="account-method-name">{methodLabel}</span>
				{#if hasEmail}
					<span class="num account-method-email">{email}</span>
				{/if}
			</div>
		</div>

		<h3 class="eyebrow account-switch-title">
			{t({ locale: $localeStore, key: 'account.switch.eyebrow' })}
		</h3>

		<button
			class="account-switch"
			aria-busy={switchingMethod}
			disabled={switchingMethod}
			onclick={handleSwitchMethod}
			type="button"
		>
			<span class="account-switch-glyph" aria-hidden="true">
				<ArrowLeftRight size={18} strokeWidth={1.8} />
			</span>
			<span class="account-switch-label">
				{switchingMethod
					? t({ locale: $localeStore, key: 'account.switch.signing_out' })
					: t({ locale: $localeStore, key: 'account.switch.cta' })}
			</span>
			{#if switchingMethod}
				<span class="account-spinner" aria-hidden="true"></span>
			{:else}
				<ChevronRight aria-hidden="true" size={16} strokeWidth={2.2} />
			{/if}
		</button>

		<p class="account-hint num">
			{t({ locale: $localeStore, key: 'account.switch.hint' })}
		</p>
	</section>

	<section class="account-card">
		<h2 class="eyebrow account-section-title">
			{t({ locale: $localeStore, key: 'account.email.eyebrow' })}
		</h2>

		{#if !editingEmail}
			<div class="account-email-head">
				{#if hasEmail}
					<span class="account-email-value">{email}</span>
					<span class="account-verified num">
						{t({ locale: $localeStore, key: 'account.email.verified' })}
					</span>
				{:else}
					<span class="account-email-empty serif-italic">
						{t({ locale: $localeStore, key: 'account.email.empty' })}
					</span>
				{/if}
			</div>
			<p class="account-hint num">
				{t({ locale: $localeStore, key: 'account.email.used_for' })}
			</p>
			<button class="account-ghost account-email-change" onclick={startEdit} type="button">
				<span class="account-ghost-label">
					{t({ locale: $localeStore, key: 'account.email.change' })}
				</span>
				<ChevronRight aria-hidden="true" size={16} strokeWidth={2.2} />
			</button>
		{:else if emailSent}
			<div class="account-sent">
				<div class="account-sent-mark" aria-hidden="true">
					<Check size={22} strokeWidth={2} />
				</div>
				<p class="account-sent-title serif-italic acc">
					{t({ locale: $localeStore, key: 'account.email.sent_title' })}
				</p>
				<p class="account-sent-body num">
					{sentBodyParts.before}<span class="account-sent-target">{newEmail}</span
					>{sentBodyParts.after}
				</p>
			</div>
		{:else}
			<form
				class="account-edit"
				onsubmit={(event) => {
					event.preventDefault();
					sendVerify();
				}}
			>
				<p class="account-edit-note">
					{t({ locale: $localeStore, key: 'account.email.edit_note' })}
				</p>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="account-edit-input num"
					autocapitalize="off"
					autocomplete="email"
					autofocus
					disabled={!EMAIL_CHANGE_ENABLED}
					inputmode="email"
					placeholder={t({ locale: $localeStore, key: 'account.email.placeholder' })}
					spellcheck="false"
					type="email"
					bind:value={newEmail}
				/>
				<div class="account-edit-actions">
					<button class="account-ghost account-edit-cancel" onclick={cancelEdit} type="button">
						{t({ locale: $localeStore, key: 'account.email.cancel' })}
					</button>
					<button
						class="account-edit-send"
						disabled={!EMAIL_CHANGE_ENABLED || !newEmailValid}
						type="submit"
					>
						{t({ locale: $localeStore, key: 'account.email.send' })}
					</button>
				</div>
				{#if !EMAIL_CHANGE_ENABLED}
					<p class="account-hint num">
						{t({ locale: $localeStore, key: 'account.email.soon' })}
					</p>
				{/if}
			</form>
		{/if}
	</section>
</div>

<style lang="postcss">
	.account-page {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 0.5rem 1.25rem 2rem;
	}

	.account-intro {
		margin: 0;
		font-size: 0.84375rem;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.account-card {
		display: flex;
		flex-direction: column;
		padding: 1.25rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		box-shadow: var(--inset-hi);
	}

	.account-section-title {
		margin: 0 0 0.625rem;
		color: var(--text-muted);
	}

	/* ── Current method ───────────────────────────────────────── */
	.account-method-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.875rem;
	}

	.account-method-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 44px;
		height: 44px;
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		color: var(--text-base);
	}

	.account-method-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1;
		min-width: 0;
	}

	.account-method-name {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-base);
	}

	.account-method-email {
		font-size: var(--t-11);
		color: var(--text-muted);
	}

	.account-switch-title {
		margin: 0 0 0.5rem;
		color: var(--text-muted);
	}

	/* ── Switch action ───────────────────────────────────────── */
	.account-switch,
	.account-ghost {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		appearance: none;
		padding: 0.625rem 0.875rem;
		font: inherit;
		font-size: var(--t-14);
		font-weight: 600;
		text-align: left;
		color: var(--text-base);
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		cursor: pointer;
		transition:
			background 140ms ease,
			border-color 140ms ease;
	}

	.account-switch:hover:not(:disabled),
	.account-ghost:hover:not(:disabled) {
		background: color-mix(in srgb, var(--bg-popover) 80%, var(--text-base));
		border-color: var(--border-strong);
	}

	.account-switch:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.account-switch-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
	}

	.account-switch-label,
	.account-ghost-label {
		flex: 1;
		min-width: 0;
	}

	.account-spinner {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		border: 2px solid color-mix(in srgb, var(--text-base) 25%, transparent);
		border-top-color: var(--text-base);
		border-radius: 999px;
		animation: account-spin 0.7s linear infinite;
	}

	/* ── Hints ───────────────────────────────────────────────── */
	.account-hint {
		margin: 0.75rem 0 0;
		font-size: var(--t-11);
		line-height: 1.5;
		color: var(--text-muted);
	}

	/* ── Email card ──────────────────────────────────────────── */
	.account-email-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.account-email-value {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-base);
		overflow-wrap: anywhere;
	}

	.account-email-empty {
		font-size: var(--t-14);
		color: var(--text-muted);
	}

	.account-verified {
		flex-shrink: 0;
		padding: 0.125rem 0.5rem;
		font-size: 0.59375rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--yes);
		background: var(--yes-wash);
		border-radius: 4px;
	}

	.account-ghost {
		margin-top: 0.75rem;
	}

	/* Change-email button hugs its label instead of spanning the card
	   width: a compact, content-sized rounded control (corner radius
	   inherited from the shared `.account-ghost` 12-px rule) anchored to
	   the start of the column. The shared full-width `.account-switch`
	   and the 50/50 `.account-edit-cancel` are untouched — only this
	   secondary action collapses to its content. */
	.account-email-change {
		width: auto;
		align-self: flex-start;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
	}

	/* The label no longer needs to fill a full-width track once the
	   button hugs its content, so drop the flex-grow for this button. */
	.account-email-change .account-ghost-label {
		flex: 0 0 auto;
	}

	/* ── Email edit ──────────────────────────────────────────── */
	.account-edit {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.account-edit-note {
		margin: 0;
		font-size: 0.78125rem;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.account-edit-input {
		padding: 0.75rem 0.875rem;
		font: inherit;
		font-family: var(--font-mono);
		font-size: var(--t-14);
		color: var(--text-base);
		background: var(--bg-popover);
		border: 1px solid var(--border-strong);
		border-radius: 10px;
		outline: 0;
	}

	.account-edit-input:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.account-edit-input:focus-visible {
		border-color: color-mix(in srgb, var(--brand) 45%, var(--border-strong));
	}

	.account-edit-actions {
		display: flex;
		gap: 0.5rem;
	}

	.account-edit-cancel {
		flex: 1;
		justify-content: center;
		margin-top: 0;
		text-align: center;
	}

	.account-edit-send {
		flex: 1;
		appearance: none;
		padding: 0.6875rem 0.875rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-inverse);
		background: var(--brand);
		border: 1px solid transparent;
		border-radius: var(--r-12);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
		cursor: pointer;
		transition: background 140ms ease;
	}

	.account-edit-send:hover:not(:disabled) {
		background: var(--brand-deep);
	}

	.account-edit-send:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Sent confirmation ───────────────────────────────────── */
	.account-sent {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.account-sent-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		color: var(--yes);
		background: var(--yes-wash);
		border-radius: 999px;
	}

	.account-sent-title {
		margin: 0;
		font-size: var(--t-18);
		line-height: 1.3;
	}

	.account-sent-body {
		margin: 0;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.account-sent-target {
		color: var(--text-base);
		font-weight: 700;
	}

	@keyframes account-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.account-spinner {
			animation: none;
		}
	}
</style>
