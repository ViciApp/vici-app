<script lang="ts">
	import { signOut } from '@junobuild/core';
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { ButtonStatus } from '#lib/types/components.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
	import { clearWeb2Session } from '#lib/web2/session.ts';

	let status = $state<ButtonStatus>('enabled');

	const doSignOut = async () => {
		status = 'pending';

		try {
			// Web2 revokes the cookie session server-side then clears the local
			// store; the on-chain path drops the Juno delegation. Default stays
			// on-chain when the flag is off.
			if (isWeb2Backend()) {
				await clearWeb2Session();
			} else {
				await signOut();
			}
		} finally {
			status = 'enabled';
		}
	};
</script>

<BaseButton
	class="text-muted-foreground hover:text-primary active:text-primary"
	aria-label={t({ locale: $localeStore, key: 'settings.sign_out' })}
	onclick={doSignOut}
	{status}
>
	<svg
		fill="currentColor"
		height="16"
		viewBox="0 -960 960 960"
		width="16"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			d="M120-120v-720h360v80H200v560h280v80H120Zm520-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z"
		/>
	</svg>
</BaseButton>
