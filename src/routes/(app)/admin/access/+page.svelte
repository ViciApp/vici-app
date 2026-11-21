<script lang="ts">
	import Protected from '#lib/components/authn/Protected.svelte';
	import PermissionGuard from '#lib/components/authz/PermissionGuard.svelte';
	import AdminAccessPage from '#lib/components/pages/AdminAccessPage.svelte';
	import { Permission } from '#lib/enums/permission.ts';
</script>

<Protected>
	<PermissionGuard permission={Permission.VIEW_ADMIN_PANEL}>
		<AdminAccessPage />
	</PermissionGuard>
</Protected>
