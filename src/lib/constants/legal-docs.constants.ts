import { INFO_EMAIL } from '#lib/constants/contact.constants.ts';
import type { InfoDoc } from '#lib/types/info-doc.ts';

/**
 * Full controlling legal documents — Terms of Service (Privacy and the
 * other long-form legal docs follow the same shape).
 *
 * Legal bodies are stored as literal English text, NOT i18n keys. The
 * live locale catalogs must mirror `en.ts` exactly and only the English
 * controlling version exists for these documents, so the full bodies are
 * kept out of the i18n catalogs by design and carried here as literal
 * `text` / `items` blocks (and literal `title` / `eyebrow`). Localized
 * help docs (FAQ, Contact, How resolution works, Resolution rules) stay
 * keyed in `info-docs.constants`.
 *
 * Contact addresses are real identifiers, not translatable copy: they
 * come from `contact.constants`. Where an address stands alone as a
 * contact line it is a dedicated `mail` block; where it is embedded
 * mid-sentence it is interpolated inline from the constant.
 */

/**
 * Appointed EU and UK GDPR representative (Art. 27): Euverify Ltd. The
 * details below are the representative's own published contact identifiers
 * (not ours, so they don't route through `contact.constants`), shared
 * between the Privacy Policy riders and the Legal notice so the two pages
 * can never drift apart. The portal URL is Euverify's verification page
 * for our appointment, which doubles as the DSAR submission channel; the
 * badge artwork is vendored under `static/badges/` so the privacy page
 * never makes a third-party image request.
 */
const GDPR_REP_EMAIL = 'gdpr@euverify.com';
const GDPR_REP_EU_NAME = 'Euverify Ltd (Ireland)';
const GDPR_REP_EU_ADDRESS =
	'Unit 3D North Point House, North Point Business Park, New Mallow Road, Cork, T23 AT2P, Ireland';
const GDPR_REP_UK_NAME = 'Euverify Ltd (UK)';
const GDPR_REP_UK_ADDRESS = '3rd Floor, 86-90 Paul Street, London, EC2A 4NE, United Kingdom';
const GDPR_REP_PORTAL_URL = 'https://gdpr.euverify.com/verify/96ec5aca-dcec-4bb2-9546-1e1e8ffad550';
const GDPR_REP_BADGE_SRC = '/badges/gdpr-euverify.png';
const GDPR_REP_BADGE_ALT = 'GDPR Representative, certified by Euverify';
const GDPR_REP_BADGE_WIDTH = 1236;
const GDPR_REP_BADGE_HEIGHT = 670;

export const TERMS: InfoDoc = {
	slug: 'terms',
	title: 'Terms of Service',
	eyebrow: 'Legal · Effective 10 June 2026',
	blocks: [
		{ kind: 'p', text: 'Last updated: 10 June 2026' },
		{ kind: 'h', text: '1. Who we are and what these Terms cover' },
		{
			kind: 'lede',
			text: 'Vici ("Vici", "we", "us", "our") is operated by Wholesome Capital Limited, a private company limited by shares incorporated in Hong Kong SAR (Business Registration Number 2391347).'
		},
		{
			kind: 'p',
			text: 'These Terms of Service ("Terms") govern your access to and use of Vici at vici.market and our applications (together, the "Service"). By accessing or using the Service, you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the Service.'
		},
		{ kind: 'h', text: '2. Eligibility' },
		{
			kind: 'p',
			text: 'You must be at least 18 years old to use the Service, and you confirm that you are when you use it. The Service is offered only where it is lawful. It is void where prohibited, and you are responsible for ensuring that your use of the Service is legal in your location.'
		},
		{ kind: 'h', text: '3. Your account' },
		{
			kind: 'p',
			text: 'To use most features you create an account. You agree to provide accurate information, to keep your credentials secure, and to be responsible for activity under your account. You may hold only one account unless we agree otherwise. We may suspend or close accounts that breach these Terms or that we reasonably believe are being used for fraud, manipulation or abuse.'
		},
		{ kind: 'h', text: '4. Nature of the Service — please read' },
		{
			kind: 'p',
			text: 'The Service is a free-to-play prediction game for entertainment only. This Section is fundamental to these Terms.'
		},
		{
			kind: 'list',
			items: [
				'No monetary value. "VXP" and any other points, currencies, badges or items within the Service (together, "Virtual Items") have no monetary value. They are not money, credit, cryptocurrency, securities or property.',
				'No purchase, no payout. Virtual Items cannot be purchased, sold, traded, transferred, gifted, withdrawn, redeemed or exchanged for money, cryptocurrency, goods, prizes or anything of value, whether on the Service or elsewhere. There is nothing to buy in order to play.',
				'No gambling. The Service does not offer real-money wagering, betting or gambling of any kind. Because no consideration is staked and no prize of value is awarded, the Service is not gambling.',
				'Not a regulated market. The Service is not a securities exchange, a commodities or derivatives market, a real-money prediction market, or any other regulated financial venue, and is not supervised as one.',
				'Not advice. Predictions, odds, scores and any information shown in the Service are for entertainment only and are not financial, investment, legal, betting or other professional advice. Do not rely on them.'
			]
		},
		{ kind: 'h', text: '5. Virtual Items (VXP)' },
		{
			kind: 'p',
			text: 'Virtual Items are licensed, not sold or owned. We grant you a limited, personal, non-transferable, revocable licence to use Virtual Items within the Service for entertainment. You acquire no property, ownership or monetary right in them.'
		},
		{
			kind: 'p',
			text: 'We may create, manage, adjust, reset, reduce, expire or remove Virtual Items, and may change how they work or discontinue them, at any time, without liability and without owing you any payment or compensation, subject to applicable mandatory law. Virtual Items you hold confer no entitlement against us.'
		},
		{ kind: 'h', text: '6. Acceptable use' },
		{ kind: 'p', text: 'You agree not to:' },
		{
			kind: 'list',
			items: [
				'cheat, manipulate outcomes or leaderboards, exploit bugs, or use bots, scripts or automated means to interact with the Service;',
				"operate multiple or fake accounts, or interfere with other users' fair use;",
				'reverse engineer, scrape, copy, resell or commercially exploit the Service except as allowed by law;',
				'upload unlawful, infringing, harmful, deceptive or abusive content; or',
				'use the Service in violation of any applicable law, including your local law (Section 2).'
			]
		},
		{
			kind: 'p',
			text: 'We may remove content, and suspend or terminate access, for breach of this Section.'
		},
		{ kind: 'h', text: '7. Your content' },
		{
			kind: 'p',
			text: 'You may submit content such as predictions, a display name and profile details ("Your Content"). You keep any rights you have in Your Content. You grant us a worldwide, non-exclusive, royalty-free licence to host, store, display and use Your Content to operate and promote the Service. You are responsible for Your Content and confirm you have the right to submit it. We may moderate, remove or refuse content at our discretion, consistent with applicable law.'
		},
		{ kind: 'h', text: '8. Intellectual property' },
		{
			kind: 'p',
			text: 'The Service, including its software, prediction cards, designs, text, graphics, the Vici name and brand, and the badge/character system, is owned by us or our licensors and protected by intellectual property laws. We grant you a limited, personal, non-transferable, revocable licence to use the Service for its intended purpose. You may not use our brand or content without our prior written permission, except as permitted by law.'
		},
		{ kind: 'h', text: '9. Advertising and third parties' },
		{
			kind: 'p',
			text: 'The Service is supported in part by advertising and may contain links to or content from third parties. Third-party services are governed by their own terms and privacy practices, and we are not responsible for them. How advertising data is handled is described in the Privacy Policy (Sections 6 and 13), including consent controls for users in the EU/EEA and UK.'
		},
		{ kind: 'h', text: '10. Infrastructure and availability' },
		{
			kind: 'p',
			text: 'The Service runs on the Internet Computer Protocol, a decentralised public network (see Privacy Policy Section 5). We aim to keep the Service available but do not guarantee uninterrupted or error-free operation, and availability may depend on networks and infrastructure outside our control. We may modify, suspend or discontinue any part of the Service at any time.'
		},
		{ kind: 'h', text: '11. Disclaimers' },
		{
			kind: 'p',
			text: 'To the maximum extent permitted by law, the Service is provided "as is" and "as available", without warranties of any kind, whether express or implied, including fitness for a particular purpose, accuracy, and non-infringement. We do not warrant that the Service will be uninterrupted, secure, or error-free, or that outcomes, scores or information shown are accurate or timely. Nothing in these Terms excludes any warranty or right that cannot be excluded under applicable mandatory law.'
		},
		{ kind: 'h', text: '12. Limitation of liability' },
		{
			kind: 'p',
			text: 'To the maximum extent permitted by law, we will not be liable for any indirect, incidental, special, consequential or punitive damages, or for any loss of data, profits or goodwill, arising from or related to your use of the Service. Because the Service is free and Virtual Items have no monetary value, our total aggregate liability to you for any claim relating to the Service is limited to the amount you paid us in the 12 months before the claim, which is normally zero. Nothing here limits liability that cannot be limited under applicable mandatory law, including, where applicable, consumer rights.'
		},
		{ kind: 'h', text: '13. Indemnity' },
		{
			kind: 'p',
			text: 'To the extent permitted by law, you agree to indemnify us against claims, losses and costs arising from your breach of these Terms, your misuse of the Service, or Your Content.'
		},
		{ kind: 'h', text: '14. Suspension and termination' },
		{
			kind: 'p',
			text: 'You may stop using the Service at any time. We may suspend or terminate your access if you breach these Terms or where we reasonably need to for legal, security or operational reasons. Sections that by their nature should survive termination (including Sections 4, 5, 8, 11, 12, 13 and 16) survive.'
		},
		{ kind: 'h', text: '15. Changes' },
		{
			kind: 'p',
			text: 'We may update the Service and these Terms from time to time. For material changes to the Terms we will take reasonable steps to notify you and will update the "Last updated" date. Continued use after changes take effect means you accept the updated Terms, except where applicable law requires fresh consent.'
		},
		{ kind: 'h', text: '16. Governing law and disputes' },
		{
			kind: 'p',
			text: 'These Terms are governed by the laws of Hong Kong SAR, and the courts of Hong Kong have jurisdiction, except that this does not deprive you of the protection of mandatory consumer-protection rules, or the right to bring proceedings, that apply in your country of residence and cannot be contracted out of.'
		},
		{ kind: 'h', text: '17. General' },
		{
			kind: 'p',
			text: 'If any provision is held unenforceable, the rest remains in effect. Our failure to enforce a provision is not a waiver. You may not assign these Terms; we may assign them to an affiliate or successor. These Terms and the Privacy Policy are the entire agreement between you and us regarding the Service.'
		},
		{ kind: 'h', text: '18. Contact' },
		{
			kind: 'p',
			text: `Wholesome Capital Limited Unit 2505, 25/F., Billion Plaza, 8 Cheung Yue Street, Lai Chi Kok, Kowloon, Hong Kong Email: ${INFO_EMAIL}`
		},
		{ kind: 'h', text: 'Schedule A — United States' },
		{
			kind: 'p',
			text: 'For users in the United States: the Service is a free-to-play game with no monetary value (Sections 4 and 5). It offers no real-money play, no purchase, and no payout, and is not a licensed gambling operator, a sweepstakes, or a regulated prediction or derivatives market. The Service is void where prohibited; you are responsible for compliance with the law of your state.'
		}
	]
};

export const PRIVACY: InfoDoc = {
	slug: 'privacy',
	title: 'Privacy Policy',
	eyebrow: 'Legal · Effective 10 June 2026',
	blocks: [
		{ kind: 'p', text: 'Last updated: 20 August 2026' },
		{ kind: 'h', text: '1. Who we are' },
		{
			kind: 'lede',
			text: 'Vici ("Vici", "we", "us", "our") is operated by Wholesome Capital Limited, a private company limited by shares incorporated in Hong Kong SAR, Business Registration Number 2391347.'
		},
		{
			kind: 'p',
			text: 'We are the controller of the personal data described in this policy — meaning we decide why and how it is processed. Because Vici runs on a decentralised network (see Section 5), there is no separate hosting company acting as our processor; we alone are responsible for your data.'
		},
		{
			kind: 'p',
			text: `For any privacy question or to exercise your rights, contact us at ${INFO_EMAIL}.`
		},
		{ kind: 'h', text: '2. Nature of the service, availability and age' },
		{
			kind: 'p',
			text: 'Nature of the service. Vici is a free-to-play prediction game provided for entertainment only. VXP and any other in-game points or currencies have no monetary value, cannot be purchased, sold, transferred, exchanged, withdrawn or redeemed for money, cryptocurrency, prizes or anything of value, and exist solely within the game. Vici does not offer real-money wagering, betting, gambling, or the trading of financial instruments, and predictions made in Vici are for entertainment and are not financial, investment or betting advice.'
		},
		{
			kind: 'p',
			text: 'Availability. Vici is available globally to eligible users. The service is offered only where it is lawful; it is void where prohibited, and you are responsible for ensuring your use of Vici is legal in your location.'
		},
		{
			kind: 'p',
			text: 'Age. You must be at least 18 years old to use Vici. We do not knowingly collect personal data from anyone under 18; if we learn that we have, we will delete it.'
		},
		{ kind: 'h', text: '3. What personal data we collect' },
		{
			kind: 'p',
			text: 'We collect only what we need to run the game and improve it. Depending on how you use Vici, this may include:'
		},
		{
			kind: 'list',
			items: [
				'Account and identity data — the identifier you sign in with and any profile details you choose to add (e.g. display name). You can sign in with Google, Apple, or a passkey. When you use Google or Apple, we receive a limited set of identity data from them (such as a unique identifier and, depending on your settings, your name and email; Apple may provide a private relay email). Passkeys use device-based cryptography and do not involve a third-party identity provider.',
				'Prediction and gameplay data — the predictions you make, your stakes, your VXP balance and history, accuracy and outcomes, and other in-game activity. This is core to providing the service and to leaderboards.',
				'Device and usage data — basic technical information such as device type, browser, approximate region (derived from IP), and how you interact with the app, collected for analytics and security.',
				'Communications — if you contact us, the content of that correspondence and the address you used.',
				'Advertising and attribution data — see Section 6.'
			]
		},
		{
			kind: 'p',
			text: 'We do not collect real-money payment information, because there is nothing to purchase.'
		},
		{ kind: 'h', text: '4. Why we use your data, and on what basis' },
		{
			kind: 'p',
			text: 'We apply the following protections to all users, worldwide, as our baseline standard:'
		},
		{
			kind: 'list',
			items: [
				'Create and operate your account; provide the game, predictions, VXP and leaderboards — Necessary to provide the service you requested',
				'Keep the service secure and prevent abuse or fraud — Our legitimate interest in a safe, fair product',
				'Understand and improve how the product is used — Our legitimate interest in improving the service; analytics configured to minimise data (Section 5)',
				'Show and measure advertising — Consent where required; otherwise legitimate interest — see Section 6',
				'Respond to your messages — Necessary to handle your request',
				'Comply with legal obligations — Legal obligation'
			]
		},
		{
			kind: 'p',
			text: 'Where your local law requires your consent for a specific use (for example advertising cookies or tracking for users in the EU/EEA and UK), we ask for it first and you can withdraw it at any time. See Sections 6 and 13.'
		},
		{ kind: 'h', text: '5. Where your data is stored (hosting and data location)' },
		{
			kind: 'p',
			text: "Vici runs on the Internet Computer Protocol (ICP), a decentralised public network, using the Juno platform. Our application data and analytics data are hosted on ICP's European subnet, which is composed exclusively of nodes located within Europe. As a result, the personal data in our containers is stored and replicated only on nodes inside the European region."
		},
		{
			kind: 'p',
			text: 'We are the sole controller of these containers and the data in them. The Internet Computer supports data mutability and deletion, which means we are able to amend or erase your personal data on request and to give effect to the rights described in Section 11.'
		},
		{ kind: 'h', text: '6. Advertising and attribution' },
		{
			kind: 'p',
			text: 'Vici is supported in part by advertising. Where we integrate third-party advertising, attribution or measurement technologies, those providers act as separate controllers or processors and may receive certain device and usage data. Data handled by those third parties is governed by their own terms and may be processed outside the European region — it does not stay within the ICP European subnet described in Section 5.'
		},
		{
			kind: 'p',
			text: 'For users in the EU/EEA and the UK, non-essential advertising and tracking technologies are loaded only after you consent (see Section 13); you can change or withdraw consent at any time.'
		},
		{
			kind: 'p',
			text: 'We will name the advertising and attribution partners we actually use here, describe what they receive, and provide opt-out or consent controls.'
		},
		{ kind: 'h', text: '7. Who we share your data with' },
		{ kind: 'p', text: 'We keep sharing to a minimum. We may share data with:' },
		{
			kind: 'list',
			items: [
				'Authentication providers — Google and Apple, when you choose to sign in with them; they act as independent providers under their own privacy policies, and the sign-in step is processed on their (US-based) infrastructure. Passkey sign-in does not involve a third-party provider.',
				'Advertising and attribution partners, as described in Section 6, where applicable.',
				'Authorities or third parties where we are legally required to, or to protect the rights, safety and integrity of Vici and its users.'
			]
		},
		{ kind: 'p', text: 'We do not sell your personal data for money.' },
		{ kind: 'h', text: '8. International data transfers' },
		{
			kind: 'p',
			text: 'Because our data is hosted in the European region (Section 5), if you use Vici from outside Europe your data is transferred to the European region for storage. The EU/EEA is widely recognised as providing a high standard of data protection, so transfers in this direction are generally permitted under the laws of the markets we serve. Where your local law requires specific safeguards or disclosures, we comply with them.'
		},
		{ kind: 'h', text: '9. How long we keep your data' },
		{
			kind: 'p',
			text: 'We keep your personal data only for as long as needed to provide the service and for the purposes set out above, after which it is deleted or anonymised.'
		},
		{ kind: 'h', text: '10. How we protect your data' },
		{
			kind: 'p',
			text: 'We use appropriate technical and organisational measures to protect your personal data against loss, misuse and unauthorised access. No system is perfectly secure, but we take reasonable steps to keep your data safe and to respond to any incident appropriately.'
		},
		{ kind: 'h', text: '11. Your rights' },
		{
			kind: 'p',
			text: 'We extend the following rights to all users as our baseline, subject to your local law:'
		},
		{
			kind: 'list',
			items: [
				'Access — confirmation of whether we process your data and a copy of it.',
				'Rectification — correct inaccurate or incomplete data.',
				'Erasure — ask us to delete your data.',
				'Restriction — ask us to limit how we use your data.',
				'Portability — receive your data in a portable format.',
				'Objection — object to certain processing, including profiling for our legitimate interests.',
				'Withdraw consent — where we rely on consent, withdraw it at any time without affecting prior processing.'
			]
		},
		{
			kind: 'p',
			text: `To exercise any of these, contact ${INFO_EMAIL}. We respond within the time your local law requires. You may also have the right to complain to your local data protection authority (see the relevant regional rider).`
		},
		{ kind: 'h', text: '12. Children and age' },
		{
			kind: 'p',
			text: 'Vici is intended for adults and restricted to users aged 18 and over. We do not knowingly collect personal data from anyone under 18; if we become aware that we have, we will delete it as soon as possible.'
		},
		{ kind: 'h', text: '13. Cookies, consent and similar technologies' },
		{
			kind: 'p',
			text: 'We use a limited set of cookies and similar technologies for sign-in, security and analytics, and — subject to consent where required — for advertising.'
		},
		{
			kind: 'p',
			text: 'For users in the EU/EEA and the UK, non-essential cookies and tracking technologies are deployed only after you give consent through our consent banner, and you can change or withdraw that consent at any time.'
		},
		{ kind: 'h', text: '14. Changes to this policy' },
		{
			kind: 'p',
			text: 'We may update this policy from time to time. When we do, we will revise the "Last updated" date above and, for material changes, take reasonable steps to notify you.'
		},
		{ kind: 'h', text: '15. Contact us' },
		{
			kind: 'p',
			text: `Wholesome Capital Limited Unit 2505, 25/F., Billion Plaza, 8 Cheung Yue Street, Lai Chi Kok, Kowloon, Hong Kong Email: ${INFO_EMAIL}`
		},
		{ kind: 'h', text: 'Regional riders' },
		{ kind: 'h', text: 'A. European Union / EEA' },
		{
			kind: 'p',
			text: 'If you are in the EU/EEA, the GDPR applies to the processing of your personal data and you have the full rights set out in Section 11, plus the right to complain to your local supervisory authority.'
		},
		{
			kind: 'list',
			items: [
				`EU representative (GDPR Art. 27). We have appointed ${GDPR_REP_EU_NAME} as our representative in the EU: ${GDPR_REP_EU_ADDRESS}. Email: ${GDPR_REP_EMAIL}.`,
				'Consent. Advertising/tracking technologies are consent-gated for EU/EEA users (Sections 6 and 13).'
			]
		},
		{
			kind: 'p',
			text: 'To submit a Data Subject Access Request (DSAR), a data deletion request, or any other GDPR-related inquiry, and to verify our appointed representative, use the secure portal below. Requests submitted through the portal are logged and tracked to ensure a timely response.'
		},
		{
			kind: 'link',
			text: 'Verify our representative & submit GDPR requests',
			href: GDPR_REP_PORTAL_URL
		},
		{
			kind: 'badge',
			src: GDPR_REP_BADGE_SRC,
			alt: GDPR_REP_BADGE_ALT,
			href: GDPR_REP_PORTAL_URL,
			width: GDPR_REP_BADGE_WIDTH,
			height: GDPR_REP_BADGE_HEIGHT
		},
		{ kind: 'h', text: 'B. United Kingdom' },
		{
			kind: 'p',
			text: "If you are in the UK, the UK GDPR and Data Protection Act 2018 apply; you have the full rights in Section 11 and may complain to the Information Commissioner's Office (ICO)."
		},
		{
			kind: 'list',
			items: [
				`UK representative (UK GDPR Art. 27). We have appointed ${GDPR_REP_UK_NAME} as our representative in the UK: ${GDPR_REP_UK_ADDRESS}. Email: ${GDPR_REP_EMAIL}.`
			]
		},
		{
			kind: 'p',
			text: 'UK GDPR requests can be submitted, and the appointment verified, through the same secure portal linked under Rider A.'
		},
		{ kind: 'h', text: 'C. Brazil (LGPD)' },
		{
			kind: 'p',
			text: 'If you are in Brazil, the Lei Geral de Proteção de Dados (LGPD) applies. You have the rights to confirmation of processing and access; to correct incomplete, inaccurate or out-of-date data; to anonymise, block or delete unnecessary or excessive data or data not processed in line with the LGPD; to portability; to delete data processed with your consent; to information about the public and private bodies we share data with; to information about the consequences of refusing consent; and to withdraw consent. You may exercise these by contacting us (Section 15) and may also petition the national authority, the Autoridade Nacional de Proteção de Dados (ANPD).'
		},
		{
			kind: 'p',
			text: 'Legal bases. We process your personal data on the bases set out in Article 7 of the LGPD — principally the provision of a service you requested, our legitimate interests in operating and securing the service, compliance with legal obligations, and, for advertising and other non-essential purposes, your consent. The data, purposes and bases are described in Sections 3 to 6.'
		},
		{
			kind: 'p',
			text: 'Data Protection Officer (Encarregado). We will appoint a data protection officer (encarregado) for Brazil and publish their contact details here; until then, you can reach us about your personal data at the contact in Section 15.'
		},
		{
			kind: 'p',
			text: 'Children and adolescents. Vici is restricted to users aged 18 and over (Section 12), and we do not knowingly process the personal data of children or adolescents.'
		},
		{ kind: 'h', text: 'D. Mexico (LFPDPPP)' },
		{
			kind: 'p',
			text: 'If you are in Mexico, the Federal Law on the Protection of Personal Data Held by Private Parties applies. Mexico requires a privacy notice (Aviso de Privacidad) to be made available at or before the moment your data is collected, identifying the controller, the data collected, the purposes (distinguishing those that need consent from those that do not), and the legal basis. You hold ARCO rights — Access, Rectification, Cancellation and Opposition. A standalone Aviso de Privacidad in Spanish is published separately.'
		},
		{ kind: 'h', text: 'E. Nigeria (NDPA 2023) and Indonesia (PDP Law)' },
		{
			kind: 'p',
			text: 'If you are in Nigeria, the Nigeria Data Protection Act applies; if you are in Indonesia, the Personal Data Protection Law applies. In both, you have rights broadly comparable to Section 11.'
		},
		{ kind: 'h', text: 'F. United States' },
		{
			kind: 'p',
			text: 'Vici is made available to users in the United States as a free-to-play game with no monetary value (see Section 2, "Nature of the service"). Vici is not a licensed gambling operator, a sweepstakes promotion, or a regulated prediction/derivatives market, and offers no real-money play, purchase, or payout.'
		},
		{
			kind: 'p',
			text: `Where applicable, US state privacy laws (such as the California Consumer Privacy Act) give you rights to access, delete, correct and opt out of the "sale" or "sharing" of your personal data; to exercise them, contact ${INFO_EMAIL}.`
		}
	]
};

export const COOKIE: InfoDoc = {
	slug: 'cookies',
	title: 'Cookie Policy',
	eyebrow: 'Legal · Effective 10 June 2026',
	blocks: [
		{ kind: 'p', text: 'Last updated: 10 June 2026' },
		{ kind: 'h', text: '1. What this policy covers' },
		{
			kind: 'lede',
			text: 'This Cookie Policy explains how Vici, operated by Wholesome Capital Limited (see Legal Notice), uses cookies and similar technologies (such as local storage and SDKs) on vici.market and our applications. It should be read together with our Privacy Policy.'
		},
		{ kind: 'h', text: '2. The categories we use' },
		{
			kind: 'list',
			items: [
				'Strictly necessary — required to run the Service: sign-in, session, security and fraud prevention. These are always active and do not require consent.',
				'Analytics — help us understand and improve how the Service is used.',
				'Advertising and attribution — used by third-party partners to show and measure ads and to attribute installs. These may share device and usage data with those partners. See Privacy Policy Section 6.'
			]
		},
		{ kind: 'h', text: '3. Consent' },
		{
			kind: 'p',
			text: 'For users in the EU/EEA and the United Kingdom, non-essential cookies and similar technologies (analytics where applicable, and all advertising/attribution technologies) are set only after you give consent through our consent banner. You can accept, reject, or choose categories, and you can change or withdraw your choice at any time via "Cookie Settings". Strictly necessary technologies are not affected.'
		},
		{
			kind: 'p',
			text: 'For users in other regions, we use cookies as described here and provide controls required by local law (for example, opt-outs for US users — see "Your Privacy Choices").'
		},
		{ kind: 'h', text: '4. The cookies we use' },
		{
			kind: 'p',
			text: 'A detailed list of the specific cookies and similar technologies we use — their provider, category, purpose and duration — will be published here.'
		},
		{ kind: 'h', text: '5. Managing cookies' },
		{
			kind: 'p',
			text: 'You can manage non-essential cookies any time through Cookie Settings in the footer. You can also control cookies through your browser or device settings, though disabling strictly necessary cookies may break parts of the Service.'
		},
		{ kind: 'h', text: '6. Changes and contact' },
		{
			kind: 'p',
			text: `We may update this policy; we will revise the "Last updated" date for material changes. Questions: ${INFO_EMAIL}.`
		}
	]
};

export const IMPRINT: InfoDoc = {
	slug: 'imprint',
	title: 'Legal notice',
	eyebrow: 'Legal · Imprint',
	blocks: [
		{ kind: 'lede', text: 'Provider information under applicable disclosure requirements.' },
		{ kind: 'h', text: 'Provider' },
		{ kind: 'p', text: 'Wholesome Capital Limited' },
		{ kind: 'p', text: 'A private company limited by shares, incorporated in Hong Kong SAR.' },
		{ kind: 'h', text: 'Registered office' },
		{
			kind: 'p',
			text: 'Unit 2505, 25/F., Billion Plaza, 8 Cheung Yue Street, Lai Chi Kok, Kowloon, Hong Kong'
		},
		{ kind: 'h', text: 'Company details' },
		{
			kind: 'list',
			items: [
				'Business Registration Number: 2391347',
				'VAT/Tax ID: Not applicable — Hong Kong does not levy VAT/GST'
			]
		},
		{ kind: 'h', text: 'Contact' },
		{ kind: 'mail', text: INFO_EMAIL },
		{ kind: 'h', text: 'EU representative (GDPR, Art. 27)' },
		{
			kind: 'p',
			text: `${GDPR_REP_EU_NAME}, ${GDPR_REP_EU_ADDRESS}. Email: ${GDPR_REP_EMAIL}. See Privacy Policy Rider A.`
		},
		{ kind: 'h', text: 'UK representative (UK GDPR, Art. 27)' },
		{
			kind: 'p',
			text: `${GDPR_REP_UK_NAME}, ${GDPR_REP_UK_ADDRESS}. Email: ${GDPR_REP_EMAIL}. See Privacy Policy Rider B.`
		},
		{
			kind: 'link',
			text: 'Verify our GDPR representative & submit requests',
			href: GDPR_REP_PORTAL_URL
		},
		{ kind: 'h', text: 'EU legal representative (Digital Services Act, Art. 13)' },
		{
			kind: 'p',
			text: 'An EU legal representative will be appointed for the service offered to users in the EU (located in an EU member state, with a publicly accessible contact), and their details will be published here. This is a separate appointment from the GDPR representative above.'
		}
	]
};

/**
 * Mexico privacy notice ("Aviso de Privacidad"). A controlling regional
 * document written in Spanish and carried verbatim: it is inherently a
 * single-language regional notice (Mexican ARCO rights), so its body lives
 * here as literal blocks rather than routing through the i18n catalogs.
 * The `info@` address is the real contact identifier from `contact.constants`.
 */
export const AVISO_MX: InfoDoc = {
	slug: 'aviso',
	title: 'Aviso de Privacidad',
	eyebrow: 'Legal · México · Vigente 10 de junio de 2026',
	blocks: [
		{ kind: 'p', text: 'Última actualización: 10 de junio de 2026' },
		{ kind: 'h', text: '1. Identidad y domicilio del responsable' },
		{
			kind: 'lede',
			text: 'Wholesome Capital Limited ("Vici", "nosotros"), sociedad constituida en Hong Kong SAR (Business Registration Number 2391347), es responsable del tratamiento de sus datos personales conforme al presente Aviso de Privacidad.'
		},
		{
			kind: 'p',
			text: `Para cualquier asunto relacionado con sus datos personales puede contactarnos en ${INFO_EMAIL}.`
		},
		{ kind: 'h', text: '2. Datos personales que recabamos' },
		{
			kind: 'p',
			text: 'Para prestarle el servicio de Vici —un juego de pronósticos gratuito y con fines de entretenimiento, en el que VXP y demás elementos del juego no tienen valor monetario— podemos recabar:'
		},
		{
			kind: 'list',
			items: [
				'Datos de identificación y de cuenta: el identificador con el que inicia sesión (mediante Google, Apple o una llave de acceso / passkey) y los datos de perfil que decida proporcionar (por ejemplo, nombre para mostrar). Al usar Google o Apple recibimos datos limitados de identidad de dichos proveedores (como un identificador y, según su configuración, su nombre y correo; Apple puede proporcionar un correo de relevo privado). El inicio de sesión con passkey no involucra a un proveedor externo.',
				'Datos de actividad en el juego: los pronósticos que realiza, los VXP que destina a cada pronóstico, su saldo e historial de VXP, su precisión y resultados, y demás actividad dentro del juego.',
				'Datos técnicos y de uso: tipo de dispositivo, navegador, región aproximada (derivada de la dirección IP) y la forma en que interactúa con la aplicación, con fines de análisis y seguridad.',
				'Comunicaciones: el contenido de su correspondencia si nos contacta.',
				'Datos de publicidad y atribución: según se describe en la sección 4 y en nuestra Política de Privacidad.'
			]
		},
		{
			kind: 'p',
			text: 'No recabamos datos personales sensibles ni información de pago, ya que no hay nada que comprar en el servicio.'
		},
		{ kind: 'h', text: '3. Finalidades del tratamiento' },
		{
			kind: 'p',
			text: 'Finalidades primarias (necesarias para prestarle el servicio):'
		},
		{
			kind: 'list',
			items: [
				'crear y administrar su cuenta y permitirle usar el juego, los pronósticos, los VXP y las tablas de clasificación;',
				'mantener la seguridad del servicio y prevenir fraudes y abusos;',
				'atender sus solicitudes y comunicaciones; y',
				'cumplir con obligaciones legales aplicables.'
			]
		},
		{
			kind: 'p',
			text: 'Finalidades secundarias (no necesarias para el servicio y que requieren su consentimiento):'
		},
		{
			kind: 'list',
			items: [
				'mostrarle y medir publicidad personalizada; y',
				'enviarle comunicaciones promocionales sobre Vici.'
			]
		},
		{
			kind: 'p',
			text: `Usted puede negar el consentimiento para las finalidades secundarias, sin que ello afecte la prestación del servicio. Para hacerlo, envíe su solicitud a ${INFO_EMAIL}. Si no manifiesta su negativa, podremos tratar sus datos para dichas finalidades conforme a la ley aplicable.`
		},
		{ kind: 'h', text: '4. Publicidad y tecnologías de rastreo' },
		{
			kind: 'p',
			text: 'Vici se financia en parte con publicidad. Cuando integramos tecnologías de publicidad, atribución o medición de terceros, dichos terceros pueden recibir ciertos datos técnicos y de uso y los tratan conforme a sus propios términos. Para estas tecnologías no esenciales solicitamos su consentimiento previo a través de nuestro mecanismo de consentimiento, y usted puede modificarlo o retirarlo en cualquier momento.'
		},
		{ kind: 'h', text: '5. Dónde se almacenan sus datos y transferencias' },
		{
			kind: 'p',
			text: 'Vici opera sobre la red descentralizada Internet Computer Protocol (ICP). Sus datos se almacenan en la subred europea de ICP, integrada exclusivamente por nodos ubicados en Europa; por ello, sus datos personales se conservan y replican únicamente en nodos dentro de la región europea. Esto implica una transferencia internacional de sus datos hacia infraestructura ubicada en Europa, región reconocida por un alto nivel de protección de datos.'
		},
		{
			kind: 'p',
			text: 'Salvo lo anterior y las transferencias a proveedores de publicidad descritas en la sección 4, no transferimos sus datos a terceros, excepto cuando sea necesario para cumplir una obligación legal, atender un requerimiento de autoridad competente, o proteger los derechos, la seguridad y la integridad de Vici y de sus usuarios.'
		},
		{ kind: 'h', text: '6. Sus derechos ARCO y revocación del consentimiento' },
		{
			kind: 'p',
			text: 'Usted tiene derecho a Acceder a sus datos personales, Rectificar los que sean inexactos o incompletos, Cancelar los que considere que no estamos tratando conforme a la ley y Oponerse a su tratamiento (derechos ARCO). También puede revocar el consentimiento que nos haya otorgado y limitar el uso o divulgación de sus datos.'
		},
		{
			kind: 'p',
			text: `Para ejercer cualquiera de estos derechos, envíe su solicitud a ${INFO_EMAIL}, indicando su nombre, una forma de contacto, una descripción clara de los datos o del derecho que desea ejercer, y los elementos que permitan localizar sus datos. Responderemos en los plazos que establece la ley aplicable.`
		},
		{ kind: 'h', text: '7. Uso de cookies y tecnologías similares' },
		{
			kind: 'p',
			text: 'Utilizamos cookies y tecnologías similares para el inicio de sesión, la seguridad y el análisis y —sujeto a su consentimiento— para publicidad. Puede gestionar su consentimiento a través de nuestro mecanismo de consentimiento.'
		},
		{ kind: 'h', text: '8. Cambios al Aviso de Privacidad' },
		{
			kind: 'p',
			text: 'Podemos actualizar este Aviso de Privacidad. Cuando lo hagamos, publicaremos la versión vigente en vici.market y actualizaremos la fecha de "Última actualización".'
		},
		{ kind: 'h', text: '9. Edad mínima' },
		{
			kind: 'p',
			text: 'Vici está dirigido únicamente a personas mayores de 18 años. No recabamos conscientemente datos de menores de esa edad.'
		},
		{ kind: 'h', text: '10. Contacto' },
		{ kind: 'p', text: 'Wholesome Capital Limited' },
		{
			kind: 'p',
			text: 'Unit 2505, 25/F., Billion Plaza, 8 Cheung Yue Street, Lai Chi Kok, Kowloon, Hong Kong'
		},
		{ kind: 'mail', text: INFO_EMAIL }
	]
};

/**
 * Brazil privacy notice ("Aviso de Privacidade"). A controlling regional
 * document written in Brazilian Portuguese and carried verbatim: it is
 * inherently a single-language regional notice (LGPD), so its body lives
 * here as literal blocks rather than routing through the i18n catalogs.
 * The `info@` address is the real contact identifier from `contact.constants`.
 */
export const AVISO_BR: InfoDoc = {
	slug: 'aviso-br',
	title: 'Aviso de Privacidade',
	eyebrow: 'Legal · Brasil · Em vigor em 10 de junho de 2026',
	blocks: [
		{ kind: 'p', text: 'Última atualização: 10 de junho de 2026' },
		{ kind: 'h', text: '1. Quem somos (controlador)' },
		{
			kind: 'lede',
			text: 'A Wholesome Capital Limited ("Vici", "nós"), sociedade constituída em Hong Kong SAR (Business Registration Number 2391347), é a controladora dos seus dados pessoais nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018, "LGPD").'
		},
		{
			kind: 'p',
			text: `Para qualquer assunto relacionado aos seus dados pessoais, entre em contato pelo e-mail ${INFO_EMAIL}.`
		},
		{ kind: 'h', text: '2. Dados pessoais que coletamos' },
		{
			kind: 'p',
			text: 'Para oferecer o Vici —um jogo de previsões gratuito e com finalidade de entretenimento, no qual os VXP e demais itens do jogo não possuem valor monetário— podemos coletar:'
		},
		{
			kind: 'list',
			items: [
				'Dados de identificação e de conta: o identificador com o qual você faz login (via Google, Apple ou uma chave de acesso / passkey) e os dados de perfil que você optar por fornecer (por exemplo, nome de exibição). Ao usar Google ou Apple, recebemos dados limitados de identidade desses provedores (como um identificador e, conforme suas configurações, seu nome e e-mail; a Apple pode fornecer um e-mail de retransmissão privado). O login com passkey não envolve um provedor externo.',
				'Dados de atividade no jogo: as previsões que você faz, os VXP que você destina a cada previsão, seu saldo e histórico de VXP, sua precisão e resultados, e demais atividades dentro do jogo.',
				'Dados técnicos e de uso: tipo de dispositivo, navegador, região aproximada (derivada do endereço IP) e a forma como você interage com o aplicativo, para fins de análise e segurança.',
				'Comunicações: o conteúdo da sua correspondência, caso entre em contato conosco.',
				'Dados de publicidade e atribuição: conforme descrito na seção 4 e em nossa Política de Privacidade.'
			]
		},
		{
			kind: 'p',
			text: 'Não coletamos dados pessoais sensíveis nem informações de pagamento, já que não há nada a comprar no serviço.'
		},
		{ kind: 'h', text: '3. Finalidades e bases legais do tratamento' },
		{
			kind: 'p',
			text: 'Tratamos seus dados pessoais com base nas hipóteses do art. 7º da LGPD, conforme a finalidade:'
		},
		{
			kind: 'list',
			items: [
				'criar e administrar sua conta e permitir o uso do jogo, das previsões, dos VXP e das tabelas de classificação — execução de serviço solicitado por você (art. 7º, V);',
				'manter a segurança do serviço e prevenir fraudes e abusos — legítimo interesse (art. 7º, IX);',
				'atender às suas solicitações e comunicações — execução de serviço e atendimento (art. 7º, V);',
				'cumprir obrigações legais e regulatórias aplicáveis (art. 7º, II); e',
				'exibir e medir publicidade personalizada e enviar comunicações promocionais — mediante o seu consentimento (art. 7º, I), que pode ser revogado a qualquer momento.'
			]
		},
		{ kind: 'h', text: '4. Publicidade e tecnologias de rastreamento' },
		{
			kind: 'p',
			text: 'O Vici é mantido em parte por publicidade. Quando integramos tecnologias de publicidade, atribuição ou medição de terceiros, esses terceiros podem receber determinados dados técnicos e de uso e os tratam conforme seus próprios termos. Para essas tecnologias não essenciais solicitamos o seu consentimento prévio por meio do nosso mecanismo de consentimento, e você pode alterá-lo ou revogá-lo a qualquer momento.'
		},
		{ kind: 'h', text: '5. Onde seus dados são armazenados e transferências internacionais' },
		{
			kind: 'p',
			text: 'O Vici opera sobre a rede descentralizada Internet Computer Protocol (ICP). Seus dados são armazenados na sub-rede europeia da ICP, composta exclusivamente por nós localizados na Europa; assim, seus dados pessoais são mantidos e replicados apenas em nós dentro da região europeia. Isso implica uma transferência internacional dos seus dados para infraestrutura localizada na Europa, região reconhecida por um alto nível de proteção de dados, nos termos do art. 33 da LGPD.'
		},
		{
			kind: 'p',
			text: 'Salvo o acima e as transferências a fornecedores de publicidade descritas na seção 4, não compartilhamos seus dados com terceiros, exceto quando necessário para cumprir obrigação legal, atender requisição de autoridade competente, ou proteger os direitos, a segurança e a integridade do Vici e de seus usuários.'
		},
		{ kind: 'h', text: '6. Seus direitos como titular' },
		{
			kind: 'p',
			text: 'Nos termos do art. 18 da LGPD, você tem direito a: confirmação da existência de tratamento; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a lei; portabilidade; eliminação dos dados tratados com base no consentimento; informação sobre as entidades com as quais compartilhamos seus dados; informação sobre a possibilidade de não fornecer consentimento e suas consequências; e revogação do consentimento.'
		},
		{
			kind: 'p',
			text: `Para exercer qualquer um desses direitos, envie sua solicitação para ${INFO_EMAIL}, indicando seu nome, uma forma de contato e uma descrição clara do direito que deseja exercer. Responderemos nos prazos previstos na legislação aplicável. Você também pode peticionar à Autoridade Nacional de Proteção de Dados (ANPD).`
		},
		{ kind: 'h', text: '7. Encarregado (DPO)' },
		{
			kind: 'p',
			text: 'Designaremos um Encarregado pelo Tratamento de Dados Pessoais para o Brasil e publicaremos os seus dados de contato aqui. Até lá, você pode tratar de assuntos relativos aos seus dados pessoais pelo contato indicado na seção 10.'
		},
		{ kind: 'h', text: '8. Cookies e tecnologias similares' },
		{
			kind: 'p',
			text: 'Utilizamos cookies e tecnologias similares para login, segurança e análise e —mediante o seu consentimento— para publicidade. Você pode gerenciar o seu consentimento por meio do nosso mecanismo de consentimento.'
		},
		{ kind: 'h', text: '9. Alterações e idade mínima' },
		{
			kind: 'p',
			text: 'Podemos atualizar este Aviso de Privacidade. Quando o fizermos, publicaremos a versão vigente em vici.market e atualizaremos a data de "Última atualização". O Vici destina-se exclusivamente a pessoas maiores de 18 anos e não tratamos conscientemente dados pessoais de crianças e adolescentes.'
		},
		{ kind: 'h', text: '10. Contato' },
		{ kind: 'p', text: 'Wholesome Capital Limited' },
		{
			kind: 'p',
			text: 'Unit 2505, 25/F., Billion Plaza, 8 Cheung Yue Street, Lai Chi Kok, Kowloon, Hong Kong'
		},
		{ kind: 'mail', text: INFO_EMAIL }
	]
};
