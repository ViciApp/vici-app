<!-- Streaming placeholder for the market-detail screen. Mirrors the
     real module rhythm (hero title → probability hero → chart card →
     stats grid → resolution card) so the layout doesn't reflow when the
     market data lands. Pure pulse blocks; no copy, decorative only. -->
<div class="detail-skeleton" aria-hidden="true">
	<div class="detail-skeleton-hero">
		<span class="detail-skeleton-block detail-skeleton-tag"></span>
		<span class="detail-skeleton-block detail-skeleton-title"></span>
		<span class="detail-skeleton-block detail-skeleton-title detail-skeleton-title-short"></span>
	</div>

	<div class="detail-skeleton-prob">
		<div class="detail-skeleton-prob-row">
			<span class="detail-skeleton-block detail-skeleton-pct"></span>
			<span class="detail-skeleton-block detail-skeleton-pct"></span>
		</div>
		<span class="detail-skeleton-block detail-skeleton-bar"></span>
	</div>

	<div class="detail-skeleton-card">
		<div class="detail-skeleton-card-head">
			<span class="detail-skeleton-block detail-skeleton-eyebrow"></span>
			<span class="detail-skeleton-block detail-skeleton-chips"></span>
		</div>
		<span class="detail-skeleton-block detail-skeleton-chart"></span>
	</div>

	<div class="detail-skeleton-stats">
		<span class="detail-skeleton-block detail-skeleton-stat"></span>
		<span class="detail-skeleton-block detail-skeleton-stat"></span>
		<span class="detail-skeleton-block detail-skeleton-stat"></span>
		<span class="detail-skeleton-block detail-skeleton-stat"></span>
	</div>

	<div class="detail-skeleton-card">
		<span class="detail-skeleton-block detail-skeleton-eyebrow"></span>
		<span class="detail-skeleton-block detail-skeleton-line"></span>
		<span class="detail-skeleton-block detail-skeleton-line detail-skeleton-line-short"></span>
	</div>
</div>

<style lang="postcss">
	.detail-skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.detail-skeleton-block {
		display: block;
		border-radius: var(--r-8);
		background: color-mix(in srgb, var(--text-muted) 16%, transparent);
		animation: detail-skeleton-pulse 1.4s ease-in-out infinite;
	}

	@keyframes detail-skeleton-pulse {
		0%,
		100% {
			opacity: 0.55;
		}
		50% {
			opacity: 0.9;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.detail-skeleton-block {
			animation: none;
		}
	}

	.detail-skeleton-hero {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem 0;
	}
	.detail-skeleton-tag {
		width: 4.5rem;
		height: 0.75rem;
		border-radius: var(--r-pill);
	}
	.detail-skeleton-title {
		width: 90%;
		height: 1.5rem;
	}
	.detail-skeleton-title-short {
		width: 55%;
	}

	.detail-skeleton-prob {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.5rem 1.25rem 0.75rem;
	}
	.detail-skeleton-prob-row {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.detail-skeleton-pct {
		width: 5rem;
		height: 2.25rem;
	}
	.detail-skeleton-bar {
		width: 100%;
		height: 0.5rem;
		border-radius: var(--r-pill);
	}

	.detail-skeleton-card {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0 1.25rem;
		padding: 1rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
	}
	.detail-skeleton-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.detail-skeleton-eyebrow {
		width: 6rem;
		height: 0.7rem;
		border-radius: var(--r-pill);
	}
	.detail-skeleton-chips {
		width: 8rem;
		height: 1rem;
		border-radius: var(--r-pill);
	}
	.detail-skeleton-chart {
		width: 100%;
		height: 4.5rem;
	}
	.detail-skeleton-line {
		width: 100%;
		height: 0.85rem;
	}
	.detail-skeleton-line-short {
		width: 70%;
	}

	.detail-skeleton-stats {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.625rem;
		margin: 0 1.25rem;
	}
	.detail-skeleton-stat {
		height: 3.25rem;
		border-radius: var(--r-12);
	}
</style>
