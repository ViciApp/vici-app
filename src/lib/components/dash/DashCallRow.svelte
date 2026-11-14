<script lang="ts">
	/**
	 * A single call row in the Calls zone; a status dot, the market question,
	 * an optional side chip + context line, and an end value (live timer or
	 * settled VXP delta). Renders a `<button>` when an `onClick` is supplied;
	 * otherwise a static `<div>` so a resolved call with no live market doesn't
	 * masquerade as tappable.
	 */
	interface Props {
		/** Status dot: pending (open), won, or lost. */
		dot: 'pending' | 'won' | 'lost';
		/** Market question / title. */
		question: string;
		/** Optional YES/NO side chip. */
		side?: 'YES' | 'NO';
		/** Context line (category, time-ago, crowd %, …). */
		context: string;
		/** End-of-row text (timer for open, signed VXP for resolved). */
		end: string;
		/** Tint for the end text: win / loss / neutral (default). */
		endTone?: 'win' | 'loss';
		onClick?: () => void;
	}

	let { dot, question, side, context, end, endTone, onClick }: Props = $props();
</script>

{#snippet inner()}
	<span class="db-cdot {dot}"></span>
	<div class="db-mid">
		<div class="db-q">{question}</div>
		<div class="db-ctx">
			{#if side}
				<span class="db-side {side.toLowerCase()}">{side}</span>
			{/if}
			<span>{context}</span>
		</div>
	</div>
	<div class="db-end" class:loss={endTone === 'loss'} class:win={endTone === 'win'}>{end}</div>
{/snippet}

{#if onClick}
	<button class="db-crow" onclick={onClick} type="button">
		{@render inner()}
	</button>
{:else}
	<div class="db-crow db-static">
		{@render inner()}
	</div>
{/if}
