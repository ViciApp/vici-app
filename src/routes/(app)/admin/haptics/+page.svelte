<script lang="ts">
	import Protected from '#lib/components/authn/Protected.svelte';
	import PermissionGuard from '#lib/components/authz/PermissionGuard.svelte';
	import { Permission } from '#lib/enums/permission.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { preferencesStore } from '#lib/stores/preferences.store.ts';
	import {
		ANDROID_BUZZ_FLOOR_MS,
		applyAndroidFloor,
		haptic,
		HAPTIC_PATTERNS,
		isAndroid,
		type HapticPattern
	} from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	const patterns = Object.keys(HAPTIC_PATTERNS) as HapticPattern[];

	// Capability probes. `navigator` is absent during SSR, so guard.
	const supported = $derived(typeof navigator !== 'undefined' && 'vibrate' in navigator);
	const android = $derived(isAndroid());
	const userAgent = $derived(typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a (SSR)');

	const onOff = $derived(
		$preferencesStore.hapticsEnabled
			? t({ locale: $localeStore, key: 'admin.haptics.on' })
			: t({ locale: $localeStore, key: 'admin.haptics.off' })
	);

	let lastFired = $state<string>('—');

	const fmt = (value: number | readonly number[]): string =>
		typeof value === 'number' ? `${value}ms` : `[${value.join(', ')}]`;

	// Raw fire — bypasses the haptic() pipeline (no preference gate, no
	// Android floor) so you can feel exactly what the hardware does with
	// the authored envelope. Returns navigator.vibrate's boolean.
	const fireRaw = ({ value, label }: { value: number | number[]; label: string }): void => {
		if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
			lastFired = `${label} — Vibration API unavailable`;

			return;
		}

		try {
			const ok = navigator.vibrate(value);
			lastFired = `${label} → navigator.vibrate(${fmt(value)}) returned ${ok}`;
		} catch (e) {
			lastFired = `${label} — threw: ${String(e)}`;
		}
	};

	// Pipeline fire — the real path users hit (respects hapticsEnabled +
	// Android floor). If the preference is off, this is a no-op by design.
	const firePipeline = (pattern: HapticPattern): void => {
		haptic(pattern);
		lastFired = `${pattern} via haptic() — pref ${$preferencesStore.hapticsEnabled ? 'on' : 'OFF (no-op)'}`;
	};

	// Svelte coerces a `type="number"` bind to a number, but a cleared
	// field binds `null` — normalize + validate before firing so the
	// tester never hands `navigator.vibrate` a NaN / 0 no-op.
	let customMs = $state<number | null>(200);

	const fireCustom = (): void => {
		const ms = Number(customMs);

		if (!Number.isFinite(ms) || ms <= 0) {
			lastFired = 'custom — enter a positive ms value';

			return;
		}

		fireRaw({ value: ms, label: `custom ${ms}ms` });
	};

	const toggleHaptics = (): void => {
		preferencesStore.update((c) => ({ ...c, hapticsEnabled: !c.hapticsEnabled }));
	};
</script>

<Protected
	description={t({ locale: $localeStore, key: 'authn.admin.sub' })}
	title={t({ locale: $localeStore, key: 'authn.admin.title' })}
>
	<PermissionGuard permission={Permission.VIEW_ADMIN_PANEL}>
		<div class="mx-auto max-w-3xl space-y-8 px-4 py-8">
			<header class="space-y-2">
				<h1 class="font-display text-foreground text-3xl font-semibold tracking-tight">
					{t({ locale: $localeStore, key: 'admin.haptics.title' })}
				</h1>
				<p class="text-muted-foreground text-sm">
					{t({ locale: $localeStore, key: 'admin.haptics.intro' })}
				</p>
			</header>

			<section class="border-border bg-card space-y-2 rounded-2xl border p-5 text-sm">
				<div class="flex items-center justify-between">
					<span class="text-muted-foreground"
						>{t({ locale: $localeStore, key: 'admin.haptics.probe.supported' })}</span
					>
					<span class="font-mono"
						>{supported
							? t({ locale: $localeStore, key: 'admin.haptics.yes' })
							: t({ locale: $localeStore, key: 'admin.haptics.no' })}</span
					>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-muted-foreground"
						>{t({ locale: $localeStore, key: 'admin.haptics.probe.android' })}</span
					>
					<span class="font-mono"
						>{android
							? t({ locale: $localeStore, key: 'admin.haptics.android_floored' })
							: t({ locale: $localeStore, key: 'admin.haptics.android_raw' })}</span
					>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-muted-foreground"
						>{t({ locale: $localeStore, key: 'admin.haptics.probe.floor' })}</span
					>
					<span class="font-mono">{ANDROID_BUZZ_FLOOR_MS}ms</span>
				</div>
				<div class="flex items-center justify-between gap-3">
					<span class="text-muted-foreground"
						>{t({ locale: $localeStore, key: 'admin.haptics.probe.preference' })}</span
					>
					<button
						class="border-border hover:bg-foreground/5 rounded-full border px-3 py-1 font-mono text-xs"
						onclick={toggleHaptics}
						type="button"
					>
						{t({
							locale: $localeStore,
							key: 'admin.haptics.preference_toggle',
							params: { state: onOff }
						})}
					</button>
				</div>
				<div class="text-muted-foreground/70 pt-1 font-mono text-[11px] break-all">
					{userAgent}
				</div>
			</section>

			<section class="border-border bg-card space-y-3 rounded-2xl border p-5">
				<h2 class="text-foreground text-lg font-semibold">
					{t({ locale: $localeStore, key: 'admin.haptics.quick_checks' })}
				</h2>
				<div class="flex flex-wrap items-center gap-3">
					<button
						class="bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-semibold"
						onclick={() => fireRaw({ value: 200, label: 'long 200ms' })}
						type="button"
					>
						{t({ locale: $localeStore, key: 'admin.haptics.fire_baseline' })}
					</button>
					<input
						class="border-border w-24 rounded-lg border bg-transparent px-3 py-2 text-sm"
						min="1"
						type="number"
						bind:value={customMs}
					/>
					<button
						class="border-border hover:bg-foreground/5 rounded-full border px-4 py-2 text-sm font-semibold"
						onclick={fireCustom}
						type="button"
					>
						{t({ locale: $localeStore, key: 'admin.haptics.fire_custom' })}
					</button>
				</div>
				<p class="text-muted-foreground font-mono text-xs">
					{t({ locale: $localeStore, key: 'admin.haptics.last' })}
					{lastFired}
				</p>
			</section>

			<section class="space-y-2">
				<h2 class="text-foreground text-lg font-semibold">
					{t({ locale: $localeStore, key: 'admin.haptics.named_patterns' })}
				</h2>
				<ul class="space-y-2">
					{#each patterns as pattern (pattern)}
						{@const raw = HAPTIC_PATTERNS[pattern]}
						{@const floored = applyAndroidFloor(raw)}
						{@const changed = fmt(raw) !== fmt(floored)}
						<li
							class="border-border bg-card flex flex-wrap items-center gap-3 rounded-xl border p-3"
						>
							<div class="min-w-40 flex-1">
								<div class="text-foreground font-mono text-sm font-semibold">{pattern}</div>
								<div class="text-muted-foreground font-mono text-xs">
									{t({ locale: $localeStore, key: 'admin.haptics.raw_label' })}
									{fmt(raw)}
									{#if changed}
										<span class="text-primary"
											>→ {t({ locale: $localeStore, key: 'admin.haptics.android_label' })}
											{fmt(floored)}</span
										>
									{/if}
								</div>
							</div>
							<button
								class="border-border hover:bg-foreground/5 rounded-full border px-3 py-1.5 text-xs font-semibold"
								onclick={() =>
									fireRaw({ value: raw as number | number[], label: `${pattern} raw` })}
								type="button"
							>
								{t({ locale: $localeStore, key: 'admin.haptics.fire_raw' })}
							</button>
							<button
								class="bg-primary text-primary-foreground rounded-full px-3 py-1.5 text-xs font-semibold"
								onclick={() => firePipeline(pattern)}
								type="button"
							>
								{t({ locale: $localeStore, key: 'admin.haptics.fire_pipeline' })}
							</button>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	</PermissionGuard>
</Protected>
