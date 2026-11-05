import type { FlameStage } from '#lib/utils/streak.utils.ts';
import { writable } from 'svelte/store';

type CompanionWho = 'vici' | 'oracle' | 'trickster' | 'flame';
type CompanionAnchor = 'br' | 'tr' | 'inline';
type ViciMood = 'happy' | 'encouraging' | 'thinking' | 'surprised';

export interface CompanionMessage {
	who: CompanionWho;
	line: string;
	dwell_ms?: number;
	sticky?: boolean;
	anchor?: CompanionAnchor;
	mood?: ViciMood;
	stage?: FlameStage;
	lightning?: boolean;
}

export const companionStore = writable<CompanionMessage | undefined>(undefined);

export const showCompanion = (msg: CompanionMessage): void => {
	companionStore.set(msg);
};

export const dismissCompanion = (): void => {
	companionStore.set(undefined);
};
