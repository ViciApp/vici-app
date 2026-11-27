import { isNullish } from '@dfinity/utils';
import type { WaitlistEmailCopy } from './en';

export const es: WaitlistEmailCopy = {
	code: {
		subject: 'Tu código de la lista de espera de VICI',
		intro: (handle) => `Este es tu código para reservar @${handle} en la lista de espera de VICI:`,
		expiry: (minutes) =>
			`Vale durante ${minutes} minutos, y mientras tanto el handle queda reservado para ti.`,
		ignore: 'Si no lo has pedido, ignora este correo: no se guarda nada.'
	},
	receipt: {
		subject: (handle) => `@${handle} es tuyo, estás en la lista de espera`,
		held: (handle) =>
			`@${handle} queda reservado para ti en la lista de espera de VICI. Nadie más puede quedárselo.`,
		next: 'Damos acceso desde la lista de espera por tandas. Cuando te toque te escribimos, y creas tu cuenta con esta dirección para conservar el handle.',
		hold: (months) =>
			`La reserva dura ${months} meses; antes de que termine te pediremos que confirmes que la sigues queriendo.`
	},
	removed: {
		subject: 'Ya no estás en la lista de espera de VICI',
		body: (handle) =>
			isNullish(handle)
				? 'Tu reserva en la lista de espera se ha borrado, con todo lo que guardábamos para ella.'
				: `@${handle} queda libre y tu reserva en la lista de espera se ha borrado, con todo lo que guardábamos para ella.`
	},
	footer: {
		remove: 'Quitarme de la lista de espera'
	}
};
