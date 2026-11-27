// The waitlist's emails in English, the shape every other locale's copy is
// typed against (`WaitlistEmailCopy`), so a missing line is a type error.
// Figures (the code lifetime, the hold) arrive as parameters from the
// constants the server enforces, never as literals in the copy.

import { isNullish } from '@dfinity/utils';

export const en = {
	code: {
		subject: 'Your VICI waitlist code',
		intro: (handle: string) => `Here is your code to hold @${handle} on the VICI waitlist:`,
		expiry: (minutes: number) =>
			`It works for ${minutes} minutes, and the handle stays held for you while it does.`,
		ignore: (hours: number) =>
			`If you didn't ask for it, ignore this email: without the code nothing is held, and the request is deleted within ${hours} hours. The link below deletes it now.`
	},
	receipt: {
		subject: (handle: string) => `@${handle} is yours, you're on the waitlist`,
		held: (handle: string) =>
			`@${handle} is held for you on the VICI waitlist. Nobody else can take it.`,
		next: 'We let people in from the waitlist in batches. When it is your turn we email you, and you create your account with this address to keep the handle.',
		hold: (months: number) =>
			`The hold lasts ${months} months; before it ends we ask you to confirm you still want it.`
	},
	removed: {
		subject: "You're off the VICI waitlist",
		body: (handle: string | undefined) =>
			isNullish(handle)
				? 'Your waitlist reservation is deleted, with everything we held for it.'
				: `@${handle} is released and your waitlist reservation is deleted, with everything we held for it.`
	},
	footer: {
		remove: 'Remove me from the waitlist'
	}
};

export type WaitlistEmailCopy = typeof en;
