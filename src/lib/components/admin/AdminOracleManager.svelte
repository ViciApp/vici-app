<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import CopyableAddress from '#lib/components/ui/CopyableAddress.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { VICI_ORACLE_V1 } from '#lib/constants/app.constants.ts';
	import { safeGetIdentityOnce } from '#lib/services/identity.services.ts';
	import {
		getViciOracle,
		reconcileOracleSettlersFromRoles,
		registerViciOracle,
		resolveOracleSettlers,
		type OracleSettlerEntry
	} from '#lib/services/oracle.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	type Status = 'loading' | 'missing' | 'ready' | 'error';

	let status = $state<Status>('loading');
	let settlers = $state<OracleSettlerEntry[]>([]);
	let errorMessage = $state<string | undefined>();
	let isSubmitting = $state(false);
	let isReconciling = $state(false);

	const load = async () => {
		status = 'loading';
		errorMessage = undefined;

		try {
			const oracle = await getViciOracle();

			if (isNullish(oracle)) {
				status = 'missing';
				settlers = [];

				return;
			}

			settlers = await resolveOracleSettlers(oracle.authorized_principals.map((p) => p.toText()));
			status = 'ready';
		} catch (e: unknown) {
			status = 'error';
			errorMessage = (e as Error).message;
		}
	};

	onMount(load);

	const handleRegister = async () => {
		isSubmitting = true;

		try {
			const identity = await safeGetIdentityOnce();
			const self = identity.getPrincipal().toText();

			await registerViciOracle({ authorizedPrincipals: [self] });

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'admin.oracle.registered.title' }),
				message: t({
					locale: $localeStore,
					key: 'admin.oracle.registered.message',
					params: { oracle: VICI_ORACLE_V1 }
				}),
				type: 'success'
			});

			await load();
		} catch (e: unknown) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'admin.oracle.registration_failed' }),
				message: (e as Error).message,
				type: 'error'
			});
		} finally {
			isSubmitting = false;
		}
	};

	const handleReconcile = async () => {
		isReconciling = true;

		try {
			const { added, removed } = await reconcileOracleSettlersFromRoles();

			if (added.length === 0 && removed.length === 0) {
				notificationsStore.add({
					title: t({ locale: $localeStore, key: 'admin.oracle.reconcile.title' }),
					message: t({ locale: $localeStore, key: 'admin.oracle.reconcile.in_sync' }),
					type: 'success'
				});
			} else {
				notificationsStore.add({
					title: t({ locale: $localeStore, key: 'admin.oracle.reconcile.title' }),
					message: t({
						locale: $localeStore,
						key: 'admin.oracle.reconcile.success',
						params: { added: added.length, removed: removed.length }
					}),
					type: 'success'
				});
			}

			await load();
		} catch (e: unknown) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'admin.oracle.reconcile.failed' }),
				message: (e as Error).message,
				type: 'error'
			});
		} finally {
			isReconciling = false;
		}
	};
</script>

<div class="border-border bg-card rounded-xl border p-6">
	<div class="mb-6 flex items-start justify-between gap-4">
		<div>
			<h2 class="text-foreground text-xl font-semibold">
				{t({ locale: $localeStore, key: 'admin.oracle.title' })}
			</h2>
			<p class="text-muted-foreground mt-1 text-sm">
				{t({ locale: $localeStore, key: 'admin.oracle.sub_prefix' })}
				<code class="bg-foreground/5 text-foreground rounded px-1.5 py-0.5 font-mono text-xs">
					{VICI_ORACLE_V1}
				</code>{t({ locale: $localeStore, key: 'admin.oracle.sub_driven_by' })}
				<strong>{t({ locale: $localeStore, key: 'admin.oracle.sub_roles_word' })}</strong>
				{t({ locale: $localeStore, key: 'admin.oracle.sub_granting' })}
				<!-- eslint-disable-next-line local-rules/no-bare-svelte-text -- TODO(i18n): code-shaped role identifier sent to the engine, not natural language; promote into the brand allowlist if more role IDs surface here. -->
				<code class="bg-foreground/5 rounded px-1 py-0.5 font-mono text-xs">ADMIN</code>
				{t({ locale: $localeStore, key: 'admin.oracle.sub_or' })}
				<!-- eslint-disable-next-line local-rules/no-bare-svelte-text -- TODO(i18n): see ADMIN above. -->
				<code class="bg-foreground/5 rounded px-1 py-0.5 font-mono text-xs">SOLVER</code>
				{t({ locale: $localeStore, key: 'admin.oracle.sub_suffix' })}
			</p>
		</div>
		<button
			class="text-primary hover:text-primary shrink-0 text-sm font-medium disabled:opacity-50"
			disabled={status === 'loading' || isSubmitting}
			onclick={load}
		>
			{t({ locale: $localeStore, key: 'admin.oracle.action.refresh' })}
		</button>
	</div>

	{#if status === 'loading'}
		<div class="flex justify-center py-8">
			<LoadingSpinner size="sm" />
		</div>
	{:else if status === 'error'}
		<div
			class="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm"
		>
			<p class="font-semibold">
				{t({ locale: $localeStore, key: 'admin.oracle.error.title' })}
			</p>
			<p class="mt-1 break-all">{errorMessage}</p>
			<Button class="mt-3" onclick={load} size="sm" variant="outline">
				{t({ locale: $localeStore, key: 'admin.oracle.action.retry' })}
			</Button>
		</div>
	{:else if status === 'missing'}
		<div class="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
			<p class="font-semibold">
				{t({ locale: $localeStore, key: 'admin.oracle.missing.title' })}
			</p>
			<p class="mt-1">
				<code>{VICI_ORACLE_V1}</code>
				{t({ locale: $localeStore, key: 'admin.oracle.missing.body' })}
			</p>
			<p class="mt-2">
				{t({ locale: $localeStore, key: 'admin.oracle.missing.body_2' })}
			</p>
			<Button
				class="mt-3"
				onclick={handleRegister}
				size="sm"
				status={isSubmitting ? 'pending' : 'enabled'}
			>
				{t({ locale: $localeStore, key: 'admin.oracle.missing.register_cta' })}
			</Button>
		</div>
	{:else}
		<div class="space-y-4">
			<div class="flex items-center justify-between gap-3">
				<h3 class="text-foreground text-sm font-semibold tracking-wider uppercase">
					{t({
						locale: $localeStore,
						key: 'admin.oracle.authorized_count',
						params: { count: settlers.length }
					})}
				</h3>
				<Button
					onclick={handleReconcile}
					size="sm"
					status={isReconciling ? 'pending' : 'enabled'}
					variant="outline"
				>
					{t({ locale: $localeStore, key: 'admin.oracle.action.reconcile' })}
				</Button>
			</div>

			<p class="text-muted-foreground text-xs">
				{t({ locale: $localeStore, key: 'admin.oracle.reconcile.hint' })}
			</p>

			{#if settlers.length === 0}
				<p class="text-muted-foreground text-sm italic">
					{t({ locale: $localeStore, key: 'admin.oracle.no_authorized' })}
				</p>
			{:else}
				<ul class="divide-border border-border divide-y overflow-hidden rounded-md border">
					{#each settlers as settler (settler.principal)}
						<li class="px-6 py-4">
							<div class="min-w-0">
								{#if settler.nickname}
									<span class="text-foreground block text-sm font-semibold">
										{settler.nickname}
									</span>
								{/if}
								<span class="text-muted-foreground text-sm" class:font-medium={!settler.nickname}>
									<CopyableAddress
										address={settler.principal}
										label={t({ locale: $localeStore, key: 'profile.dashboard.principal' })}
									/>
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
