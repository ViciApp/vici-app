<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { Loader2 } from '@lucide/svelte/icons';
	import Button from '#lib/components/ui/Button.svelte';
	import { ACCOUNT_RECOVERY_WINDOW_MS, DAY_IN_MS } from '#lib/constants/app.constants.ts';
	import { recoverMyAccount, resumeMyAccount } from '#lib/services/account.services.ts';
	// The dual-mode sign-out: the Juno delegation drop on the default
	// backend, the cookie-session revoke in web2 mode.
	import { signOut } from '#lib/services/identity.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { setAuthBusy, userStore } from '#lib/stores/user.store.ts';
	import type { ButtonStatus } from '#lib/types/components.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';

	/**
	 * Blocking return gate for a paused / deleting account.
	 *
	 * The auth loader hydrates `$userStore.profile` from the caller's own
	 * raw profile doc, so a returning user who soft-deleted or hibernated
	 * carries `deletedAtMs` / `hibernatedAtMs` at runtime. This overlay
	 * reads those markers and, when either is set, covers the whole app
	 * shell with a can't-dismiss-into-the-app prompt: the only way past is
	 * to recover / resume the account or to sign out. When neither marker
	 * is present (a normal active user) it renders nothing and is inert.
	 *
	 * It is mounted once in the authenticated `(app)` layout. On a
	 * successful recover / resume it clears the matching marker on
	 * `$userStore.profile` so the gate self-dismisses without a reload;
	 * the satellite has already cleared it server-side.
	 */

	type Mode = 'deleted' | 'hibernated' | null;

	let inFlight = $state(false);
	let errorKey = $state<MessageKey | null>(null);
	let expired = $state(false);

	const deletedAtMs = $derived($userStore.profile?.deletedAtMs);
	const hibernatedAtMs = $derived($userStore.profile?.hibernatedAtMs);

	// Soft-delete and hibernation are mutually exclusive on the profile;
	// soft-delete wins if both ever appear so the terminal-state copy is
	// never masked by the softer paused-state copy.
	const mode = $derived<Mode>(
		nonNullish(deletedAtMs) ? 'deleted' : nonNullish(hibernatedAtMs) ? 'hibernated' : null
	);

	// Whole days left in the recovery window, floored at zero. Ceil so the
	// final partial day still reads as "1 day left" rather than "0".
	const daysLeft = $derived.by(() => {
		if (isNullish(deletedAtMs)) {
			return 0;
		}

		const remainingMs = deletedAtMs + ACCOUNT_RECOVERY_WINDOW_MS - Date.now();

		return Math.max(0, Math.ceil(remainingMs / DAY_IN_MS));
	});

	const recoverStatus = $derived<ButtonStatus>(inFlight ? 'pending' : 'enabled');

	/** Sign out, leaving the account in its current (still-recoverable) state. */
	const doSignOut = async () => {
		if (inFlight) {
			return;
		}

		inFlight = true;
		setAuthBusy(true);
		await signOut();
	};

	const runRecover = async () => {
		if (inFlight) {
			return;
		}

		inFlight = true;
		errorKey = null;

		try {
			const result = await recoverMyAccount();

			if (!result.ok) {
				// Window lapsed: the satellite hard-deleted the account in
				// place. Show the expired panel, then drop auth to a clean
				// signed-out state: there is nothing left to come back to.
				expired = true;
				inFlight = false;
				setAuthBusy(true);
				await signOut();

				return;
			}

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'account.return.deleted_toast_title' }),
				message: t({ locale: $localeStore, key: 'account.return.deleted_toast_body' }),
				type: 'success'
			});

			// Clear the marker so the gate dismisses and the app is usable.
			userStore.update((s) =>
				isNullish(s.profile) ? s : { ...s, profile: { ...s.profile, deletedAtMs: undefined } }
			);
			inFlight = false;
		} catch (_err: unknown) {
			errorKey = 'account.return.error';
			inFlight = false;
		}
	};

	const runResume = async () => {
		if (inFlight) {
			return;
		}

		inFlight = true;
		errorKey = null;

		try {
			const result = await resumeMyAccount();

			if (!result.ok) {
				errorKey = 'account.return.error';
				inFlight = false;

				return;
			}

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'account.return.hibernated_toast_title' }),
				message: t({ locale: $localeStore, key: 'account.return.hibernated_toast_body' }),
				type: 'success'
			});

			userStore.update((s) =>
				isNullish(s.profile) ? s : { ...s, profile: { ...s.profile, hibernatedAtMs: undefined } }
			);
			inFlight = false;
		} catch (_err: unknown) {
			errorKey = 'account.return.error';
			inFlight = false;
		}
	};
</script>

{#if nonNullish(mode)}
	<div class="gate-scrim" role="presentation">
		<div class="gate" aria-modal="true" role="dialog" tabindex="-1">
			{#if expired}
				<h2 class="gate-title">
					{t({ locale: $localeStore, key: 'account.return.expired_heading' })}
				</h2>
				<p class="gate-body">{t({ locale: $localeStore, key: 'account.return.expired_body' })}</p>
				<div class="gate-actions gate-actions-single">
					<Button onclick={doSignOut} status={recoverStatus} variant="primary">
						{t({ locale: $localeStore, key: 'account.return.expired_continue' })}
					</Button>
				</div>
			{:else if mode === 'deleted'}
				<h2 class="gate-title">
					{t({ locale: $localeStore, key: 'account.return.deleted_heading' })}
				</h2>
				<p class="gate-body">{t({ locale: $localeStore, key: 'account.return.deleted_body' })}</p>
				<p class="gate-window num">
					{t({
						locale: $localeStore,
						key:
							daysLeft === 1
								? 'account.return.deleted_window_one'
								: 'account.return.deleted_window_other',
						params: { days: daysLeft }
					})}
				</p>

				{#if nonNullish(errorKey)}
					<p class="gate-error" role="alert">
						{t({ locale: $localeStore, key: errorKey })}
					</p>
				{/if}

				<div class="gate-actions">
					<Button onclick={doSignOut} status={inFlight ? 'disabled' : 'enabled'} variant="ghost">
						{t({ locale: $localeStore, key: 'account.return.sign_out' })}
					</Button>
					<Button onclick={runRecover} status={recoverStatus} variant="primary">
						{#if inFlight}
							<Loader2 class="gate-spin" aria-hidden="true" size={16} strokeWidth={1.8} />
							{t({ locale: $localeStore, key: 'account.return.working' })}
						{:else}
							{t({ locale: $localeStore, key: 'account.return.recover' })}
						{/if}
					</Button>
				</div>
			{:else}
				<h2 class="gate-title">
					{t({ locale: $localeStore, key: 'account.return.hibernated_heading' })}
				</h2>
				<p class="gate-body">
					{t({ locale: $localeStore, key: 'account.return.hibernated_body' })}
				</p>

				{#if nonNullish(errorKey)}
					<p class="gate-error" role="alert">
						{t({ locale: $localeStore, key: errorKey })}
					</p>
				{/if}

				<div class="gate-actions">
					<Button onclick={doSignOut} status={inFlight ? 'disabled' : 'enabled'} variant="ghost">
						{t({ locale: $localeStore, key: 'account.return.stay_paused' })}
					</Button>
					<Button onclick={runResume} status={recoverStatus} variant="primary">
						{#if inFlight}
							<Loader2 class="gate-spin" aria-hidden="true" size={16} strokeWidth={1.8} />
							{t({ locale: $localeStore, key: 'account.return.working' })}
						{:else}
							{t({ locale: $localeStore, key: 'account.return.resume' })}
						{/if}
					</Button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style lang="postcss">
	/* Full-viewport blocking scrim. Unlike `BottomSheet` / `Modal` there
	   is no backdrop-click or Escape close: the gate can only be left by
	   recovering / resuming the account or signing out. */
	.gate-scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 1.1rem;
		background: rgba(14, 13, 11, 0.78);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		animation: gate-fade-in var(--d-state) ease-out both;
	}

	.gate {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		width: 100%;
		max-width: 28rem;
		padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px));
		background: var(--bg-popover);
		border: 1px solid var(--border-base);
		border-radius: 22px;
		box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.4);
		animation: gate-rise 280ms var(--ease-vici) both;
	}

	@media (prefers-reduced-motion: reduce) {
		.gate-scrim,
		.gate {
			animation: none;
		}
	}

	.gate-title {
		margin: 0;
		font-family: var(--font-serif, serif);
		font-size: var(--t-24);
		font-style: italic;
		font-weight: 600;
		letter-spacing: var(--tracking-snug);
		color: var(--text-base);
	}

	.gate-body {
		margin: 0;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.gate-window {
		margin: 0;
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--danger);
	}

	.gate-error {
		margin: 0;
		font-size: var(--t-12);
		color: var(--danger);
	}

	.gate-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.15rem;
	}

	.gate-actions :global(button) {
		flex: 1;
	}

	.gate-actions-single {
		width: 100%;
	}

	:global(.gate-spin) {
		animation: gate-spin 0.8s linear infinite;
	}

	@keyframes gate-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes gate-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes gate-rise {
		from {
			transform: translateY(16px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.gate-spin) {
			animation: none;
		}
	}
</style>
