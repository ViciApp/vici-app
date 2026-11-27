import { isNullish } from '@dfinity/utils';
import type { WaitlistEmailCopy } from './en';

export const pt: WaitlistEmailCopy = {
	code: {
		subject: 'O teu código da lista de espera da VICI',
		intro: (handle) =>
			`Aqui está o teu código para reservar @${handle} na lista de espera da VICI:`,
		expiry: (minutes) =>
			`É válido durante ${minutes} minutos e, enquanto isso, o handle fica reservado para ti.`,
		ignore: 'Se não o pediste, ignora este email: nada é guardado.'
	},
	receipt: {
		subject: (handle) => `@${handle} é teu, estás na lista de espera`,
		held: (handle) =>
			`@${handle} está reservado para ti na lista de espera da VICI. Mais ninguém o pode ficar.`,
		next: 'Damos acesso a partir da lista de espera por grupos. Quando chegar a tua vez enviamos-te um email, e crias a tua conta com este endereço para manter o handle.',
		hold: (months) =>
			`A reserva dura ${months} meses; antes de terminar pedimos-te que confirmes que ainda a queres.`
	},
	alreadyMember: {
		subject: 'Já tens uma conta VICI',
		body: 'Já tens uma conta VICI com este endereço, por isso não há nada a que aderir. Inicia sessão aqui:',
		signIn: 'Iniciar sessão na VICI'
	},
	legacyAccount: {
		subject: 'A tua conta VICI está a mudar para vici.app',
		body: 'A tua conta VICI passa para vici.app automaticamente, com o teu handle. Entretanto, continua a jogar em vici.market.'
	},
	removed: {
		subject: 'Saíste da lista de espera da VICI',
		body: (handle) =>
			isNullish(handle)
				? 'A tua reserva na lista de espera foi apagada, com tudo o que guardávamos para ela.'
				: `@${handle} ficou livre e a tua reserva na lista de espera foi apagada, com tudo o que guardávamos para ela.`
	},
	footer: {
		remove: 'Remover-me da lista de espera'
	}
};
