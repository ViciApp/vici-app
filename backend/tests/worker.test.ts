// The worker's schedule: which jobs a given pass runs. A throttled job runs on
// the first pass after boot and then every Nth pass, so a deploy or a restart
// never postpones it by a whole period.

import { describe, expect, test } from 'bun:test';
import { dueJobs, jobs } from '../src/worker';

const names = (list: { name: string }[]): string[] => list.map(({ name }) => name);

const throttled = jobs.filter(({ everyNthTick }) => (everyNthTick ?? 1) > 1);

describe('dueJobs', () => {
	test('the registry throttles at least one job', () => {
		expect(throttled.length).toBeGreaterThan(0);
	});

	test('the first pass after boot runs every job, throttled ones included', () => {
		expect(names(dueJobs(0))).toEqual(names(jobs));
	});

	test('the second pass runs only the jobs that are not throttled', () => {
		expect(names(dueJobs(1))).toEqual(
			names(jobs.filter(({ everyNthTick }) => (everyNthTick ?? 1) === 1))
		);
	});

	test('a throttled job runs again once its period has passed', () => {
		for (const job of throttled) {
			const period = job.everyNthTick ?? 1;

			expect(names(dueJobs(period))).toContain(job.name);
			expect(names(dueJobs(period - 1))).not.toContain(job.name);
		}
	});
});
