import { writable, type Readable } from 'svelte/store';

/** The market whose challenge share sheet is open. */
export interface ChallengeShareRequest {
	seriesId: string;
	/** The market title as the viewer reads it (translated for the active locale). */
	title: string;
}

const challengeShareRequestStore = writable<ChallengeShareRequest | undefined>(undefined);

/**
 * The open challenge share sheet, if any. `ChallengeShareHost` (mounted once in the app shell)
 * renders it: the action sits on the back of a Flow card, whose transform would trap a sheet
 * mounted inside it.
 */
export const challengeShareRequest: Readable<ChallengeShareRequest | undefined> =
	challengeShareRequestStore;

export const openChallengeShare = (request: ChallengeShareRequest): void => {
	challengeShareRequestStore.set(request);
};

export const closeChallengeShare = (): void => {
	challengeShareRequestStore.set(undefined);
};
