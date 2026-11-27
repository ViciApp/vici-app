import type { WaitlistSource } from '#lib/constants/waitlist.constants.ts';
import type { PublicHandleAvailability } from '#lib/services/handle-availability.services.ts';
import type { LandingClaimFlow as LandingClaimFlowType } from '#lib/stores/landing-claim-flow.svelte.ts';
import type { LandingClaimError, LandingClaimSubmit } from '#lib/types/landing-claim.ts';
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
}

const CODE_TTL_MS = 600_000;
const SENT = { ok: true, codeTtlMs: CODE_TTL_MS } as const;

const deferred = <T>(): Deferred<T> => {
	let resolve: (value: T) => void = () => {};

	const promise = new Promise<T>((res) => {
		resolve = res;
	});

	return { promise, resolve };
};

// The flow keeps its fields in Svelte runes; outside the Svelte compiler a
// plain value stands in for `$state`, which is all the step logic needs.
let LandingClaimFlow: typeof LandingClaimFlowType;

before(async () => {
	Object.assign(globalThis, { $state: <T>(value: T): T => value });
	({ LandingClaimFlow } = await import('#lib/stores/landing-claim-flow.svelte.ts'));
});

const flows: LandingClaimFlowType[] = [];

afterEach(() => {
	flows.splice(0).forEach((flow) => flow.dispose());
});

const setup = () => {
	const checks: { handle: string; answer: Deferred<PublicHandleAvailability> }[] = [];
	const codeRequests: {
		handle: string;
		email: string;
		source: WaitlistSource;
		answer: Deferred<{ ok: true; codeTtlMs: number } | LandingClaimError>;
	}[] = [];
	const confirms: {
		email: string;
		code: string;
		answer: Deferred<{ handle: string } | LandingClaimError>;
	}[] = [];

	const submit: LandingClaimSubmit = {
		requestCode: ({ handle, email, source }) => {
			const answer = deferred<{ ok: true; codeTtlMs: number } | LandingClaimError>();
			codeRequests.push({ handle, email, source, answer });

			return answer.promise;
		},
		confirm: ({ email, code }) => {
			const answer = deferred<{ handle: string } | LandingClaimError>();
			confirms.push({ email, code, answer });

			return answer.promise;
		},
		cachedHandle: () => undefined,
		restore: () => Promise.resolve(undefined)
	};

	const flow = new LandingClaimFlow({
		submit: () => submit,
		checkAvailability: ({ handle }) => {
			const answer = deferred<PublicHandleAvailability>();
			checks.push({ handle, answer });

			return answer.promise;
		},
		source: () => 'markets'
	});
	flows.push(flow);

	return { flow, checks, codeRequests, confirms };
};

// Typed, then pressed before the debounced probe ran: the press asks at once.
const toEmailStep = async ({ flow, checks }: ReturnType<typeof setup>) => {
	flow.inputHandle('alice');

	const pressed = flow.next();
	checks[checks.length - 1].answer.resolve({ available: true });

	assert.deepEqual(await pressed, { kind: 'advanced' });
	assert.equal(flow.step, 'email');
};

const toCodeStep = async ({
	ctx,
	email = 'a@b.co'
}: {
	ctx: ReturnType<typeof setup>;
	email?: string;
}) => {
	await toEmailStep(ctx);
	ctx.flow.inputEmail(email);

	const pressed = ctx.flow.next();
	ctx.codeRequests[ctx.codeRequests.length - 1].answer.resolve(SENT);

	assert.deepEqual(await pressed, { kind: 'advanced' });
	assert.equal(ctx.flow.step, 'code');
};

describe('LandingClaimFlow', () => {
	describe('handle step', () => {
		it('advances on a free handle', async () => {
			const ctx = setup();

			await toEmailStep(ctx);

			assert.equal(ctx.checks[0].handle, 'alice');
			assert.equal(ctx.flow.busy, false);
		});

		it('refuses a taken handle', async () => {
			const { flow, checks } = setup();

			flow.inputHandle('alice');
			const pressed = flow.next();
			checks[0].answer.resolve({ available: false, reason: 'taken' });

			assert.deepEqual(await pressed, { kind: 'refused' });
			assert.equal(flow.step, 'handle');
			assert.deepEqual(flow.check, { kind: 'taken' });
		});

		it('ignores a forced probe whose handle was edited meanwhile', async () => {
			const { flow, checks } = setup();

			flow.inputHandle('alice');
			const pressed = flow.next();
			flow.inputHandle('alicia');
			checks[0].answer.resolve({ available: true });

			assert.deepEqual(await pressed, { kind: 'ignored' });
			assert.equal(flow.step, 'handle');
			assert.equal(flow.handle, 'alicia');
			assert.deepEqual(flow.check, { kind: 'checking' });
		});

		it('ignores a forced probe that answers after the capsule closed', async () => {
			const { flow, checks } = setup();

			flow.inputHandle('alice');
			const pressed = flow.next();
			flow.cancel();
			checks[0].answer.resolve({ available: true });

			assert.deepEqual(await pressed, { kind: 'ignored' });
			assert.equal(flow.step, 'handle');
			assert.equal(flow.busy, false);
		});

		it('ignores a press while a call is in flight', async () => {
			const { flow, checks } = setup();

			flow.inputHandle('alice');
			const first = flow.next();

			assert.equal(flow.busy, true);
			assert.deepEqual(await flow.next(), { kind: 'ignored' });
			assert.equal(checks.length, 1);

			checks[0].answer.resolve({ available: true });
			assert.deepEqual(await first, { kind: 'advanced' });
		});
	});

	describe('email step', () => {
		it('refuses an address that is not one, without a call', async () => {
			const ctx = setup();

			await toEmailStep(ctx);
			ctx.flow.inputEmail('nope');

			assert.deepEqual(await ctx.flow.next(), { kind: 'refused' });
			assert.deepEqual(ctx.flow.notice, { kind: 'refused', refusal: 'email_invalid' });
			assert.equal(ctx.codeRequests.length, 0);
		});

		it('sends the trimmed address for the handle', async () => {
			const ctx = setup();

			await toCodeStep({ ctx, email: '  a@b.co ' });

			const [request] = ctx.codeRequests;

			assert.deepEqual(
				{ handle: request.handle, email: request.email, source: request.source },
				{ handle: 'alice', email: 'a@b.co', source: 'markets' }
			);
		});

		it('ignores a code request whose address was edited meanwhile', async () => {
			const ctx = setup();

			await toEmailStep(ctx);
			ctx.flow.inputEmail('a@b.co');
			const pressed = ctx.flow.next();
			ctx.flow.inputEmail('c@d.co');
			ctx.codeRequests[0].answer.resolve(SENT);

			assert.deepEqual(await pressed, { kind: 'ignored' });
			assert.equal(ctx.flow.step, 'email');
			assert.equal(ctx.flow.busy, false);
		});

		it('ignores a code request that answers after a close and reopen', async () => {
			const ctx = setup();

			await toEmailStep(ctx);
			ctx.flow.inputEmail('a@b.co');
			const pressed = ctx.flow.next();
			ctx.flow.cancel();
			ctx.flow.reopen();
			ctx.codeRequests[0].answer.resolve(SENT);

			assert.deepEqual(await pressed, { kind: 'ignored' });
			assert.equal(ctx.flow.step, 'handle');
			assert.equal(ctx.flow.email, 'a@b.co');
		});

		it('ignores a failed code request that answers after a close', async () => {
			const ctx = setup();

			await toEmailStep(ctx);
			ctx.flow.inputEmail('a@b.co');
			const pressed = ctx.flow.next();
			ctx.flow.cancel();
			ctx.codeRequests[0].answer.resolve({ error: 'rate_limited' });

			assert.deepEqual(await pressed, { kind: 'ignored' });
			assert.deepEqual(ctx.flow.notice, { kind: 'none' });
		});

		it('sends the visitor back to the handle, the address kept, when it went meanwhile', async () => {
			const ctx = setup();

			await toEmailStep(ctx);
			ctx.flow.inputEmail('a@b.co');
			const pressed = ctx.flow.next();
			ctx.codeRequests[0].answer.resolve({ error: 'handle_taken' });

			assert.deepEqual(await pressed, { kind: 'refused' });
			assert.equal(ctx.flow.step, 'handle');
			assert.deepEqual(ctx.flow.check, { kind: 'taken' });
			assert.equal(ctx.flow.email, 'a@b.co');
		});

		it('sends the visitor back to the handle when the waitlist refuses it', async () => {
			const ctx = setup();

			await toEmailStep(ctx);
			ctx.flow.inputEmail('a@b.co');
			const pressed = ctx.flow.next();
			ctx.codeRequests[0].answer.resolve({ error: 'handle_invalid' });

			assert.deepEqual(await pressed, { kind: 'refused' });
			assert.equal(ctx.flow.step, 'handle');
			assert.deepEqual(ctx.flow.notice, { kind: 'refused', refusal: 'handle_invalid' });
		});

		it('reads its own pending hold as free, without a probe', async () => {
			const ctx = setup();

			await toCodeStep({ ctx });
			ctx.flow.reopen();
			const probes = ctx.checks.length;
			ctx.flow.inputHandle('alic');
			ctx.flow.inputHandle('alice');

			assert.deepEqual(ctx.flow.check, { kind: 'free' });
			assert.deepEqual(await ctx.flow.next(), { kind: 'advanced' });
			assert.equal(ctx.checks.length, probes);
		});
	});

	describe('code step', () => {
		it('waits for a full code before calling', async () => {
			const ctx = setup();

			await toCodeStep({ ctx });
			ctx.flow.inputCode('12-3');

			assert.deepEqual(await ctx.flow.next(), { kind: 'refused' });
			assert.equal(ctx.confirms.length, 0);
		});

		it('confirms against the address the code was sent to and claims', async () => {
			const ctx = setup();

			await toCodeStep({ ctx, email: ' a@b.co ' });
			// Defensive: the field is locked here, but a stray write never retargets the code.
			ctx.flow.email = 'c@d.co';
			ctx.flow.inputCode('123 456');
			const pressed = ctx.flow.next();
			ctx.confirms[0].answer.resolve({ handle: 'alice' });

			assert.deepEqual(await pressed, { kind: 'claimed', handle: 'alice' });
			assert.deepEqual(
				{ email: ctx.confirms[0].email, code: ctx.confirms[0].code },
				{ email: 'a@b.co', code: '123456' }
			);
			assert.equal(ctx.flow.step, 'done');
		});

		it('ignores a confirmation that answers after a step back', async () => {
			const ctx = setup();

			await toCodeStep({ ctx });
			ctx.flow.inputCode('123456');
			const pressed = ctx.flow.next();
			ctx.flow.back();
			ctx.confirms[0].answer.resolve({ handle: 'alice' });

			assert.deepEqual(await pressed, { kind: 'ignored' });
			assert.equal(ctx.flow.step, 'email');
		});

		it('maps a wrong code to its refusal and stays', async () => {
			const ctx = setup();

			await toCodeStep({ ctx });
			ctx.flow.inputCode('123456');
			const pressed = ctx.flow.next();
			ctx.confirms[0].answer.resolve({ error: 'invalid_code' });

			assert.deepEqual(await pressed, { kind: 'refused' });
			assert.deepEqual(ctx.flow.notice, { kind: 'refused', refusal: 'invalid_code' });
			assert.equal(ctx.flow.step, 'code');
		});
	});
});
