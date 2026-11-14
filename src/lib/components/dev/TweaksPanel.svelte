<script lang="ts">
	import { Wrench, X } from '@lucide/svelte/icons';
	import AppearancePicker from '#lib/components/ui/AppearancePicker.svelte';
	import { AppPath, PublicPath } from '#lib/constants/routes.constants.ts';
	import { LEADERBOARD_QUALIFY_MIN } from '#lib/constants/standings.constants.ts';
	import { userSignedIn } from '#lib/derived/user.derived.ts';
	import { worldCupActive, worldCupMode } from '#lib/derived/world-cup.derived.ts';
	import { isDev } from '#lib/env/app.env.ts';
	import { signOut } from '#lib/services/identity.services.ts';
	import { preferencesStore } from '#lib/stores/preferences.store.ts';
	import { leaderboardQualifyMin } from '#lib/stores/tweaks.store.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// Dev knob bounds for the leaderboard qualify gate: 0 disables the gate
	// (everyone ranked), 30 is a deliberately strict ceiling for feeling out
	// the threshold.
	const QUALIFY_MIN_FLOOR = 0;
	const QUALIFY_MIN_CEIL = 30;

	const enabled = isDev();

	const toggleWorldCupMode = () => {
		preferencesStore.update((prefs) => ({ ...prefs, worldCupMode: !prefs.worldCupMode }));
	};

	let open = $state(false);

	const jumpTo = async (href: string) => {
		open = false;
		await goto(href);
	};

	const handleSignOut = async () => {
		open = false;

		try {
			await signOut();
		} catch {
			// Already signed out / network glitch: push to /signin
			// regardless so the panel doesn't get stuck.
		}

		await goto(resolve(PublicPath.SignIn), { replace: true });
	};
</script>

{#if enabled}
	<div class="tweaks-root" class:is-open={open}>
		<button
			class="tweaks-fab"
			aria-label="Open dev tweaks panel"
			onclick={() => (open = !open)}
			type="button"
		>
			{#if open}
				<X size={18} strokeWidth={2} />
			{:else}
				<Wrench size={18} strokeWidth={2} />
			{/if}
		</button>

		{#if open}
			<aside class="tweaks-panel" aria-label="Dev tweaks">
				<header class="tweaks-head">
					<span class="allcaps">Tweaks · DEV</span>
				</header>

				<section class="tweaks-section">
					<span class="allcaps tweaks-label">Appearance</span>
					<AppearancePicker />
				</section>

				<section class="tweaks-section">
					<span class="allcaps tweaks-label">World Cup mode</span>
					<button
						class="tweaks-toggle"
						class:is-on={$worldCupMode}
						aria-pressed={$worldCupMode}
						onclick={toggleWorldCupMode}
						type="button"
					>
						<span>worldCupMode</span>
						<span class="tweaks-toggle-state">{$worldCupMode ? 'ON' : 'OFF'}</span>
					</button>
					<span class="tweaks-status">
						Active gate: {$worldCupActive ? 'live' : 'archived/off'}
					</span>
				</section>

				<section class="tweaks-section">
					<label class="allcaps tweaks-label" for="tweaks-lb-qualify">
						Leaderboard qualify (calls)
					</label>
					<input
						id="tweaks-lb-qualify"
						class="tweaks-range"
						max={QUALIFY_MIN_CEIL}
						min={QUALIFY_MIN_FLOOR}
						step="1"
						type="range"
						bind:value={$leaderboardQualifyMin}
					/>
					<span class="tweaks-status">
						Min {$leaderboardQualifyMin} settled to rank (default {LEADERBOARD_QUALIFY_MIN})
					</span>
				</section>

				<section class="tweaks-section">
					<span class="allcaps tweaks-label">Quick jumps</span>
					<div class="tweaks-jumps">
						<button onclick={() => jumpTo(resolveAppPath(AppPath.Home))} type="button"
							>Home (/)</button
						>
						<button onclick={() => jumpTo(resolveAppPath(AppPath.Flow))} type="button">Flow</button>
						<button onclick={() => jumpTo(resolveAppPath(AppPath.Portfolio))} type="button">
							Portfolio
						</button>
						<button onclick={() => jumpTo(resolveAppPath(AppPath.Profile))} type="button"
							>Profile</button
						>
						<button onclick={() => jumpTo(resolve(PublicPath.SignIn))} type="button">Sign in</button
						>
						<button onclick={() => jumpTo(resolve(PublicPath.SignUp))} type="button">Sign up</button
						>
					</div>
				</section>

				<section class="tweaks-section">
					<span class="allcaps tweaks-label">Session</span>
					<div class="tweaks-jumps">
						{#if $userSignedIn}
							<button class="tweaks-danger" onclick={handleSignOut} type="button">
								Sign out
							</button>
						{:else}
							<span class="tweaks-status">Signed out</span>
						{/if}
					</div>
				</section>

				<p class="tweaks-foot">
					Dev-only panel. User-facing settings follow in the Settings phase.
				</p>
			</aside>
		{/if}
	</div>
{/if}

<style lang="postcss">
	.tweaks-root {
		position: fixed;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
		right: 1rem;
		z-index: 80;
		display: flex;
		flex-direction: column-reverse;
		align-items: flex-end;
		gap: 0.5rem;
		pointer-events: none;
	}

	.tweaks-fab,
	.tweaks-panel {
		pointer-events: auto;
	}

	.tweaks-fab {
		width: 36px;
		height: 36px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-popover);
		border: 1px solid var(--border-strong);
		border-radius: var(--r-pill);
		color: var(--text-muted);
		box-shadow: var(--shadow-toast);
		cursor: pointer;
		transition:
			color var(--d-hover) var(--ease-vici),
			transform var(--d-hover) var(--ease-vici),
			border-color var(--d-hover) var(--ease-vici);
	}

	.tweaks-fab:hover {
		color: var(--laurel);
		border-color: var(--laurel);
	}

	.tweaks-root.is-open .tweaks-fab {
		color: var(--laurel);
		border-color: var(--laurel);
	}

	.tweaks-panel {
		width: 16rem;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 0.875rem 1rem;
		background: var(--bg-popover);
		border: 1px solid var(--border-strong);
		border-radius: var(--r-12);
		box-shadow: var(--inset-hi), var(--shadow-modal);
		font-size: var(--t-13);
	}

	.tweaks-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-base);
		color: var(--laurel);
		font-size: var(--t-12);
	}

	.tweaks-section {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.tweaks-label {
		font-size: var(--t-10);
		color: var(--text-muted);
	}

	.tweaks-jumps {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
	}

	.tweaks-jumps button {
		font: inherit;
		padding: 0.4rem 0.5rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-4);
		color: var(--text-base);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--d-hover) var(--ease-vici);
	}

	.tweaks-jumps button:hover {
		background: var(--bg-elevated);
	}

	.tweaks-jumps .tweaks-danger {
		color: var(--no);
		border-color: rgba(255, 107, 107, 0.3);
	}

	.tweaks-jumps .tweaks-danger:hover {
		background: var(--no-wash);
	}

	.tweaks-status {
		font-size: var(--t-12);
		color: var(--text-muted);
	}

	.tweaks-range {
		width: 100%;
		accent-color: var(--laurel);
		cursor: pointer;
	}

	.tweaks-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font: inherit;
		padding: 0.4rem 0.5rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-4);
		color: var(--text-base);
		cursor: pointer;
		transition:
			border-color var(--d-hover) var(--ease-vici),
			background-color var(--d-hover) var(--ease-vici);
	}

	.tweaks-toggle:hover {
		background: var(--bg-elevated);
	}

	.tweaks-toggle.is-on {
		border-color: var(--laurel);
		color: var(--laurel);
	}

	.tweaks-toggle-state {
		font-size: var(--t-11);
		font-weight: 600;
	}

	.tweaks-foot {
		margin: 0;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-base);
		font-size: var(--t-11);
		color: var(--parchment-faint);
		font-family: var(--font-display);
	}
</style>
