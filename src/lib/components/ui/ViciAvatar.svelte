<script lang="ts">
	/**
	 * Faceted front-facing portrait. The look is described by a `parts`
	 * object (skin / hair / hairStyle / expr / trait / shirt / bg) and
	 * renders to a self-contained SVG string. Two ways to feed it:
	 *
	 *   - pass `parts` directly (the logged-in user's persisted picks); or
	 *   - pass a `seed` string and the face is derived deterministically
	 *     from it (everyone who isn't the logged-in user, seeded by their
	 *     immutable principal, and the decorative social-proof stacks).
	 *
	 * Pure, client-only, no backend and no network. The idle motion (blink +
	 * gentle bob) is gated behind `prefers-reduced-motion`: a reduced-motion
	 * user gets the exact same portrait, rendered static.
	 */

	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';
	import {
		deterministicParts,
		renderAvatarSvg,
		type ViciAvatarParts
	} from '#lib/utils/vici-avatar.utils.ts';

	interface Props {
		/** Explicit parts object. Wins over `seed` when both are set. */
		parts?: ViciAvatarParts | null;
		/** Seed string the face is derived from when no `parts` are given. */
		seed?: string;
		/** Rendered diameter in pixels. */
		size?: number;
		/** Draw the circular gold frame ring. */
		frame?: boolean;
		/** Draw the gold signature circle + wordmark. */
		signature?: boolean;
		/** Draw the decorative backdrop flourishes (lower-left dot + gold
		 *  signature disc). Off lets an overlay surface keep the backdrop
		 *  clean behind its own controls. */
		decor?: boolean;
		/** Skip the backdrop entirely so the figure sits on a caller-supplied
		 *  surface (e.g. the profile hero's palette gradient). */
		noBg?: boolean;
		/** Whether idle motion is desired. Always re-gated behind
		 *  `prefers-reduced-motion`; passing `true` never overrides a
		 *  reduced-motion preference. */
		animate?: boolean;
		/** Extra classes forwarded to the wrapper. */
		class?: string;
	}

	const {
		parts,
		seed = 'you',
		size = 28,
		frame = true,
		signature = false,
		decor = true,
		noBg = false,
		animate = false,
		class: className = ''
	}: Props = $props();

	const resolvedParts = $derived(parts ?? deterministicParts(seed));

	// Motion is opt-in by the caller AND only ever runs when the user has
	// not asked for reduced motion. A reduced-motion user always gets the
	// static portrait: same geometry, no blink / bob.
	const motion = $derived(animate && !prefersReducedMotion());

	const svg = $derived(
		renderAvatarSvg({
			parts: resolvedParts,
			size,
			options: { animate: motion, frame, signature, decor, noBg }
		})
	);
</script>

<!-- Decorative artwork; the {@html} payload is a self-generated SVG
	 string with no user-supplied markup. -->
<span
	style:width="{size}px"
	style:height="{size}px"
	class="vici-avatar {className}"
	aria-hidden="true"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html svg}
</span>

<style lang="postcss">
	.vici-avatar {
		display: inline-flex;
		line-height: 0;
		overflow: hidden;
	}

	.vici-avatar :global(svg) {
		display: block;
	}

	/* Idle motion. The renderer only emits the `va-bob` / `va-blink` classes
	   when motion is allowed, so these keyframes never run for a
	   reduced-motion user (belt-and-braces media query below as well). */
	.vici-avatar :global(.va-bob) {
		animation: vici-avatar-bob 3.4s ease-in-out infinite;
		transform-box: fill-box;
		transform-origin: center;
	}

	.vici-avatar :global(.va-blink) {
		animation: vici-avatar-blink 6s ease-in-out infinite;
		transform-box: fill-box;
	}

	@keyframes vici-avatar-bob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-2px);
		}
	}

	@keyframes vici-avatar-blink {
		0%,
		92%,
		100% {
			transform: scaleY(1);
		}
		95% {
			transform: scaleY(0.1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.vici-avatar :global(.va-bob),
		.vici-avatar :global(.va-blink) {
			animation: none;
		}
	}
</style>
