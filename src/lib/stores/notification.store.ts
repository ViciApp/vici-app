import { TOAST_DEFAULT_MS } from '#lib/constants/app.constants.ts';
import { writable } from 'svelte/store';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Notification {
	id: string;
	title: string;
	message: string;
	type: NotificationType;
}

const createNotificationStore = () => {
	const { subscribe, update } = writable<Notification[]>([]);

	const add = ({
		title,
		message,
		type = 'info',
		duration = TOAST_DEFAULT_MS
	}: {
		title: string;
		message: string;
		type?: NotificationType;
		duration?: number;
	}) => {
		const id = Math.random().toString(36).substring(2, 9);

		update((ns) => [...ns, { id, title, message, type }]);

		if (duration > 0) {
			setTimeout(() => {
				remove(id);
			}, duration);
		}
	};

	const remove = (id: string) => {
		update((ns) => ns.filter((n) => n.id !== id));
	};

	return {
		subscribe,
		add,
		remove
	};
};

export const notificationsStore = createNotificationStore();
