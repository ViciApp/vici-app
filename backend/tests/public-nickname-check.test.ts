// The anonymous handle probe: a Turnstile solve buys a short-lived proof bound
// to the caller's IP, the probe answers only with that proof and only what the
// signed-in probe answers, both routes are limited per IP, and a production
// server without a Turnstile secret refuses instead of opening up.

import { isNullish } from '@dfinity/utils';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { loadEnv, type TurnstileEnv } from '../src/env';
import { app } from '../src/index';
import { issueHumanProof, verifyHumanProof } from '../src/lib/human-proof';
import { resetRateLimits } from '../src/lib/rate-limit';
import { MINUTE_IN_MS, TEN_MINUTES_IN_MS } from '../src/lib/time';
import { setTurnstileSeam, verifyTurnstileToken, type SiteverifyCall } from '../src/lib/turnstile';
import { MAX_NICKNAME_LENGTH } from '../src/profiles/nickname';
import { ensureMigrated } from './helpers/auth';
import { createTestProfile, uniqueNickname } from './helpers/profiles';
import { dbAvailable } from './helpers/setup';

// The contract the routes promise, spelled out so the test pins it.
const ACTION = 'handle_check';
const SCOPE = 'nickname_check';
const PROOF_LIMIT_PER_TEN_MINUTES = 10;
const CHECK_LIMIT_PER_MINUTE = 30;

const ENABLED: TurnstileEnv = { enabled: true, secretKey: 'test-secret', bypass: false };
const UNCONFIGURED_PROD: TurnstileEnv = { enabled: false, secretKey: '', bypass: false };
const BYPASS: TurnstileEnv = { enabled: false, secretKey: '', bypass: true };

const uniqueIp = (): string => `10.${[...randomBytes(3)].join('.')}`;

const answering =
	(result: Awaited<ReturnType<SiteverifyCall>>): SiteverifyCall =>
	() =>
		Promise.resolve(result);

const unreachable: SiteverifyCall = () => Promise.reject(new Error('network down'));

const requestProof = async ({
	ip,
	turnstileToken = 'token'
}: {
	ip: string;
	turnstileToken?: string;
}): Promise<Response> =>
	await app.handle(
		new Request('http://localhost/api/v1/profiles/nickname-check-proof', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
			body: JSON.stringify({ turnstileToken })
		})
	);

const probe = async ({
	nickname,
	proof,
	ip
}: {
	nickname: string;
	proof?: string;
	ip: string;
}): Promise<Response> =>
	await app.handle(
		new Request(
			`http://localhost/api/v1/profiles/public-nickname-availability?${new URLSearchParams({
				nickname,
				...(isNullish(proof) ? {} : { proof })
			})}`,
			{ headers: { 'x-forwarded-for': ip } }
		)
	);

const proofFor = async (ip: string): Promise<string> => {
	const res = await requestProof({ ip });

	expect(res.status).toBe(200);

	const body = (await res.json()) as { proof: string; ttlMs: number };

	expect(body.ttlMs).toBe(TEN_MINUTES_IN_MS);

	return body.proof;
};

describe('TURNSTILE_SECRET_KEY', () => {
	test('a secret enables the check in every environment', () => {
		expect(loadEnv({ TURNSTILE_SECRET_KEY: 's' }).turnstile).toEqual({
			enabled: true,
			secretKey: 's',
			bypass: false
		});
	});

	test('no secret skips the check outside production only', () => {
		expect(loadEnv({}).turnstile).toEqual(BYPASS);
		expect(
			loadEnv({
				NODE_ENV: 'production',
				DATABASE_URL: 'postgres://x/y',
				SESSION_SECRET: 's3cret',
				ROOT_SECRET: 'r00t',
				RESEND_API_KEY: 're_test'
			}).turnstile
		).toEqual(UNCONFIGURED_PROD);
	});
});

describe('verifyTurnstileToken', () => {
	const verdict = async ({
		config,
		call,
		token = 'token'
	}: {
		config: TurnstileEnv;
		call?: SiteverifyCall;
		token?: string;
	}) => {
		const restoreSeam = setTurnstileSeam({ config, call });

		try {
			return await verifyTurnstileToken({ token, ip: '10.0.0.1', action: ACTION });
		} finally {
			restoreSeam();
		}
	};

	test('a genuine token minted for the action passes', async () => {
		expect(
			await verdict({ config: ENABLED, call: answering({ success: true, action: ACTION }) })
		).toBe('passed');
	});

	test('a refused token, or one minted for another action, fails', async () => {
		expect(await verdict({ config: ENABLED, call: answering({ success: false }) })).toBe('failed');
		expect(
			await verdict({ config: ENABLED, call: answering({ success: true, action: 'login' }) })
		).toBe('failed');
		expect(
			await verdict({ config: ENABLED, call: answering({ success: true, action: undefined }) })
		).toBe('failed');
	});

	test('an empty token fails without asking Cloudflare', async () => {
		let asked = false;

		expect(
			await verdict({
				config: ENABLED,
				token: '',
				call: () => {
					asked = true;

					return Promise.resolve({ success: true, action: ACTION });
				}
			})
		).toBe('failed');
		expect(asked).toBe(false);
	});

	test('Cloudflare being unreachable is unavailable, not a pass', async () => {
		expect(
			await verdict({
				config: ENABLED,
				call: unreachable
			})
		).toBe('unavailable');
	});

	test('production without a secret refuses; elsewhere the check is skipped', async () => {
		expect(await verdict({ config: UNCONFIGURED_PROD })).toBe('unconfigured');
		expect(await verdict({ config: BYPASS })).toBe('bypassed');
	});
});

describe('human proof', () => {
	const nowMs = 1_800_000_000_000;
	const ip = '10.1.2.3';
	const { proof } = issueHumanProof({ scope: SCOPE, ip, ttlMs: MINUTE_IN_MS, nowMs });

	test('verifies for its scope and IP until it expires', () => {
		expect(verifyHumanProof({ proof, scope: SCOPE, ip, nowMs })).toBe(true);
		expect(verifyHumanProof({ proof, scope: SCOPE, ip, nowMs: nowMs + MINUTE_IN_MS - 1 })).toBe(
			true
		);
		expect(verifyHumanProof({ proof, scope: SCOPE, ip, nowMs: nowMs + MINUTE_IN_MS })).toBe(false);
	});

	test('another IP or scope cannot use it', () => {
		expect(verifyHumanProof({ proof, scope: SCOPE, ip: '10.1.2.4', nowMs })).toBe(false);
		expect(verifyHumanProof({ proof, scope: SCOPE, ip: null, nowMs })).toBe(false);
		expect(verifyHumanProof({ proof, scope: 'other', ip, nowMs })).toBe(false);
	});

	test('a pushed-out expiry, a forged signature or garbage is not a proof', () => {
		const [expiresAt, signature] = proof.split('.');

		expect(
			verifyHumanProof({
				proof: `${Number(expiresAt) + MINUTE_IN_MS}.${signature}`,
				scope: SCOPE,
				ip,
				nowMs
			})
		).toBe(false);
		expect(
			verifyHumanProof({ proof: `${expiresAt}.${'0'.repeat(64)}`, scope: SCOPE, ip, nowMs })
		).toBe(false);

		for (const garbage of [undefined, '', 'abc', `${expiresAt}.`, `.${signature}`, `${proof}x`]) {
			expect(verifyHumanProof({ proof: garbage, scope: SCOPE, ip, nowMs })).toBe(false);
		}
	});
});

describe.if(dbAvailable)('public nickname availability', () => {
	let restore: (() => void) | undefined;

	beforeAll(async () => {
		await ensureMigrated();
	});

	beforeEach(() => {
		resetRateLimits();
		// The routes under test read the seam, never the runner's env.
		restore = setTurnstileSeam({ config: BYPASS });
	});

	afterEach(() => {
		restore?.();
		restore = undefined;
	});

	const useTurnstile = (seam: { config: TurnstileEnv; call?: SiteverifyCall }): void => {
		restore?.();
		restore = setTurnstileSeam(seam);
	};

	test('a solved challenge buys a proof that answers like the signed-in probe', async () => {
		useTurnstile({ config: ENABLED, call: answering({ success: true, action: ACTION }) });

		const ip = uniqueIp();
		const proof = await proofFor(ip);
		const { profile } = await createTestProfile();

		const taken = await probe({ nickname: profile.nickname, proof, ip });

		expect(taken.status).toBe(200);
		expect(await taken.json()).toEqual({ available: false, reason: 'taken' });

		const reserved = await probe({ nickname: 'admin', proof, ip });

		expect(await reserved.json()).toEqual({ available: false, reason: 'reserved' });

		const free = await probe({ nickname: uniqueNickname(), proof, ip });

		expect(await free.json()).toEqual({ available: true });

		for (const [nickname, reason] of [
			['a', 'too_short'],
			['a'.repeat(MAX_NICKNAME_LENGTH + 1), 'too_long'],
			['bad name', 'invalid']
		] as const) {
			expect(await (await probe({ nickname, proof, ip })).json()).toEqual({
				available: false,
				reason
			});
		}
	});

	test('no proof, a foreign proof or another IP is refused before any lookup', async () => {
		const ip = uniqueIp();
		const foreign = issueHumanProof({ scope: 'other', ip, ttlMs: MINUTE_IN_MS }).proof;
		const proof = await proofFor(ip);

		for (const res of [
			await probe({ nickname: uniqueNickname(), ip }),
			await probe({ nickname: uniqueNickname(), proof: foreign, ip }),
			await probe({ nickname: uniqueNickname(), proof, ip: uniqueIp() })
		]) {
			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({ error: 'human_proof_required' });
		}
	});

	test('a refused challenge gets no proof; Cloudflare down or no secret in production is a 503', async () => {
		const cases: [TurnstileEnv, SiteverifyCall | undefined, number, string][] = [
			[ENABLED, answering({ success: false }), 403, 'turnstile_failed'],
			[ENABLED, unreachable, 503, 'turnstile_unavailable'],
			[UNCONFIGURED_PROD, undefined, 503, 'turnstile_unconfigured']
		];

		for (const [config, call, status, error] of cases) {
			useTurnstile({ config, call });

			const res = await requestProof({ ip: uniqueIp() });

			expect(res.status).toBe(status);
			expect(await res.json()).toEqual({ error });
		}
	});

	test('proofs are limited per IP', async () => {
		const ip = uniqueIp();

		for (let i = 0; i < PROOF_LIMIT_PER_TEN_MINUTES; i++) {
			expect((await requestProof({ ip })).status).toBe(200);
		}

		const limited = await requestProof({ ip });

		expect(limited.status).toBe(429);
		expect(await limited.json()).toEqual({ error: 'rate_limited' });
		expect((await requestProof({ ip: uniqueIp() })).status).toBe(200);
	});

	test('the probe is limited per IP, proof or not', async () => {
		const ip = uniqueIp();
		const proof = await proofFor(ip);

		for (let i = 0; i < CHECK_LIMIT_PER_MINUTE; i++) {
			expect((await probe({ nickname: uniqueNickname(), proof, ip })).status).toBe(200);
		}

		const limited = await probe({ nickname: uniqueNickname(), proof, ip });

		expect(limited.status).toBe(429);
		expect(limited.headers.get('retry-after')).not.toBeNull();
	});
});
