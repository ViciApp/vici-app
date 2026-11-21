<script lang="ts">
	import Protected from '#lib/components/authn/Protected.svelte';
	import PermissionGuard from '#lib/components/authz/PermissionGuard.svelte';
	import AdminResolutionsPage from '#lib/components/pages/AdminResolutionsPage.svelte';
	import { Permission } from '#lib/enums/permission.ts';
</script>

<Protected>
	<PermissionGuard permission={Permission.VIEW_ADMIN_PANEL}>
		<AdminResolutionsPage />
	</PermissionGuard>
</Protected>
