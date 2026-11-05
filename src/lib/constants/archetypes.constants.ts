import type { MessageKey } from '#lib/utils/i18n.utils.ts';

export interface Archetype {
	id: string;
	nameKey: MessageKey;
	descriptionKey: MessageKey;
	accent: string;
	tagKey: MessageKey;
}

export const ARCHETYPES: Archetype[] = [
	{
		id: 'strategist',
		nameKey: 'archetype.strategist.name',
		descriptionKey: 'archetype.strategist.description',
		accent: '#7EB6FF',
		tagKey: 'archetype.strategist.tag'
	},
	{
		id: 'conservative',
		nameKey: 'archetype.conservative.name',
		descriptionKey: 'archetype.conservative.description',
		accent: '#6FE0B6',
		tagKey: 'archetype.conservative.tag'
	},
	{
		id: 'bold',
		nameKey: 'archetype.bold.name',
		descriptionKey: 'archetype.bold.description',
		accent: '#FF8A4C',
		tagKey: 'archetype.bold.tag'
	},
	{
		id: 'visionary',
		nameKey: 'archetype.visionary.name',
		descriptionKey: 'archetype.visionary.description',
		accent: '#B49CFF',
		tagKey: 'archetype.visionary.tag'
	}
];

export const ARCHETYPE_MAP = new Map(ARCHETYPES.map((a) => [a.id, a]));
