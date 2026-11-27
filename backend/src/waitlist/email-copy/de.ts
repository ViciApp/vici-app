import { isNullish } from '@dfinity/utils';
import type { WaitlistEmailCopy } from './en';

export const de: WaitlistEmailCopy = {
	code: {
		subject: 'Dein Code für die VICI-Warteliste',
		intro: (handle) => `Hier ist dein Code, um @${handle} auf der VICI-Warteliste zu reservieren:`,
		expiry: (minutes) =>
			`Er gilt ${minutes} Minuten, und so lange bleibt das Handle für dich reserviert.`,
		ignore:
			'Wenn du ihn nicht angefordert hast, ignoriere diese E-Mail: Es wird nichts gespeichert.'
	},
	receipt: {
		subject: (handle) => `@${handle} gehört dir, du stehst auf der Warteliste`,
		held: (handle) =>
			`@${handle} ist auf der VICI-Warteliste für dich reserviert. Niemand sonst kann es nehmen.`,
		next: 'Wir lassen Leute von der Warteliste in Gruppen herein. Wenn du dran bist, schreiben wir dir, und du erstellst dein Konto mit dieser Adresse, um das Handle zu behalten.',
		hold: (months) =>
			`Die Reservierung gilt ${months} Monate; vor dem Ende fragen wir dich, ob du sie behalten willst.`
	},
	alreadyMember: {
		subject: 'Du hast schon ein VICI-Konto',
		body: 'Du hast mit dieser Adresse schon ein VICI-Konto, es gibt also nichts beizutreten. Melde dich hier an:',
		signIn: 'Bei VICI anmelden'
	},
	legacyAccount: {
		subject: 'Dein VICI-Konto zieht auf vici.app um',
		body: 'Dein VICI-Konto zieht automatisch auf vici.app um, mit deinem Handle. Spiel bis dahin weiter auf vici.market.'
	},
	removed: {
		subject: 'Du stehst nicht mehr auf der VICI-Warteliste',
		body: (handle) =>
			isNullish(handle)
				? 'Deine Reservierung auf der Warteliste ist gelöscht, mit allem, was wir dafür gespeichert hatten.'
				: `@${handle} ist wieder frei und deine Reservierung auf der Warteliste ist gelöscht, mit allem, was wir dafür gespeichert hatten.`
	},
	footer: {
		remove: 'Mich von der Warteliste entfernen'
	}
};
