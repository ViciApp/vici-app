import { isNullish } from '@dfinity/utils';
import type { WaitlistEmailCopy } from './en';

export const it: WaitlistEmailCopy = {
	code: {
		subject: 'Il tuo codice per la lista d’attesa di VICI',
		intro: (handle) => `Ecco il tuo codice per riservare @${handle} nella lista d’attesa di VICI:`,
		expiry: (minutes) => `Vale ${minutes} minuti, e intanto lo handle resta riservato a te.`,
		ignore: 'Se non l’hai chiesto tu, ignora questa email: non conserviamo nulla.'
	},
	receipt: {
		subject: (handle) => `@${handle} è tuo, sei nella lista d’attesa`,
		held: (handle) =>
			`@${handle} è riservato a te nella lista d’attesa di VICI. Nessun altro può prenderlo.`,
		next: 'Facciamo entrare le persone dalla lista d’attesa a gruppi. Quando tocca a te ti scriviamo, e crei il tuo account con questo indirizzo per tenere lo handle.',
		hold: (months) =>
			`La prenotazione dura ${months} mesi; prima che scada ti chiediamo di confermare che la vuoi ancora.`
	},
	removed: {
		subject: 'Non sei più nella lista d’attesa di VICI',
		body: (handle) =>
			isNullish(handle)
				? 'La tua prenotazione nella lista d’attesa è stata cancellata, con tutto ciò che conservavamo per lei.'
				: `@${handle} è di nuovo libero e la tua prenotazione nella lista d’attesa è stata cancellata, con tutto ciò che conservavamo per lei.`
	},
	footer: {
		remove: 'Toglimi dalla lista d’attesa'
	}
};
