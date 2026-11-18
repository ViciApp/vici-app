import { describe, expect, test } from 'bun:test';
import { ANALYTICS_EVENT_NAMES, ANALYTICS_PROP_KEYS } from '../../src/analytics/taxonomy';
import {
	extractBlock,
	extractUnionLiterals,
	importRepoModule,
	quotedStrings,
	readRepoSource
} from '../helpers/repo-source';

// The app keeps the event taxonomy as a dual source: the TS union in
// src/lib/types/analytics-event.ts and its runtime Zod mirror in
// src/lib/schema/analytics-event.schema.ts. Both are pinned here. The union is
// type-level and the schema module value-imports the app's schema builder, so
// each is read by static extraction; ANALYTICS_PROP_KEYS is a plain value in a
// module with only type imports, so it is loaded directly.
describe('shared drift: analytics taxonomy', () => {
	test('backend ANALYTICS_EVENT_NAMES matches the app TS union', () => {
		const app = extractUnionLiterals({
			source: readRepoSource('src/lib/types/analytics-event.ts'),
			typeName: 'AnalyticsEventName'
		});

		const backend: string[] = [...ANALYTICS_EVENT_NAMES];

		expect(backend).toEqual(app);
	});

	test('backend ANALYTICS_EVENT_NAMES matches the app Zod enum', () => {
		const app = quotedStrings(
			extractBlock({
				source: readRepoSource('src/lib/schema/analytics-event.schema.ts'),
				marker: 'export const AnalyticsEventNameSchema'
			})
		);

		const backend: string[] = [...ANALYTICS_EVENT_NAMES];

		expect(backend).toEqual(app);
	});

	test('backend ANALYTICS_PROP_KEYS matches the app dimension keys', async () => {
		const app = await importRepoModule<{ ANALYTICS_PROP_KEYS: readonly string[] }>(
			'src/lib/types/analytics-event.ts'
		);
		const backend: string[] = [...ANALYTICS_PROP_KEYS];

		expect(backend).toEqual([...app.ANALYTICS_PROP_KEYS]);
	});
});
