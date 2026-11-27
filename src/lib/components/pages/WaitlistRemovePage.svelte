<script lang="ts">
	import { onMount } from 'svelte';
	import Logo from '#lib/components/layout/Logo.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { pageTitle } from '#lib/constants/brand.constants.ts';
	import { PublicPath } from '#lib/constants/routes.constants.ts';
	import { removeReservation } from '#lib/services/waitlist.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { isWeb2Backend } from '#lib/web2/backend-mode.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	// The waitlist exists on the web2 build only.
	const enabled = isWeb2Backend();

	// Opening the link deletes nothing: mail scanners open links, so only the
	// button's request removes the reservation.
	type Stage = 'ready' | 'removing' | 'done' | 'failed' | 'missing';

	const id = $derived(page.url.searchParams.get('r') ?? '');
	const token = $derived(page.url.searchParams.get('t') ?? '');

	let stage = $state<Stage>('ready');

	onMount(() => {
		if (!enabled) {
			void goto(resolve(PublicPath.Landing), { replace: true });
		}
	});

	const shownStage = $derived<Stage>(id === '' || token === '' ? 'missing' : stage);

	const remove = async () => {
		if (stage === 'removing') {
			return;
		}

		stage = 'removing';

		try {
			await removeReservation({ id, token });
			stage = 'done';
		} catch (err: unknown) {
			console.error('Waitlist: the reservation could not be removed', err);
			stage = 'failed';
		}
	};
</script>

<svelte:head>
	<title>{pageTitle(t({ locale: $localeStore, key: 'waitlist.remove.title' }))}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if enabled}
	<div class="wr-page">
		<div class="wr-card">
			<div class="wr-logo">
				<Logo />
			</div>

			<h1 class="wr-title">{t({ locale: $localeStore, key: 'waitlist.remove.title' })}</h1>

			{#if shownStage === 'missing'}
				<p class="wr-copy">{t({ locale: $localeStore, key: 'waitlist.remove.missing' })}</p>
			{:else if shownStage === 'done'}
				<p class="wr-success" role="status">
					{t({ locale: $localeStore, key: 'waitlist.remove.done' })}
				</p>
			{:else}
				<p class="wr-copy">{t({ locale: $localeStore, key: 'waitlist.remove.body' })}</p>
				{#if shownStage === 'failed'}
					<p class="wr-error" role="alert">
						{t({ locale: $localeStore, key: 'waitlist.remove.failed' })}
					</p>
				{/if}
				<Button
					onclick={() => void remove()}
					size="lg"
					status={shownStage === 'removing' ? 'loading' : 'enabled'}
					variant="danger"
				>
					{t({ locale: $localeStore, key: 'waitlist.remove.cta' })}
				</Button>
			{/if}
		</div>
	</div>
{/if}

<style lang="postcss">
	.wr-page {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 1.5rem;
		padding-top: calc(1.5rem + env(safe-area-inset-top, 0px));
		background: var(--bg-base);
		color: var(--text-base);
	}

	.wr-card {
		width: 100%;
		max-width: 26rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.wr-logo {
		display: flex;
		justify-content: center;
	}

	.wr-title {
		margin: 0;
		font-size: 1.375rem;
		font-weight: 800;
		text-align: center;
	}

	.wr-copy,
	.wr-error {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.45;
		text-align: center;
		color: var(--text-muted);
	}

	.wr-error {
		color: var(--danger);
	}

	.wr-success {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 700;
		text-align: center;
		color: var(--accent);
	}
</style>
