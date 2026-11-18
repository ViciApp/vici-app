import { HELLO_EMAIL, INFO_EMAIL, RESOLUTION_EMAIL } from '#lib/constants/contact.constants.ts';
import {
	AVISO_BR,
	AVISO_MX,
	COOKIE,
	IMPRINT,
	PRIVACY,
	TERMS
} from '#lib/constants/legal-docs.constants.ts';
import type { InfoDoc } from '#lib/types/info-doc.ts';

/**
 * Public information documents: Terms, Privacy, Resolution Rules,
 * FAQ, Contact, "How resolution works".
 *
 * The localized help docs (FAQ, Contact, How resolution works, Resolution
 * rules) route their copy through i18n: every block references a
 * `MessageKey` (`info.doc.${slug}.${block}`) resolved per-locale at render
 * time. The full controlling legal docs (Terms and Privacy in turn) carry
 * their English bodies as literal-text constants, kept out of the i18n
 * catalogs by design; see `legal-docs.constants`.
 *
 * Email addresses are real contact identifiers, not translatable copy:
 * they come from `contact.constants`: `mail` blocks carry the constant
 * directly, and paragraphs that mention an address interpolate it via the
 * `{email}` param so the literal never duplicates across locales.
 */

const RESOLUTION_RULES: InfoDoc = {
	slug: 'resolution-rules',
	titleKey: 'info.doc.resolution-rules.title',
	eyebrowKey: 'info.doc.resolution-rules.eyebrow',
	blocks: [
		{ kind: 'lede', key: 'info.doc.resolution-rules.b0' },
		{ kind: 'h', key: 'info.doc.resolution-rules.b1' },
		{ kind: 'p', key: 'info.doc.resolution-rules.b2' },
		{ kind: 'h', key: 'info.doc.resolution-rules.b3' },
		{ kind: 'p', key: 'info.doc.resolution-rules.b4' },
		{ kind: 'h', key: 'info.doc.resolution-rules.b5' },
		{ kind: 'p', key: 'info.doc.resolution-rules.b6' },
		{ kind: 'h', key: 'info.doc.resolution-rules.b7' },
		{ kind: 'p', key: 'info.doc.resolution-rules.b8' },
		{ kind: 'h', key: 'info.doc.resolution-rules.b9' },
		{
			kind: 'list',
			itemKeys: [
				'info.doc.resolution-rules.b10.i0',
				'info.doc.resolution-rules.b10.i1',
				'info.doc.resolution-rules.b10.i2'
			]
		},
		{ kind: 'h', key: 'info.doc.resolution-rules.b11' },
		{ kind: 'p', key: 'info.doc.resolution-rules.b12', params: { email: RESOLUTION_EMAIL } }
	]
};

const HOW_RESOLUTION_WORKS: InfoDoc = {
	slug: 'how-resolution-works',
	titleKey: 'info.doc.how-resolution-works.title',
	eyebrowKey: 'info.doc.how-resolution-works.eyebrow',
	blocks: [
		{ kind: 'lede', key: 'info.doc.how-resolution-works.b0' },
		{ kind: 'h', key: 'info.doc.how-resolution-works.b1' },
		{ kind: 'p', key: 'info.doc.how-resolution-works.b2' },
		{ kind: 'h', key: 'info.doc.how-resolution-works.b3' },
		{
			kind: 'list',
			itemKeys: [
				'info.doc.how-resolution-works.b4.i0',
				'info.doc.how-resolution-works.b4.i1',
				'info.doc.how-resolution-works.b4.i2'
			]
		},
		{ kind: 'h', key: 'info.doc.how-resolution-works.b5' },
		{ kind: 'p', key: 'info.doc.how-resolution-works.b6' },
		{ kind: 'h', key: 'info.doc.how-resolution-works.b7' },
		{ kind: 'p', key: 'info.doc.how-resolution-works.b8' },
		{ kind: 'h', key: 'info.doc.how-resolution-works.b9' },
		{ kind: 'p', key: 'info.doc.how-resolution-works.b10' }
	]
};

const FAQ: InfoDoc = {
	slug: 'faq',
	titleKey: 'info.doc.faq.title',
	eyebrowKey: 'info.doc.faq.eyebrow',
	blocks: [
		{ kind: 'lede', key: 'info.doc.faq.b0' },
		{ kind: 'h', key: 'info.doc.faq.b1' },
		{ kind: 'p', key: 'info.doc.faq.b2' },
		{ kind: 'p', key: 'info.doc.faq.b3' },
		{ kind: 'h', key: 'info.doc.faq.b4' },
		{ kind: 'p', key: 'info.doc.faq.b5' },
		{ kind: 'h', key: 'info.doc.faq.b6' },
		{ kind: 'p', key: 'info.doc.faq.b7' },
		{ kind: 'h', key: 'info.doc.faq.b8' },
		{ kind: 'p', key: 'info.doc.faq.b9' },
		{ kind: 'h', key: 'info.doc.faq.b10' },
		{ kind: 'p', key: 'info.doc.faq.b11' },
		{ kind: 'h', key: 'info.doc.faq.b12' },
		{ kind: 'p', key: 'info.doc.faq.b13' },
		{ kind: 'h', key: 'info.doc.faq.b14' },
		{ kind: 'p', key: 'info.doc.faq.b15' },
		{ kind: 'h', key: 'info.doc.faq.b16' },
		{ kind: 'p', key: 'info.doc.faq.b17' },
		{ kind: 'h', key: 'info.doc.faq.b18' },
		{ kind: 'p', key: 'info.doc.faq.b19' }
	]
};

const CONTACT: InfoDoc = {
	slug: 'contact',
	titleKey: 'info.doc.contact.title',
	eyebrowKey: 'info.doc.contact.eyebrow',
	blocks: [
		{ kind: 'lede', key: 'info.doc.contact.b0' },
		{ kind: 'h', key: 'info.doc.contact.b1' },
		{ kind: 'mail', text: INFO_EMAIL },
		{ kind: 'h', key: 'info.doc.contact.b3' },
		{ kind: 'p', key: 'info.doc.contact.b4' },
		{ kind: 'h', key: 'info.doc.contact.b5' },
		{
			kind: 'list',
			itemKeys: ['info.doc.contact.b6.i0', 'info.doc.contact.b6.i1', 'info.doc.contact.b6.i2']
		},
		{ kind: 'h', key: 'info.doc.contact.b7' },
		{ kind: 'mail', text: HELLO_EMAIL }
	]
};

/**
 * Full doc registry, keyed by slug. The `Legal · …` eyebrow lines mark
 * documents that must clear legal review before launch.
 */
export const INFO_DOCS: Readonly<Record<string, InfoDoc>> = Object.freeze({
	terms: TERMS,
	privacy: PRIVACY,
	cookies: COOKIE,
	imprint: IMPRINT,
	aviso: AVISO_MX,
	'aviso-br': AVISO_BR,
	'resolution-rules': RESOLUTION_RULES,
	'how-resolution-works': HOW_RESOLUTION_WORKS,
	faq: FAQ,
	contact: CONTACT
});
