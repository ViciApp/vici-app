<script lang="ts">
	import { isEmptyString, isNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import type { RegistryDid } from '#declarations';
	import SocialPremiumPicker from '#lib/components/arena/SocialPremiumPicker.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { RESOLUTION_CLAUSE_MAX_LENGTH } from '#lib/constants/app.constants.ts';
	import {
		DEFAULT_SOCIAL_PREMIUM_ID,
		formatSocialPremium,
		type SocialPremiumOptionId
	} from '#lib/constants/social-premium.constants.ts';
	import { listGroups } from '#lib/services/group.services.ts';
	import { createMarket } from '#lib/services/market.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import type { ButtonStatus } from '#lib/types/components.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		onAddMarketSuccess: () => Promise<void>;
	}

	const { onAddMarketSuccess }: Props = $props();

	let status = $state<ButtonStatus>('enabled');

	let title = $state('');
	let description = $state('');
	let resolution = $state('');
	let expiryDate = $state('');

	let marketType = $state<'Binary' | 'Categorical'>('Binary');
	let outcomes = $state<string[]>(['Option A', 'Option B']);
	let socialPremiumId = $state<SocialPremiumOptionId>(DEFAULT_SOCIAL_PREMIUM_ID);
	let socialPremiumCustom = $state('');

	let selectedDomain = $state<'ViciXp' | 'Social'>('ViciXp');

	let isRestricted = $state(false);
	let availableGroups = $state<RegistryDid.Group[]>([]);
	let selectedGroupIds = $state<string[]>([]);

	onMount(async () => {
		try {
			availableGroups = await listGroups();
		} catch {
			// Groups API may not be available yet
		}
	});

	const addOutcome = () => {
		outcomes = [...outcomes, `Option ${String.fromCharCode(65 + outcomes.length)}`];
	};

	const removeOutcome = (index: number) => {
		if (outcomes.length > 2) {
			outcomes = outcomes.filter((_, i) => i !== index);
		}
	};

	const onCreate = async () => {
		// `resolution` is the compulsory settlement clause; `description` is an
		// optional blurb (the service falls back to the clause when it's blank).
		if (isEmptyString(title) || isEmptyString(expiryDate)) {
			return;
		}

		// Mirror the registry's resolution-clause validation
		// (`ResolutionClauseEmpty` / `ResolutionClauseTooLong`) so the admin gets
		// a localized message instead of an opaque `add_series` error.
		const resolutionTrimmed = resolution.trim();

		if (isEmptyString(resolutionTrimmed)) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'wallet.send.error_title' }),
				message: t({ locale: $localeStore, key: 'admin.markets.form.error.resolution_required' }),
				type: 'warning'
			});

			return;
		}

		if (resolutionTrimmed.length > RESOLUTION_CLAUSE_MAX_LENGTH) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'wallet.send.error_title' }),
				message: t({
					locale: $localeStore,
					key: 'admin.markets.form.error.resolution_too_long',
					params: { max: RESOLUTION_CLAUSE_MAX_LENGTH }
				}),
				type: 'warning'
			});

			return;
		}

		status = 'pending';

		const tradingAccess: RegistryDid.TradingAccess[] =
			isRestricted && selectedGroupIds.length > 0
				? [{ Restricted: { groups: selectedGroupIds } }]
				: [{ Open: null }];

		const domain: RegistryDid.BalanceDomain =
			selectedDomain === 'Social' ? { Social: null } : { ViciXp: null };

		const socialReward =
			selectedDomain === 'Social'
				? formatSocialPremium({
						optionId: socialPremiumId,
						customTitle: socialPremiumCustom,
						locale: $localeStore
					})
				: undefined;

		if (selectedDomain === 'Social' && isNullish(socialReward)) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'challenge.create.error.missing_premium' }),
				message: t({
					locale: $localeStore,
					key: 'challenge.create.error.missing_premium_message'
				}),
				type: 'warning'
			});
			status = 'enabled';

			return;
		}

		try {
			await createMarket({
				title,
				description,
				resolution: resolutionTrimmed,
				expiryDate: BigInt(new Date(expiryDate).getTime()),
				outcomes: marketType === 'Categorical' ? outcomes : [],
				balanceDomain: domain,
				socialReward,
				tradingAccess
			});

			title = '';
			description = '';
			resolution = '';
			expiryDate = '';
			outcomes = ['Option A', 'Option B'];
			socialPremiumId = DEFAULT_SOCIAL_PREMIUM_ID;
			socialPremiumCustom = '';
			marketType = 'Binary';
			isRestricted = false;
			selectedGroupIds = [];

			await onAddMarketSuccess();

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'wallet.send.success_title' }),
				message: t({ locale: $localeStore, key: 'admin.markets.form.success.message' }),
				type: 'success'
			});
		} catch (e: unknown) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'wallet.send.error_title' }),
				message: (e as Error).message,
				type: 'error'
			});
		} finally {
			status = 'enabled';
		}
	};
</script>

<div class="border-border bg-card rounded-3xl border p-8">
	<h2 class="text-foreground mb-6 text-2xl font-bold">
		{t({ locale: $localeStore, key: 'admin.markets.form.title' })}
	</h2>
	<div class="space-y-6">
		<div class="space-y-2">
			<label
				class="text-muted-foreground text-xs font-bold tracking-widest uppercase"
				for="market-title"
			>
				{t({ locale: $localeStore, key: 'admin.markets.form.field.title' })}
			</label>
			<input
				id="market-title"
				class="bg-foreground/5 text-foreground ring-border focus:ring-primary w-full rounded-2xl border-none px-6 py-4 ring-1 ring-inset focus:ring-2"
				oninput={(e) => (title = e.currentTarget.value)}
				placeholder={t({
					locale: $localeStore,
					key: 'admin.markets.form.field.title_placeholder'
				})}
				type="text"
				value={title}
			/>
		</div>

		<div class="space-y-2">
			<label
				class="text-muted-foreground text-xs font-bold tracking-widest uppercase"
				for="market-resolution"
			>
				{t({ locale: $localeStore, key: 'admin.markets.form.field.resolution' })}
			</label>
			<textarea
				id="market-resolution"
				class="bg-foreground/5 text-foreground ring-border focus:ring-primary w-full rounded-2xl border-none px-6 py-4 ring-1 ring-inset focus:ring-2"
				maxlength={RESOLUTION_CLAUSE_MAX_LENGTH}
				oninput={(e) => (resolution = e.currentTarget.value)}
				placeholder={t({
					locale: $localeStore,
					key: 'admin.markets.form.field.resolution_placeholder'
				})}
				rows="4"
				value={resolution}></textarea>
			<p class="text-muted-foreground text-[10px]">
				{t({
					locale: $localeStore,
					key: 'admin.markets.form.field.resolution_hint',
					params: { max: RESOLUTION_CLAUSE_MAX_LENGTH }
				})}
			</p>
		</div>

		<div class="space-y-2">
			<label
				class="text-muted-foreground text-xs font-bold tracking-widest uppercase"
				for="market-description"
			>
				{t({ locale: $localeStore, key: 'admin.markets.form.field.description' })}
			</label>
			<textarea
				id="market-description"
				class="bg-foreground/5 text-foreground ring-border focus:ring-primary w-full rounded-2xl border-none px-6 py-4 ring-1 ring-inset focus:ring-2"
				oninput={(e) => (description = e.currentTarget.value)}
				placeholder={t({
					locale: $localeStore,
					key: 'admin.markets.form.field.description_placeholder'
				})}
				rows="4"
				value={description}></textarea>
		</div>

		<div class="space-y-2">
			<label
				class="text-muted-foreground text-xs font-bold tracking-widest uppercase"
				for="expiry-date"
			>
				{t({ locale: $localeStore, key: 'admin.markets.form.field.expiry_date' })}
			</label>
			<input
				id="expiry-date"
				class="bg-foreground/5 text-foreground ring-border focus:ring-primary w-full rounded-2xl border-none px-6 py-4 ring-1 ring-inset focus:ring-2"
				oninput={(e) => (expiryDate = e.currentTarget.value)}
				type="datetime-local"
				value={expiryDate}
			/>
		</div>

		<div class="space-y-4">
			<span class="text-muted-foreground text-xs font-bold tracking-widest uppercase">
				{t({ locale: $localeStore, key: 'admin.markets.form.field.market_type' })}
			</span>
			<div class="flex gap-4">
				<button
					class="flex-1 rounded-2xl border-2 px-6 py-4 font-bold transition-all {marketType ===
					'Binary'
						? 'border-primary bg-primary/10 text-primary'
						: 'border-border bg-foreground/5 text-muted-foreground hover:border-foreground/10'}"
					onclick={() => (marketType = 'Binary')}
					type="button"
				>
					{t({ locale: $localeStore, key: 'admin.markets.form.type.binary' })}
				</button>
				<button
					class="flex-1 rounded-2xl border-2 px-6 py-4 font-bold transition-all {marketType ===
					'Categorical'
						? 'border-primary bg-primary/10 text-primary'
						: 'border-border bg-foreground/5 text-muted-foreground hover:border-foreground/10'}"
					onclick={() => (marketType = 'Categorical')}
					type="button"
				>
					{t({ locale: $localeStore, key: 'admin.markets.form.type.categorical' })}
				</button>
			</div>
		</div>

		{#if marketType === 'Categorical'}
			<div class="bg-foreground/5 space-y-4 rounded-3xl p-6">
				<div class="flex items-center justify-between">
					<span class="text-muted-foreground text-xs font-bold tracking-widest uppercase">
						{t({ locale: $localeStore, key: 'admin.markets.form.outcomes.label' })}
					</span>
					<button
						class="text-primary hover:text-primary text-xs font-bold"
						onclick={addOutcome}
						type="button"
					>
						{t({ locale: $localeStore, key: 'admin.markets.form.outcomes.add' })}
					</button>
				</div>
				<div class="space-y-3">
					{#each outcomes as outcome, i (i)}
						<div class="flex gap-2">
							<input
								class="bg-card text-foreground ring-border focus:ring-primary flex-1 rounded-xl border-none px-4 py-3 text-sm ring-1 ring-inset focus:ring-2"
								oninput={(e) => (outcomes[i] = e.currentTarget.value)}
								placeholder={t({
									locale: $localeStore,
									key: 'admin.markets.form.outcomes.placeholder',
									params: { n: i + 1 }
								})}
								type="text"
								value={outcome}
							/>
							{#if outcomes.length > 2}
								<button
									class="bg-card text-muted-foreground ring-border hover:text-destructive rounded-xl px-4 py-3 ring-1 ring-inset"
									aria-label={t({
										locale: $localeStore,
										key: 'admin.markets.form.outcomes.remove'
									})}
									onclick={() => removeOutcome(i)}
									type="button"
								>
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											d="M6 18L18 6M6 6l12 12"
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
										/>
									</svg>
								</button>
							{/if}
						</div>
					{/each}
				</div>
				<p class="text-muted-foreground text-[10px]">
					{t({ locale: $localeStore, key: 'admin.markets.form.outcomes.note' })}
				</p>
			</div>
		{/if}

		<div class="space-y-4">
			<span class="text-muted-foreground text-xs font-bold tracking-widest uppercase">
				{t({ locale: $localeStore, key: 'admin.markets.form.domain.label' })}
			</span>
			<div class="flex gap-4">
				<button
					class="flex-1 rounded-2xl border-2 px-6 py-4 font-bold transition-all {selectedDomain ===
					'ViciXp'
						? 'border-primary bg-primary/10 text-primary'
						: 'border-border bg-foreground/5 text-muted-foreground hover:border-foreground/10'}"
					onclick={() => (selectedDomain = 'ViciXp')}
					type="button"
				>
					{t({ locale: $localeStore, key: 'admin.markets.form.domain.vici_xp' })}
				</button>
				<button
					class="flex-1 rounded-2xl border-2 px-6 py-4 font-bold transition-all {selectedDomain ===
					'Social'
						? 'border-primary bg-primary/10 text-primary'
						: 'border-border bg-foreground/5 text-muted-foreground hover:border-foreground/10'}"
					onclick={() => (selectedDomain = 'Social')}
					type="button"
				>
					{t({ locale: $localeStore, key: 'admin.markets.form.domain.social' })}
				</button>
			</div>
		</div>

		{#if selectedDomain === 'Social'}
			<div class="bg-primary/5 ring-primary/20 space-y-4 rounded-3xl p-6 ring-1 ring-inset">
				<span class="text-primary text-xs font-bold tracking-widest uppercase">
					{t({ locale: $localeStore, key: 'admin.markets.form.social.section_title' })}
				</span>
				<SocialPremiumPicker
					customTitle={socialPremiumCustom}
					onChange={({ optionId, customTitle }) => {
						socialPremiumId = optionId;
						socialPremiumCustom = customTitle;
					}}
					optionId={socialPremiumId}
				/>
			</div>
		{/if}

		<div class="space-y-4">
			<span class="text-muted-foreground text-xs font-bold tracking-widest uppercase">
				{t({ locale: $localeStore, key: 'admin.markets.form.access.label' })}
			</span>
			<div class="flex gap-4">
				<button
					class="flex-1 rounded-2xl border-2 px-6 py-4 font-bold transition-all {!isRestricted
						? 'border-primary bg-primary/10 text-primary'
						: 'border-border bg-foreground/5 text-muted-foreground hover:border-foreground/10'}"
					onclick={() => (isRestricted = false)}
					type="button"
				>
					{t({ locale: $localeStore, key: 'admin.markets.form.access.open' })}
				</button>
				<button
					class="flex-1 rounded-2xl border-2 px-6 py-4 font-bold transition-all {isRestricted
						? 'border-amber-500 bg-amber-50 text-amber-700'
						: 'border-border bg-foreground/5 text-muted-foreground hover:border-foreground/10'}"
					onclick={() => (isRestricted = true)}
					type="button"
				>
					{t({ locale: $localeStore, key: 'markets.filter.access.closed' })}
				</button>
			</div>
		</div>

		{#if isRestricted}
			<div class="space-y-3 rounded-3xl bg-amber-50/50 p-6">
				<span class="text-xs font-bold tracking-widest text-amber-700 uppercase">
					{t({ locale: $localeStore, key: 'admin.markets.form.access.restrict_to_groups' })}
				</span>
				{#if availableGroups.length === 0}
					<p class="text-sm text-amber-600 italic">
						{t({ locale: $localeStore, key: 'admin.markets.form.access.no_groups' })}
					</p>
				{:else}
					<div class="space-y-2">
						{#each availableGroups as group (group.group_id)}
							<label
								class="bg-card flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-amber-200 transition-colors ring-inset hover:bg-amber-50"
							>
								<input
									class="accent-amber-600"
									checked={selectedGroupIds.includes(group.group_id)}
									onchange={() => {
										if (selectedGroupIds.includes(group.group_id)) {
											selectedGroupIds = selectedGroupIds.filter((id) => id !== group.group_id);
										} else {
											selectedGroupIds = [...selectedGroupIds, group.group_id];
										}
									}}
									type="checkbox"
								/>
								<span class="text-foreground text-sm font-semibold">{group.name}</span>
								<span class="text-muted-foreground ml-auto text-xs">
									{t({
										locale: $localeStore,
										key: 'admin.markets.form.access.members_count',
										params: { count: group.members.length }
									})}
								</span>
							</label>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<Button class="w-full" onclick={onCreate} size="lg" {status}>
			{t({ locale: $localeStore, key: 'admin.markets.form.deploy' })}
		</Button>
	</div>
</div>
