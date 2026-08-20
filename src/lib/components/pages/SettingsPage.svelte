<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { getDoc } from '@junobuild/core';
	import {
		Bell,
		ChevronLeft,
		ChevronRight,
		Cookie,
		Eye,
		Globe,
		Info,
		Key,
		Languages,
		LineChart,
		Lock,
		Mail,
		Moon,
		Rocket,
		Scale,
		Search,
		Share2,
		Smartphone,
		Sun,
		Target,
		Trophy,
		Users,
		Volume2
	} from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import A2hsSheet from '$lib/components/pwa/A2hsSheet.svelte';
	import DeleteAccountFlow from '$lib/components/settings/DeleteAccountFlow.svelte';
	import SetRow from '$lib/components/settings/SetRow.svelte';
	import SetSegmented from '$lib/components/settings/SetSegmented.svelte';
	import SetToggle from '$lib/components/settings/SetToggle.svelte';
	import SettingsIdentityCard from '$lib/components/settings/SettingsIdentityCard.svelte';
	import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
	import AppearancePicker from '$lib/components/ui/AppearancePicker.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import LocaleSheet from '$lib/components/ui/LocaleSheet.svelte';
	import { Collection } from '$lib/constants/collections.constants';
	import { LOCALE_REGISTRY } from '$lib/constants/locale.constants';
	import { AppPath, PublicPath } from '$lib/constants/routes.constants';
	import { TestId } from '$lib/constants/test-ids.constants';
	import { authPrincipal } from '$lib/derived/user.derived';
	import { flushEvents, track } from '$lib/services/analytics.services';
	import { isClaimHandoffAvailable, startClaimHandoff } from '$lib/services/claim-handoff.services';
	// The dual-mode sign-out: the Juno delegation drop on the default
	// backend, the cookie-session revoke in web2 mode.
	import { signOut } from '$lib/services/identity.services';
	import { persistPreferences } from '$lib/services/profile.services';
	import { canInstall } from '$lib/stores/a2hs.store';
	import { localeStore, setLocale } from '$lib/stores/locale.store';
	import { marketLanguagePreference } from '$lib/stores/market-language.store';
	import { preferencesStore } from '$lib/stores/preferences.store';
	import { theme } from '$lib/stores/theme.store';
	import { setAuthBusy, userStore } from '$lib/stores/user.store';
	import type { ButtonStatus } from '$lib/types/components';
	import type { SettingsVisibility } from '$lib/types/preferences';
	import type { UserProfile } from '$lib/types/profile';
	import { t } from '$lib/utils/i18n.utils';
	import { goBack } from '$lib/utils/nav.utils';
	import { resolveSignInMethod } from '$lib/utils/signin-method.utils';
	import { visibilityToProfile } from '$lib/utils/visibility.utils';

	// Delete-account flow — the six-beat flow lives in
	// `DeleteAccountFlow`; this page only owns the open/close toggle.
	let deleteSheetOpen = $state(false);

	// Language picker — the two-axis (Language ▸ Region) picker lives in
	// `LocaleSheet`; the row below opens it and reflects the active locale.
	// Resolved against the full registry so a regional edition (e.g. `pt-BR`)
	// shows its own native label and short code, not just the live base set.
	let langSheetOpen = $state(false);

	// Install sheet — the Add-to-Home-Screen flow lives in `A2hsSheet`; this
	// row only owns the open toggle and is gated on `$canInstall`.
	let a2hsSheetOpen = $state(false);

	const activeLocale = $derived(
		LOCALE_REGISTRY.find((locale) => locale.id === $localeStore) ?? LOCALE_REGISTRY[0]
	);

	let signOutStatus = $state<ButtonStatus>('enabled');
	let confirmingSignOut = $state(false);

	// Account-claim handoff: a legacy-build-only row that signs the claim
	// payload and opens the claim portal on the new stack in a new tab.
	const claimAvailable = isClaimHandoffAvailable();
	let claimBusy = $state(false);

	const onStartClaim = async () => {
		if (claimBusy) {
			return;
		}

		claimBusy = true;

		try {
			const opened = await startClaimHandoff();

			if (!opened) {
				flashToast(t({ locale: $localeStore, key: 'claim.handoff.error' }));
			}
		} finally {
			claimBusy = false;
		}
	};

	// Local transient toast pill. Kept page-local instead of routing
	// through `notificationsStore` because the surface wants a compact
	// pill pinned to the bottom of the page, not a full-stack
	// notification.
	let toastMessage = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	const flashToast = (message: string) => {
		if (toastTimer) {
			clearTimeout(toastTimer);
		}

		toastMessage = message;
		toastTimer = setTimeout(() => {
			toastMessage = null;
		}, 1800);
	};

	// Joined date — sourced from the Juno profile doc's `created_at` (ns).
	// Mirrors the `ProfilePage` loader so the identity row's "Joined …"
	// line stays in sync with the dashboard's joined chip.
	let joinedAtNs = $state<bigint | undefined>(undefined);

	const loadJoinedAt = async (principal: string) => {
		try {
			const doc = await getDoc<UserProfile>({
				collection: Collection.PROFILES,
				key: principal
			});

			joinedAtNs = doc?.created_at;
		} catch {
			joinedAtNs = undefined;
		}
	};

	const joinedLabel = $derived.by(() => {
		if (isNullish(joinedAtNs)) {
			return null;
		}

		const ms = Number(joinedAtNs / 1_000_000n);
		const date = new Date(ms);

		try {
			const formatter = new Intl.DateTimeFormat($localeStore, {
				month: 'long',
				year: 'numeric'
			});

			return formatter.format(date);
		} catch {
			return date.toISOString().slice(0, 7);
		}
	});

	const profile = $derived($userStore.profile);
	const nickname = $derived(profile?.nickname ?? '');
	// The address lives on the owner-private `profile_private` doc (hydrated
	// into the store at sign-in), never on the public profile.
	const email = $derived($userStore.email);
	const hasEmail = $derived(email.length > 0);

	// Sign-in method sub — derived from the provider Juno records on the
	// `#user` doc (refined by whether an email is on file), so Google /
	// Passkey accounts surface their own label instead of collapsing into
	// the old email-vs-II heuristic. Email-backed accounts show the address.
	const signinMethod = $derived(resolveSignInMethod({ user: $userStore.user, hasEmail }));
	const signinMethodSub = $derived.by(() => {
		switch (signinMethod) {
			case 'email':
				return t({
					locale: $localeStore,
					key: 'settings.account.signin_method.email',
					params: { email }
				});
			case 'google':
				return t({ locale: $localeStore, key: 'settings.account.signin_method.google' });
			case 'passkey':
				return t({ locale: $localeStore, key: 'settings.account.signin_method.passkey' });
			default:
				return t({ locale: $localeStore, key: 'settings.account.signin_method.ii' });
		}
	});

	// Email row sub — just the address; the "verified" affordance is
	// rendered as a separate green badge.
	const emailSub = $derived(
		hasEmail ? email : t({ locale: $localeStore, key: 'settings.account.email.empty' })
	);

	const notifyOnCount = $derived(Object.values($preferencesStore.notify).filter(Boolean).length);
	const notifyTotalCount = $derived(Object.values($preferencesStore.notify).length);
	const visibilityOptions = $derived([
		{
			value: 'public',
			label: t({ locale: $localeStore, key: 'settings.profile_visibility.public' })
		},
		{
			value: 'friends',
			label: t({ locale: $localeStore, key: 'settings.profile_visibility.friends' })
		},
		{
			value: 'private',
			label: t({ locale: $localeStore, key: 'settings.profile_visibility.private' })
		}
	]);

	const settingsVisibility = $derived($preferencesStore.sharing.profileVisibility);

	const themeLabel = $derived($theme.charAt(0).toUpperCase() + $theme.slice(1));

	// About line — `VICI · v{version} · Build {sha}`. Both values are
	// injected at build time via vite `define` (see `vite.config.ts`),
	// so the line surfaces the actual shipped artefact and not a
	// hard-coded literal.
	const aboutLine = $derived(
		t({
			locale: $localeStore,
			key: 'settings.about',
			params: { version: __APP_VERSION__, build: __BUILD_SHA__ }
		})
	);

	// Profile-visibility write. The settings-grouped source of truth is
	// `preferences.sharing.profileVisibility`; the top-level
	// `profile.visibility` enum is mirrored on every write because that is
	// the field the satellite wire format reads for leaderboard / search
	// filtering. Both go through the serialized patch queue
	// (`persistPreferences`) as a leaf-level `sharing` patch so this can't
	// revert a sibling preference (e.g. the onboarding-picked favourite
	// team) written concurrently to the same doc.
	const persistVisibility = async (value: SettingsVisibility) => {
		const principal = $authPrincipal;

		if (!principal || !profile) {
			return;
		}

		userStore.update((s) =>
			nonNullish(s.profile)
				? {
						...s,
						profile: {
							...s.profile,
							visibility: visibilityToProfile(value),
							preferences: {
								...s.profile.preferences,
								sharing: { ...s.profile.preferences.sharing, profileVisibility: value }
							}
						}
					}
				: s
		);

		await persistPreferences({
			principal,
			preferences: { sharing: { ...profile.preferences.sharing, profileVisibility: value } },
			visibility: visibilityToProfile(value)
		});
	};

	const doSignOut = async () => {
		signOutStatus = 'pending';

		// Emit + flush BEFORE the auth drop: `flushEvents` is fire-and-forget
		// (it never blocks or fails the sign-out), but starting it while the
		// session is still live lets the satellite stitch the principal onto
		// the event — after `signOut()` the batch would land anonymous.
		track({ name: 'signed_out', source: 'settings' });
		void flushEvents();

		try {
			await dropAuth();
		} catch {
			// Sign-out failed before the session changed. `dropAuth` set the
			// global `authBusy` flag and only `onAuthStateChange` clears it —
			// which won't fire now — so clear it here, otherwise the (app)
			// shell stays stuck on its `authResolving` loader instead of the
			// restored confirm controls. Then re-enable so the user can retry.
			setAuthBusy(false);
			signOutStatus = 'enabled';
			confirmingSignOut = false;

			return;
		}

		// Auth is dropped. Drive the redirect from here instead of waiting for
		// the (app) layout's auth-gate effect to react and paint the shell's
		// hydration spinner first, which reads as a sluggish sign-out. The
		// button stays `pending` through the navigation — this component
		// unmounts on the route change, so the spinner never flickers back to
		// the idle label. Deliberately outside the try: a `goto` abort (a
		// concurrent redirect already taking us away) is not a sign-out failure
		// and must not re-enable the controls.
		await goto(resolve(PublicPath.SignIn), { replaceState: true });
	};

	/**
	 * Drop auth so the user lands on the sign-in screen. Reused both by
	 * the in-page sign-out confirm and as the `DeleteAccountFlow`'s
	 * sign-out hook (after a successful delete or a 30-day pause).
	 * `signOut()` clears local stores; `setAuthBusy` keeps the global
	 * busy flag set while it does.
	 */
	const dropAuth = async () => {
		setAuthBusy(true);
		await signOut();
	};

	onMount(() => {
		if ($authPrincipal) {
			void loadJoinedAt($authPrincipal);
		}

		const onKey = (event: KeyboardEvent) => {
			// Open sheets own Escape while visible (they close themselves,
			// not the page); don't navigate away underneath them.
			if (event.key === 'Escape' && !deleteSheetOpen && !langSheetOpen && !a2hsSheetOpen) {
				void goto(resolve(AppPath.Profile));
			}
		};

		window.addEventListener('keydown', onKey);

		return () => {
			window.removeEventListener('keydown', onKey);

			if (toastTimer) {
				clearTimeout(toastTimer);
			}
		};
	});
</script>

<div class="settings-page">
	<header class="settings-appbar">
		<button
			class="appbar-icon-btn"
			aria-label={t({ locale: $localeStore, key: 'settings.back_profile' })}
			onclick={() => goBack(resolve(AppPath.Profile))}
			type="button"
		>
			<ChevronLeft aria-hidden="true" size={18} strokeWidth={1.6} />
		</button>
		<h1 class="settings-appbar-title">
			{t({ locale: $localeStore, key: 'settings.title' })}
		</h1>
		<span class="settings-appbar-spacer" aria-hidden="true"></span>
	</header>

	<div class="settings-body">
		<SettingsSection title={t({ locale: $localeStore, key: 'settings.account' })}>
			<SettingsIdentityCard {joinedLabel} {profile} />

			<SetRow
				icon={Key}
				label={t({ locale: $localeStore, key: 'settings.account.signin_method' })}
				onclick={() => goto(resolve(AppPath.AccountSettings))}
				sub={signinMethodSub}
			/>

			<SetRow
				icon={Mail}
				label={t({ locale: $localeStore, key: 'settings.account.email' })}
				onclick={() => goto(resolve(AppPath.AccountSettings))}
				sub={emailSub}
			>
				{#snippet right()}
					{#if hasEmail}
						<span class="settings-verified-pill">
							{t({ locale: $localeStore, key: 'settings.account.email.verified' })}
						</span>
					{/if}
				{/snippet}
			</SetRow>

			{#if claimAvailable}
				<SetRow
					icon={Rocket}
					label={t({ locale: $localeStore, key: 'claim.settings.label' })}
					onclick={onStartClaim}
					sub={t({ locale: $localeStore, key: 'claim.settings.sub' })}
				/>
			{/if}
		</SettingsSection>

		<SettingsSection title={t({ locale: $localeStore, key: 'settings.preferences' })}>
			<div class="settings-appearance">
				<div class="settings-appearance-head">
					<span class="settings-appearance-icon" aria-hidden="true">
						{#if $theme === 'dark'}
							<Moon size={16} strokeWidth={1.8} />
						{:else}
							<Sun size={16} strokeWidth={1.8} />
						{/if}
					</span>
					<div class="settings-appearance-titles">
						<p class="settings-appearance-label">
							{t({ locale: $localeStore, key: 'settings.appearance' })}
						</p>
						<p class="settings-appearance-current">{themeLabel}</p>
					</div>
				</div>
				<AppearancePicker variant="tiles" />
			</div>

			<SetRow
				icon={Bell}
				label={t({ locale: $localeStore, key: 'settings.notifications' })}
				onclick={() => goto(resolve(AppPath.Notifications))}
				sub={t({
					locale: $localeStore,
					key: 'settings.notifications.sub',
					params: { count: notifyOnCount, total: notifyTotalCount }
				})}
			/>

			<SetRow
				icon={Globe}
				label={t({ locale: $localeStore, key: 'settings.language' })}
				onclick={() => (langSheetOpen = true)}
				sub={activeLocale.label}
			>
				{#snippet right()}
					<span class="settings-lang-right">
						<span class="settings-lang-short num">{activeLocale.short}</span>
						<ChevronRight aria-hidden="true" size={16} strokeWidth={1.6} />
					</span>
				{/snippet}
			</SetRow>

			<SetToggle
				checked={$marketLanguagePreference === 'translated'}
				icon={Languages}
				label={t({ locale: $localeStore, key: 'settings.market_language' })}
				onchange={(value) => marketLanguagePreference.set(value ? 'translated' : 'original')}
				sub={t({ locale: $localeStore, key: 'settings.market_language.sub' })}
			/>

			<SetToggle
				checked={$preferencesStore.hapticsEnabled}
				icon={Target}
				label={t({ locale: $localeStore, key: 'settings.haptics' })}
				onchange={(value) => {
					preferencesStore.update((prefs) => ({ ...prefs, hapticsEnabled: value }));
				}}
				sub={t({ locale: $localeStore, key: 'settings.haptics.sub' })}
			/>

			<SetToggle
				checked={$preferencesStore.soundEnabled}
				icon={Volume2}
				label={t({ locale: $localeStore, key: 'settings.sound' })}
				onchange={(value) => {
					preferencesStore.update((prefs) => ({ ...prefs, soundEnabled: value }));
				}}
				sub={t({ locale: $localeStore, key: 'settings.sound.sub' })}
			/>

			{#if $canInstall}
				<SetRow
					icon={Smartphone}
					label={t({ locale: $localeStore, key: 'settings.add_home' })}
					onclick={() => (a2hsSheetOpen = true)}
					sub={t({ locale: $localeStore, key: 'settings.add_home.sub' })}
				/>
			{/if}
		</SettingsSection>

		<SettingsSection title={t({ locale: $localeStore, key: 'settings.privacy' })}>
			<SetToggle
				checked={false}
				disabled={true}
				icon={Lock}
				label={t({ locale: $localeStore, key: 'settings.two_factor' })}
				onchange={() => {}}
				sub={t({ locale: $localeStore, key: 'settings.two_factor.sub' })}
			/>

			<SetSegmented
				icon={Eye}
				label={t({ locale: $localeStore, key: 'settings.profile_visibility' })}
				onchange={(value) => {
					void persistVisibility(value as SettingsVisibility);
				}}
				options={visibilityOptions}
				sub={t({ locale: $localeStore, key: 'settings.profile_visibility.sub' })}
				value={settingsVisibility}
			/>

			<SetToggle
				checked={$preferencesStore.sharing.callsPublic}
				icon={LineChart}
				label={t({ locale: $localeStore, key: 'settings.public_calls' })}
				onchange={(value) => {
					preferencesStore.update((prefs) => ({
						...prefs,
						sharing: { ...prefs.sharing, callsPublic: value }
					}));
				}}
				sub={t({ locale: $localeStore, key: 'settings.public_calls.sub' })}
			/>
		</SettingsSection>

		<!--
			Secondary "Privacy" card — the two opt-out share toggles
			(global leaderboard, Worlds Universities) distinct from the
			privacy-and-security set above. Both persist through the
			`preferences.sharing` slice and are enforced: leaderboard via
			the FE standings filter, Worlds via the affiliation-stats hook.
		-->
		<SettingsSection title={t({ locale: $localeStore, key: 'settings.privacy_share' })}>
			<SetToggle
				checked={$preferencesStore.sharing.leaderboardOptIn}
				icon={Users}
				label={t({ locale: $localeStore, key: 'settings.privacy_share.global' })}
				onchange={(value) => {
					preferencesStore.update((prefs) => ({
						...prefs,
						sharing: { ...prefs.sharing, leaderboardOptIn: value }
					}));
					track({
						name: 'privacy_sharing_toggled',
						source: 'leaderboard',
						label: value ? 'on' : 'off'
					});
				}}
				sub={t({ locale: $localeStore, key: 'settings.privacy_share.global.sub' })}
			/>

			<SetToggle
				checked={$preferencesStore.sharing.worldsOptIn}
				icon={Trophy}
				label={t({ locale: $localeStore, key: 'settings.privacy_share.worlds' })}
				onchange={(value) => {
					preferencesStore.update((prefs) => ({
						...prefs,
						sharing: { ...prefs.sharing, worldsOptIn: value }
					}));
					track({ name: 'privacy_sharing_toggled', source: 'worlds', label: value ? 'on' : 'off' });
				}}
				sub={t({ locale: $localeStore, key: 'settings.privacy_share.worlds.sub' })}
			/>
		</SettingsSection>

		<SettingsSection title={t({ locale: $localeStore, key: 'settings.data' })}>
			<SetRow
				icon={Share2}
				label={t({ locale: $localeStore, key: 'settings.data.export' })}
				muted
				onclick={() => flashToast(t({ locale: $localeStore, key: 'settings.toast.export_coming' }))}
				sub={t({ locale: $localeStore, key: 'settings.data.export.sub' })}
			/>
			<SetRow
				icon={Trophy}
				label={t({ locale: $localeStore, key: 'settings.data.album' })}
				muted
				onclick={() =>
					flashToast(t({ locale: $localeStore, key: 'settings.toast.download_coming' }))}
				sub={t({ locale: $localeStore, key: 'settings.data.album.sub' })}
			/>
		</SettingsSection>

		<SettingsSection title={t({ locale: $localeStore, key: 'settings.help' })}>
			<SetRow
				icon={Info}
				label={t({ locale: $localeStore, key: 'settings.help.resolution' })}
				onclick={() => goto(resolve(`${PublicPath.Info}/how-resolution-works`))}
			/>
			<SetRow
				icon={Search}
				label={t({ locale: $localeStore, key: 'settings.help.faq' })}
				onclick={() => goto(resolve(`${PublicPath.Info}/faq`))}
			/>
			<SetRow
				icon={Share2}
				label={t({ locale: $localeStore, key: 'settings.help.support' })}
				onclick={() => goto(resolve(`${PublicPath.Info}/contact`))}
			/>
		</SettingsSection>

		<SettingsSection title={t({ locale: $localeStore, key: 'settings.legal' })}>
			<SetRow
				icon={Lock}
				label={t({ locale: $localeStore, key: 'settings.legal.terms' })}
				onclick={() => goto(resolve(`${PublicPath.Info}/terms`))}
			/>
			<SetRow
				icon={Eye}
				label={t({ locale: $localeStore, key: 'settings.legal.privacy' })}
				onclick={() => goto(resolve(`${PublicPath.Info}/privacy`))}
			/>
			<SetRow
				icon={Globe}
				label={t({ locale: $localeStore, key: 'settings.legal.aviso' })}
				onclick={() => goto(resolve(`${PublicPath.Info}/aviso`))}
			/>
			<SetRow
				icon={Globe}
				label={t({ locale: $localeStore, key: 'settings.legal.aviso_br' })}
				onclick={() => goto(resolve(`${PublicPath.Info}/aviso-br`))}
			/>
			<SetRow
				icon={Cookie}
				label={t({ locale: $localeStore, key: 'settings.legal.cookies' })}
				onclick={() => goto(resolve(`${PublicPath.Info}/cookies`))}
			/>
			<SetRow
				icon={Info}
				label={t({ locale: $localeStore, key: 'settings.legal.rules' })}
				onclick={() => goto(resolve(`${PublicPath.Info}/resolution-rules`))}
			/>
			<SetRow
				icon={Scale}
				label={t({ locale: $localeStore, key: 'settings.legal.imprint' })}
				onclick={() => goto(resolve(`${PublicPath.Info}/imprint`))}
			/>
		</SettingsSection>

		<p class="settings-about num">{aboutLine}</p>

		<div class="settings-destructive">
			{#if !confirmingSignOut}
				<Button
					class="settings-signout"
					data-tid={TestId.SignOutButton}
					onclick={() => (confirmingSignOut = true)}
					variant="ghost"
				>
					{t({ locale: $localeStore, key: 'settings.sign_out' })}
				</Button>
			{:else}
				<div class="settings-confirm settings-signout-confirm">
					<p>{t({ locale: $localeStore, key: 'settings.sign_out.confirm' })}</p>
					<div class="settings-confirm-actions">
						<Button onclick={() => (confirmingSignOut = false)} variant="ghost">
							{t({ locale: $localeStore, key: 'settings.sign_out.cancel' })}
						</Button>
						<Button
							data-tid={TestId.Logout}
							onclick={doSignOut}
							status={signOutStatus}
							variant="primary"
						>
							{t({ locale: $localeStore, key: 'settings.sign_out' })}
						</Button>
					</div>
				</div>
			{/if}

			<button class="settings-delete-link" onclick={() => (deleteSheetOpen = true)} type="button">
				{t({ locale: $localeStore, key: 'settings.delete' })}
			</button>
		</div>
	</div>

	<DeleteAccountFlow
		isOpen={deleteSheetOpen}
		{nickname}
		onClose={() => (deleteSheetOpen = false)}
		onSignOut={dropAuth}
	/>

	<LocaleSheet
		current={$localeStore}
		isOpen={langSheetOpen}
		onClose={() => (langSheetOpen = false)}
		onPick={(locale) => {
			setLocale(locale);
			langSheetOpen = false;
		}}
	/>

	<A2hsSheet isOpen={a2hsSheetOpen} onClose={() => (a2hsSheetOpen = false)} source="settings" />

	{#if nonNullish(toastMessage)}
		<!--
			Pill-shaped transient toast pinned to the bottom of the page.
			Local to this surface — used for low-stakes confirmations
			(Saved / coming soon) that don't warrant a global
			notification entry.
		-->
		<div class="settings-toast t-eyebrow" aria-live="polite" role="status">
			{toastMessage}
		</div>
	{/if}
</div>

<style lang="postcss">
	.settings-page {
		padding: 0 1.25rem 6rem;
	}

	.settings-appbar {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.5rem;
		padding: 1.25rem 0 1rem;
	}

	.settings-appbar-title {
		min-width: 0;
		margin: 0;
		font-size: var(--t-20);
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: var(--tracking-snug);
		color: var(--text-base);
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.settings-appbar-spacer {
		width: 2.5rem;
	}

	/* Verified email pill — small green badge rendered in the SetRow
	   `right` snippet. Uses YES (green) tokens to read as a positive
	   verification affordance, distinct from the laurel-gold default
	   badge slot. */
	.settings-verified-pill {
		flex-shrink: 0;
		padding: 0.125rem 0.5rem;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--yes) 14%, transparent);
		color: var(--yes);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}

	/* Language row trailing affordance — the active locale's short code
	   (mono, muted) sitting beside the chevron, mirroring the row's
	   `right` slot. */
	.settings-lang-right {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-muted);
	}

	.settings-lang-short {
		font-size: var(--t-11);
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	.settings-body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.settings-appearance {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 0.875rem;
		background: var(--bg-surface);
	}

	.settings-appearance-head {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}

	.settings-appearance-icon {
		display: inline-flex;
		width: 1.85rem;
		height: 1.85rem;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		border-radius: var(--r-8);
		background: var(--laurel-glow);
		color: var(--color-primary);
	}

	.settings-appearance-titles {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.1rem;
	}

	.settings-appearance-label {
		margin: 0;
		color: var(--text-base);
		font-size: var(--t-14);
		font-weight: 700;
	}

	.settings-appearance-current {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--t-12);
	}

	.settings-about {
		margin: 0.25rem 0 0;
		font-size: var(--t-10);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-align: center;
		color: var(--text-muted);
	}

	.settings-destructive {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	/* Sign-out as a 12-px rounded rectangle (intentionally NOT a
	   full pill — pairs with the destructive band below). Danger text
	   + danger-tinted border on top of a subtle ghost-button surface;
	   hover lifts the danger wash without flipping to a fully filled
	   destructive button so the action still requires the explicit
	   confirm step beneath it. Uses the terracotta `--danger` role, not
	   the prediction `--no` signal. */
	:global(.settings-signout) {
		width: 100%;
		padding: 14px 20px;
		border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
		border-radius: 12px;
		background: color-mix(in srgb, var(--text-base) 6%, transparent);
		color: var(--danger);
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.005em;
	}

	:global(.settings-signout):hover {
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		border-color: color-mix(in srgb, var(--danger) 45%, transparent);
	}

	.settings-signout-confirm p {
		font-size: var(--t-13);
		color: var(--text-base);
	}

	/* Delete-account link sits one tier below Sign out in the
	   destructive hierarchy: just a muted-grey underlined text link.
	   The colour only flips to the danger tone on hover so the resting
	   state never visually competes with the Sign-out CTA above. */
	.settings-delete-link {
		align-self: center;
		border: none;
		background: none;
		padding: 6px;
		font-size: var(--t-12);
		color: var(--text-muted);
		cursor: pointer;
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--text-muted) 35%, transparent);
		text-underline-offset: 2px;
	}

	.settings-delete-link:hover {
		color: var(--danger);
		text-decoration-color: color-mix(in srgb, var(--danger) 55%, transparent);
	}

	/* The confirm step inherits the destructive visual treatment of the
	   Sign-out CTA it replaces: a danger-tinted box (no neutral surface or
	   card shadow) so the irreversible action reads as such at a glance. */
	.settings-confirm {
		padding: 0.75rem;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		background: color-mix(in srgb, var(--danger) 6%, transparent);
	}

	.settings-confirm p {
		margin: 0 0 0.75rem;
		font-size: var(--t-12);
		color: var(--text-muted);
	}

	.settings-confirm-actions {
		display: flex;
		gap: 0.5rem;
	}

	/* Cancel and confirm share the row 50/50 so neither action is
	   visually privileged over the other. */
	.settings-confirm-actions :global(button) {
		flex: 1;
	}

	.settings-toast {
		position: fixed;
		bottom: calc(7.5rem + env(safe-area-inset-bottom, 0px));
		left: 50%;
		z-index: 80;
		padding: 0.625rem 1rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		background: var(--bg-popover);
		color: var(--text-base);
		font-family: var(--font-mono);
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		font-size: var(--t-10);
		box-shadow: 0 12px 32px -12px rgba(0, 0, 0, 0.5);
		transform: translateX(-50%);
		pointer-events: none;
	}
</style>
