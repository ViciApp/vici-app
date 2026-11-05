<script lang="ts">
	import { RESOLUTION_CLAUSE_MAX_LENGTH } from '#lib/constants/app.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { downloadJsonFile } from '#lib/utils/download.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		onBulkCreate: (
			markets: {
				title: string;
				resolution: string;
				description?: string;
				expiryDate: string;
				balanceDomain?: string;
				outcomes?: string[];
				tags?: string[];
			}[]
		) => void;
	}

	const { onBulkCreate }: Props = $props();

	let fileInput: HTMLInputElement;
	let error = $state<string | null>(null);
	let dragging = $state(false);

	const exampleJson = [
		{
			title: 'Will Bitcoin hit $100k by 2027?',
			resolution:
				'Resolves YES if the Bitcoin price reaches $100,000 USD on any major exchange before Jan 1, 2027.',
			description: "Bitcoin's run at a six-figure price before 2027.",
			expiryDate: '2027-01-01T00:00:00Z',
			balanceDomain: 'ViciXp',
			tags: ['bitcoin']
		},
		{
			title: 'Who will win the 2026 FIFA World Cup?',
			resolution: 'Resolves to the nation that wins the 2026 FIFA World Cup final.',
			expiryDate: '2026-07-20T21:59:59.000Z',
			balanceDomain: 'ViciXp',
			outcomes: ['Italy', 'Brazil', 'France', 'Argentina', 'England', 'Spain', 'Germany', 'Other'],
			tags: ['soccer', 'world-cup']
		}
	];

	const processFile = async (file: File) => {
		error = null;

		if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
			error = t({ locale: $localeStore, key: 'admin.markets.bulk.error.not_json' });

			return;
		}

		try {
			const text = await file.text();
			const data = JSON.parse(text);

			if (!Array.isArray(data)) {
				error = t({ locale: $localeStore, key: 'admin.markets.bulk.error.not_array' });

				return;
			}

			for (const item of data) {
				if (!item.title || !item.resolution || !item.expiryDate) {
					error = t({ locale: $localeStore, key: 'admin.markets.bulk.error.missing_fields' });

					return;
				}

				if (isNaN(Date.parse(item.expiryDate))) {
					error = t({
						locale: $localeStore,
						key: 'admin.markets.bulk.error.invalid_date',
						params: { date: item.expiryDate }
					});

					return;
				}

				// `resolution` is the compulsory settlement clause: it must be a
				// string within the registry's clause-length bound. (`description`
				// is optional and falls back to the clause in createMarket.)
				// Validate against the *trimmed* clause so the checks match what
				// createMarket actually sends (it trims + caps before the call).
				if (typeof item.resolution !== 'string') {
					error = t({
						locale: $localeStore,
						key: 'admin.markets.bulk.error.resolution_not_string',
						params: { title: item.title }
					});

					return;
				}

				const resolutionClause = item.resolution.trim();

				// A whitespace-only clause is effectively a missing resolution.
				if (resolutionClause.length === 0) {
					error = t({ locale: $localeStore, key: 'admin.markets.bulk.error.missing_fields' });

					return;
				}

				if (resolutionClause.length > RESOLUTION_CLAUSE_MAX_LENGTH) {
					error = t({
						locale: $localeStore,
						key: 'admin.markets.bulk.error.resolution_too_long',
						params: { title: item.title, max: RESOLUTION_CLAUSE_MAX_LENGTH }
					});

					return;
				}

				if (item.outcomes) {
					if (!Array.isArray(item.outcomes)) {
						error = t({
							locale: $localeStore,
							key: 'admin.markets.bulk.error.outcomes_not_array',
							params: { title: item.title }
						});

						return;
					}

					if (item.outcomes.some((o: unknown) => typeof o !== 'string')) {
						error = t({
							locale: $localeStore,
							key: 'admin.markets.bulk.error.outcome_not_string',
							params: { title: item.title }
						});

						return;
					}

					if (item.outcomes.length < 2) {
						error = t({
							locale: $localeStore,
							key: 'admin.markets.bulk.error.too_few_outcomes',
							params: { title: item.title }
						});

						return;
					}
				}

				if (item.tags) {
					if (!Array.isArray(item.tags)) {
						error = t({
							locale: $localeStore,
							key: 'admin.markets.bulk.error.tags_not_array',
							params: { title: item.title }
						});

						return;
					}

					if (item.tags.some((c: unknown) => typeof c !== 'string')) {
						error = t({
							locale: $localeStore,
							key: 'admin.markets.bulk.error.tag_not_string',
							params: { title: item.title }
						});

						return;
					}
				}
			}

			onBulkCreate(data);

			if (fileInput) {
				fileInput.value = '';
			}
		} catch (e: unknown) {
			error = t({
				locale: $localeStore,
				key: 'admin.markets.bulk.error.parse_failed',
				params: { message: (e as Error).message }
			});
		}
	};

	const handleFileChange = (e: Event) => {
		const target = e.target as HTMLInputElement;

		if (target.files && target.files[0]) {
			processFile(target.files[0]);
		}
	};

	const handleDrop = (e: DragEvent) => {
		e.preventDefault();
		dragging = false;

		if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
			processFile(e.dataTransfer.files[0]);
		}
	};
</script>

<div class="border-border bg-card rounded-3xl border p-8">
	<div class="mb-6 flex items-center justify-between">
		<h2 class="text-foreground text-2xl font-bold">
			{t({ locale: $localeStore, key: 'admin.markets.bulk.title' })}
		</h2>
		<span class="bg-primary/10 text-primary rounded-full px-3 py-1 text-[10px] font-bold uppercase">
			{t({ locale: $localeStore, key: 'admin.markets.bulk.badge' })}
		</span>
	</div>

	<div class="space-y-6">
		<div
			class="relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 transition-all {dragging
				? 'border-primary bg-primary/10'
				: 'border-border bg-foreground/5 hover:bg-foreground/8'}"
			aria-label={t({ locale: $localeStore, key: 'admin.markets.bulk.upload_label' })}
			ondragleave={() => (dragging = false)}
			ondragover={(e) => {
				e.preventDefault();
				dragging = true;
			}}
			ondrop={handleDrop}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					fileInput.click();
				}
			}}
			role="button"
			tabindex="0"
		>
			<input
				bind:this={fileInput}
				id="bulk-market-upload"
				class="absolute inset-0 cursor-pointer opacity-0"
				onchange={handleFileChange}
				type="file"
			/>
			<div class="text-center">
				<div
					class="bg-card mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full shadow-sm"
				>
					<svg class="text-primary h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
						/>
					</svg>
				</div>
				<p class="text-foreground text-sm font-semibold">
					{t({ locale: $localeStore, key: 'admin.markets.bulk.upload_cta' })}
				</p>
				<p class="text-muted-foreground mt-1 text-xs">
					{t({ locale: $localeStore, key: 'admin.markets.bulk.upload_hint' })}
				</p>
			</div>
		</div>

		{#if error}
			<div
				class="border-border bg-destructive/10 text-destructive rounded-xl border p-4 text-xs font-medium"
			>
				{error}
			</div>
		{/if}

		<div class="space-y-3">
			<label
				class="text-muted-foreground text-xs font-bold tracking-widest uppercase"
				for="bulk-market-upload"
			>
				{t({ locale: $localeStore, key: 'admin.markets.bulk.format_label' })}
			</label>
			<div class="bg-background overflow-hidden rounded-2xl p-4">
				<pre class="text-primary overflow-x-auto font-mono text-[10px]"><code>
						{JSON.stringify(exampleJson, null, 2)}
					</code></pre>
			</div>
			<button
				class="text-primary hover:text-primary flex items-center gap-2 text-xs font-bold transition-colors"
				onclick={() => downloadJsonFile({ data: exampleJson, filename: 'markets_template.json' })}
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
					/>
				</svg>
				{t({ locale: $localeStore, key: 'admin.markets.bulk.download_template' })}
			</button>
		</div>
	</div>
</div>
