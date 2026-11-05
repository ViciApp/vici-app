<script lang="ts">
	import type { PrincipalText } from '@junobuild/schema';
	import { onMount } from 'svelte';
	import AdminAddForm from '#lib/components/admin/AdminAddForm.svelte';
	import AdminList from '#lib/components/admin/AdminList.svelte';
	import AdminOracleManager from '#lib/components/admin/AdminOracleManager.svelte';
	import AdminPrincipalSearch from '#lib/components/admin/AdminPrincipalSearch.svelte';
	import AdminSubPageHeader from '#lib/components/admin/AdminSubPageHeader.svelte';
	import { UserRole } from '#lib/enums/user.ts';
	import { getProfile } from '#lib/services/profile.services.ts';
	import {
		listRoles,
		removeRole,
		setRole,
		type UserRoleEntry
	} from '#lib/services/roles.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	let roleEntries = $state<UserRoleEntry[]>([]);
	let isAssigningRole = $state(false);

	let newRolePrincipal = $state('');
	let newRoleSelected = $state<UserRole>(UserRole.ADMIN);

	const fetchRoles = async () => {
		try {
			roleEntries = await listRoles();
		} catch (e: unknown) {
			console.error('Failed to fetch roles:', e);
		}
	};

	onMount(() => {
		fetchRoles();
	});

	const handleAddRole = async () => {
		const principal = newRolePrincipal.trim();
		const role = newRoleSelected;

		if (!principal) {
			return;
		}

		isAssigningRole = true;

		try {
			await setRole({ principal, role });

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'admin.roles.granted.title' }),
				message: t({ locale: $localeStore, key: 'admin.roles.granted.message' }),
				type: 'success'
			});

			newRolePrincipal = '';
			newRoleSelected = UserRole.ADMIN;

			const getNickname = async (principal: PrincipalText): Promise<string | undefined> => {
				try {
					const profile = await getProfile(principal);

					return profile.data?.nickname;
				} catch {
					// The nickname is purely cosmetic for the admin role list; missing profiles should not block the grant flow.
				}
			};

			const nickname = await getNickname(principal);

			roleEntries = [
				...roleEntries.filter((e) => e.principal !== principal),
				{ principal, role, nickname }
			];

			await fetchRoles();
		} catch (e: unknown) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'admin.roles.grant_failed' }),
				message: (e as Error).message,
				type: 'error'
			});
		} finally {
			isAssigningRole = false;
		}
	};

	const handleRemoveRole = async (principal: PrincipalText) => {
		try {
			await removeRole(principal);
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'admin.roles.removed.title' }),
				message: t({ locale: $localeStore, key: 'admin.roles.removed.message' }),
				type: 'success'
			});

			roleEntries = roleEntries.filter((e) => e.principal !== principal);

			await fetchRoles();
		} catch (e: unknown) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'admin.roles.removal_failed' }),
				message: (e as Error).message,
				type: 'error'
			});
		}
	};
</script>

<div class="space-y-12 px-4 py-6 sm:py-8 lg:py-10">
	<AdminSubPageHeader
		description={t({ locale: $localeStore, key: 'admin.hub.access.description' })}
		title={t({ locale: $localeStore, key: 'admin.hub.access.title' })}
	/>

	<div class="grid grid-cols-1 gap-12 lg:grid-cols-2">
		<section class="space-y-8">
			<AdminPrincipalSearch onSelect={(principal) => (newRolePrincipal = principal)} />

			<AdminAddForm
				isAssigning={isAssigningRole}
				onAddRole={handleAddRole}
				onPrincipalChange={(v) => (newRolePrincipal = v)}
				onRoleChange={(v) => (newRoleSelected = v)}
				principal={newRolePrincipal}
				role={newRoleSelected}
			/>
		</section>

		<section class="space-y-8">
			<AdminList onRemoveRole={handleRemoveRole} {roleEntries} />

			<AdminOracleManager />
		</section>
	</div>
</div>
