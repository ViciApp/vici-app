import { describe, expect, test } from 'bun:test';
import {
	MAX_PATH_LENGTH,
	MAX_PROP_STRING_LENGTH,
	MAX_SESSION_ID_LENGTH
} from '../../src/analytics/events';
import { ANALYTICS_EVENT_NAMES, ANALYTICS_PROP_KEYS } from '../../src/analytics/taxonomy';
import { extractUnionLiterals, importRepoModule, readRepoSource } from '../helpers/repo-source';

// The app keeps the event taxonomy as the TS union in
// src/lib/types/analytics-event.ts, pinned here. The union is type-level, so it
// is read by static extraction; ANALYTICS_PROP_KEYS is a plain value in a
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

	test('backend ANALYTICS_PROP_KEYS matches the app dimension keys', async () => {
		const app = await importRepoModule<{ ANALYTICS_PROP_KEYS: readonly string[] }>(
			'src/lib/types/analytics-event.ts'
		);
		const backend: string[] = [...ANALYTICS_PROP_KEYS];

		expect(backend).toEqual([...app.ANALYTICS_PROP_KEYS]);
	});

	test('backend ingest string caps match the app capture', async () => {
		const app = await importRepoModule<{
			ANALYTICS_MAX_SESSION_ID_LENGTH: number;
			ANALYTICS_MAX_PATH_LENGTH: number;
			ANALYTICS_MAX_PROP_STRING_LENGTH: number;
		}>('src/lib/constants/analytics.constants.ts');

		expect([MAX_SESSION_ID_LENGTH, MAX_PATH_LENGTH, MAX_PROP_STRING_LENGTH]).toEqual([
			app.ANALYTICS_MAX_SESSION_ID_LENGTH,
			app.ANALYTICS_MAX_PATH_LENGTH,
			app.ANALYTICS_MAX_PROP_STRING_LENGTH
		]);
	});
});
