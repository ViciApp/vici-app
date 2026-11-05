<script lang="ts">
	import InviteLanding from '#lib/components/arena/InviteLanding.svelte';

	// `/join/[code]` is the share-friendly twin of `/i/[code]` — the Profile hero's "Invite
	// Friends" CTA shares this form. Both carry the referral code in their slug and render the
	// shared landing, so they behave identically.
</script>

<InviteLanding />
