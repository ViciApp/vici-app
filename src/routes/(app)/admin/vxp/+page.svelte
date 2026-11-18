<script lang="ts">
	import Protected from '#lib/components/authn/Protected.svelte';
	import PermissionGuard from '#lib/components/authz/PermissionGuard.svelte';
	import AdminVxpPage from '#lib/components/pages/AdminVxpPage.svelte';
	import { Permission } from '#lib/enums/permission.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
</script>

<Protected
	description={t({ locale: $localeStore, key: 'authn.admin.sub' })}
	title={t({ locale: $localeStore, key: 'authn.admin.title' })}
>
	<PermissionGuard permission={Permission.VIEW_ADMIN_PANEL}>
		<AdminVxpPage />
	</PermissionGuard>
</Protected>
