<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import { UserRole } from '#lib/enums/user.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	let {
		principal = '',
		role = UserRole.ADMIN,
		isAssigning = false,
		onPrincipalChange,
		onRoleChange,
		onAddRole
	}: {
		principal: string;
		role: UserRole;
		isAssigning?: boolean;
		onPrincipalChange: (val: string) => void;
		onRoleChange: (val: UserRole) => void;
		onAddRole: () => void;
	} = $props();

	// Explicitly listed rather than derived from `Object.values(UserRole)` so adding a new
	// non-grantable role (e.g. a future system-level marker) doesn't silently show up in the
	// dropdown. `CONTROLLER` is managed at the IC level and cannot be granted from the UI.
	const grantableRoles: UserRole[] = [UserRole.ADMIN, UserRole.SOLVER, UserRole.CREATOR];
</script>

<div class="border-border bg-card rounded-xl border p-6">
	<h2 class="text-foreground mb-6 text-xl font-semibold">
		{t({ locale: $localeStore, key: 'admin.roles.add.title' })}
	</h2>

	<form
		class="space-y-6"
		onsubmit={(e) => {
			e.preventDefault();

			onAddRole();
		}}
	>
		<div>
			<label class="text-foreground block text-sm font-medium" for="admin-principal">
				{t({ locale: $localeStore, key: 'admin.roles.add.principal_label' })}
			</label>
			<div class="mt-2">
				<input
					id="admin-principal"
					class="focus:ring-brand-600 text-foreground ring-border placeholder:text-muted-foreground focus:ring-primary block w-full rounded-md border-0 py-1.5 ring-1 ring-inset focus:ring-2 focus:ring-inset sm:text-sm sm:leading-6"
					oninput={(e) => onPrincipalChange(e.currentTarget.value.trim())}
					placeholder={t({ locale: $localeStore, key: 'admin.roles.add.principal_placeholder' })}
					required
					type="text"
					value={principal}
				/>
			</div>
			<div class="text-muted-foreground mt-2 text-sm">
				{t({ locale: $localeStore, key: 'admin.roles.add.principal_hint' })}
			</div>
		</div>

		<div>
			<label class="text-foreground block text-sm font-medium" for="user-role">
				{t({ locale: $localeStore, key: 'admin.roles.add.role_label' })}
			</label>
			<div class="mt-2">
				<select
					id="user-role"
					class="focus:ring-brand-600 text-foreground ring-border focus:ring-primary block w-full rounded-md border-0 py-2 pr-10 pl-3 ring-1 ring-inset focus:ring-2 focus:ring-inset sm:text-sm sm:leading-6"
					onchange={(e) => onRoleChange(e.currentTarget.value as UserRole)}
					value={role}
				>
					{#each grantableRoles as role (role)}
						<option value={role}>{role}</option>
					{/each}
				</select>
			</div>
			<p class="text-muted-foreground mt-2 text-sm">
				{t({ locale: $localeStore, key: 'admin.roles.add.role_hint' })}
			</p>
		</div>

		<Button
			onclick={onAddRole}
			status={isAssigning ? 'pending' : !principal ? 'disabled' : 'enabled'}
		>
			{t({ locale: $localeStore, key: 'admin.roles.add.title' })}
		</Button>
	</form>
</div>
