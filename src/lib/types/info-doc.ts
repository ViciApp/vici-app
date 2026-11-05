import type { MessageKey } from '#lib/utils/i18n.utils.ts';

/**
 * Lightweight document model for the public `/info/[slug]` routes —
 * Terms, Privacy, Resolution Rules, FAQ, Contact, How resolution works.
 *
 * Block-based on purpose: legal / help copy iterates across sections of
 * heading + paragraph + list, and storing them as structured data (vs.
 * a raw HTML string) keeps each block consistently styled by the renderer
 * across documents.
 *
 * Each text-bearing block, and the doc title / eyebrow, accepts EITHER an
 * i18n key OR a literal string:
 *
 *  - **Keyed copy** (`key` / `itemKeys` / `titleKey` / `eyebrowKey`) is the
 *    localized help docs (FAQ, Contact, How resolution works, Resolution
 *    rules) — referenced by `MessageKey` and resolved per-locale at render
 *    time via `t(...)`, so it mirrors across every live catalog.
 *  - **Literal copy** (`text` / `items` / `title` / `eyebrow`) carries the
 *    full English controlling text of the legal docs (Terms, Privacy). Legal
 *    bodies are kept out of the i18n catalogs by design — the live locales
 *    must mirror `en.ts` exactly and only English exists for these — so they
 *    live as literal-text constants instead.
 *
 * Contact addresses are never translatable copy: `mail` block text and the
 * `{email}` params some paragraphs interpolate come from `contact.constants`.
 *
 * `link` and `badge` are always-literal blocks for external references in
 * the legal docs: `link` is an outbound URL with display text, `badge` a
 * linked certification image (e.g. the GDPR-representative verification
 * badge); both open in a new tab. A badge carries the artwork's intrinsic
 * pixel dimensions so the reserved box matches its aspect ratio while the
 * lazily-loaded image is still in flight.
 */

export type InfoDocBlock =
	| ({ kind: 'lede' } & ({ key: MessageKey } | { text: string }))
	| ({ kind: 'h' } & ({ key: MessageKey } | { text: string }))
	| ({ kind: 'p' } & (
			{ key: MessageKey; params?: Record<string, string | number> } | { text: string }
	  ))
	| { kind: 'list'; itemKeys: MessageKey[] }
	| { kind: 'list'; items: string[] }
	| { kind: 'mail'; text: string }
	| { kind: 'link'; text: string; href: string }
	| { kind: 'badge'; src: string; alt: string; href: string; width: number; height: number };

/** Header title (also the page `<title>`) — keyed for help docs, literal for legal. */
type TitleSource = { titleKey: MessageKey } | { title: string };
/** Eyebrow line above the title — keyed for help docs, literal for legal. */
type EyebrowSource = { eyebrowKey: MessageKey } | { eyebrow: string };

export type InfoDoc = { slug: string; blocks: InfoDocBlock[] } & TitleSource & EyebrowSource;
