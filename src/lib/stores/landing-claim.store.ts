import { writable, type Readable } from 'svelte/store';

export interface LandingClaimState {
	/** Whether the top-bar capsule is open. */
	open: boolean;
	/**
	 * A line the opener wrote for the tray (already translated), shown in
	 * place of the handle prompt until the visitor types.
	 */
	ack: string | undefined;
}

const INITIAL: LandingClaimState = { open: false, ack: undefined };

const store = writable<LandingClaimState>(INITIAL);

/**
 * Open state of the landing's claim-your-handle capsule (`LandingNav`), so
 * any part of the landing (a Yes / No in Markets, the deck's call to action)
 * can open it with a line of its own, and the page can step other controls
 * aside while it is open. Opening an open capsule changes nothing.
 */
export const landingClaimStore: Readable<LandingClaimState> & {
	open: (params?: { ack?: string }) => void;
	close: () => void;
	reset: () => void;
} = {
	subscribe: store.subscribe,
	open: ({ ack }: { ack?: string } = {}) =>
		store.update((state) => (state.open ? state : { open: true, ack })),
	close: () => store.update((state) => (state.open ? { open: false, ack: undefined } : state)),
	reset: () => store.set(INITIAL)
};
