import { isNullish } from '@dfinity/utils';
import type { WaitlistEmailCopy } from './en';

export const fr: WaitlistEmailCopy = {
	code: {
		subject: 'Ton code pour la liste d’attente VICI',
		intro: (handle) => `Voici ton code pour réserver @${handle} sur la liste d’attente VICI :`,
		expiry: (minutes) =>
			`Il est valable ${minutes} minutes, et le pseudo reste réservé pour toi pendant ce temps.`,
		ignore: (hours) =>
			`Si tu ne l’as pas demandé, ignore cet email : sans le code rien n’est réservé, et la demande est supprimée sous ${hours} heures. Le lien ci-dessous la supprime tout de suite.`
	},
	receipt: {
		subject: (handle) => `@${handle} est à toi, tu es sur la liste d’attente`,
		held: (handle) =>
			`@${handle} est réservé pour toi sur la liste d’attente VICI. Personne d’autre ne peut le prendre.`,
		next: 'Nous faisons entrer les personnes de la liste d’attente par vagues. Quand ce sera ton tour, nous t’écrirons, et tu créeras ton compte avec cette adresse pour garder le pseudo.',
		hold: (months) =>
			`La réservation dure ${months} mois ; avant la fin, nous te demanderons de confirmer que tu la veux toujours.`
	},
	removed: {
		subject: 'Tu ne fais plus partie de la liste d’attente VICI',
		body: (handle) =>
			isNullish(handle)
				? 'Ta réservation sur la liste d’attente est supprimée, avec tout ce que nous gardions pour elle.'
				: `@${handle} est libéré et ta réservation sur la liste d’attente est supprimée, avec tout ce que nous gardions pour elle.`
	},
	footer: {
		remove: 'Me retirer de la liste d’attente'
	}
};
