import { describe, expect, test } from 'bun:test';
import { MAX_EVENTS_PER_BATCH } from '../../src/analytics/events';
import { SERVER_ANALYTICS_EVENT_NAMES } from '../../src/analytics/taxonomy';
import { importRepoModule } from '../helpers/repo-source';

// The web2 ingest takes the same client batches as the satellite capture, so
// it keeps the same bounds: the app's flush size as the batch cap, and the
// events only the server records refused from a client. Both app modules hold
// plain values with only type imports, so they are loaded directly.
describe('shared drift: analytics ingest bounds', () => {
	test('backend MAX_EVENTS_PER_BATCH matches the app flush size', async () => {
		const app = await importRepoModule<{ ANALYTICS_MAX_EVENTS_PER_BATCH: number }>(
			'src/lib/constants/analytics.constants.ts'
		);

		expect(MAX_EVENTS_PER_BATCH).toBe(app.ANALYTICS_MAX_EVENTS_PER_BATCH);
	});

	test('backend SERVER_ANALYTICS_EVENT_NAMES matches the app list', async () => {
		const app = await importRepoModule<{ SERVER_ANALYTICS_EVENT_NAMES: readonly string[] }>(
			'src/lib/types/analytics-event.ts'
		);
		const backend: string[] = [...SERVER_ANALYTICS_EVENT_NAMES];

		expect(backend).toEqual([...app.SERVER_ANALYTICS_EVENT_NAMES]);
	});
});
