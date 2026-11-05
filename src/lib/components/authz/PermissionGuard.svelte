<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { userPermissions } from '#lib/derived/user.derived.ts';
	import type { Permission } from '#lib/enums/permission.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		children: Snippet;
		permission: Permission;
		showWarning?: boolean;
		title?: string;
		description?: string;
	}

	const { children, permission, showWarning = false, title, description }: Props = $props();

	const isAuthorized = $derived($userPermissions.includes(permission));

	const handleRefresh = () => {
		window.location.reload();
	};
</script>

{#if isAuthorized}
	{@render children()}
{:else if showWarning}
	<div class="flex flex-col items-center justify-center py-20 text-center">
		<div class="mb-12 max-w-md">
			<h2 class="text-foreground text-4xl font-black">
				{title ?? t({ locale: $localeStore, key: 'authz.access_denied.title' })}
			</h2>
			<p class="text-muted-foreground mt-4 text-lg">
				{description ?? t({ locale: $localeStore, key: 'authz.access_denied.description' })}
			</p>
			<p class="text-muted-foreground mt-2 text-sm">
				{t({
					locale: $localeStore,
					key: 'authz.access_denied.required_permission',
					params: { permission: permission.replace(/_/g, ' ') }
				})}
			</p>
		</div>

		<div class="border-border bg-card rounded-3xl border p-12 shadow-2xl">
			<div class="flex flex-col items-center gap-6">
				<div
					class="flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-red-500 to-orange-600 text-2xl font-bold text-white shadow-xl"
				>
					!
				</div>
				<Button onclick={handleRefresh}
					>{t({ locale: $localeStore, key: 'authz.access_denied.refresh' })}</Button
				>
			</div>
		</div>
	</div>
{/if}
