// Challenge links: issue one for the caller's own call, the public read of
// it, the owner's consent switch and revocation, the redemption that credits
// the challenger as referrer, the engine-verified answer, and the owner's two
// lists. No challenge endpoint takes a Turnstile token: every write needs a
// session (and, to create or answer, a real engine position), and the public
// read is addressed by an 80-bit random id behind a per-IP limit.

import { isNullish, nonNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import { addVary, badRequest, clientIp, type StatusContext } from '../lib/http';
import { enforceLimit } from '../lib/rate-limit';
import { HOUR_IN_MS } from '../lib/time';
import {
	listChallengeAnswers,
	recordChallengeAnswer,
	redeemChallenge
} from '../social/challenge-answers';
import {
	ChallengeError,
	ChallengeNotFoundError,
	createChallenge,
	getChallengeView,
	listMyChallenges,
	revokeChallenge,
	setChallengeConsent
} from '../social/challenges';

// The public read resolves a bearer id, so it is limited per client IP; the
// budget matches the referral lookup's, room for a class on one network
// opening the same link.
const CHALLENGE_READ_LIMIT_PER_HOUR = 120;

// The signed-in writes are limited per account: create and answer each fan
// out an engine read of the caller's trade history, and a shared network
// must not pool its users.
const CHALLENGE_CREATE_LIMIT_PER_HOUR = 60;
const CHALLENGE_CONSENT_LIMIT_PER_HOUR = 60;
const CHALLENGE_REDEEM_LIMIT_PER_HOUR = 20;
const CHALLENGE_ANSWER_LIMIT_PER_HOUR = 60;

/** Registry series ids are short hashes; anything longer names no series. */
const SERIES_ID_MAX_LENGTH = 128;

const refused = ({ set, err }: { set: StatusContext; err: unknown }): { error: string } => {
	if (err instanceof ChallengeNotFoundError) {
		set.status = 404;

		return { error: err.code };
	}

	if (err instanceof ChallengeError) {
		return badRequest(set, err.code);
	}

	throw err;
};

export const challengesRoutes = new Elysia({ prefix: '/api/v1/challenges' })
	.post(
		'/',
		async ({ request, set, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const limited = enforceLimit({
				set,
				name: 'challenge_create',
				ip: user.id,
				limit: CHALLENGE_CREATE_LIMIT_PER_HOUR,
				windowMs: HOUR_IN_MS
			});

			if (limited) {
				return limited;
			}

			try {
				return {
					challenge: await createChallenge({
						userId: user.id,
						seriesId: body.seriesId,
						showIdentity: body.showIdentity
					})
				};
			} catch (err) {
				return refused({ set, err });
			}
		},
		{
			body: t.Object({
				seriesId: t.String({ minLength: 1, maxLength: SERIES_ID_MAX_LENGTH }),
				showIdentity: t.Boolean()
			})
		}
	)
	.get('/mine', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listMyChallenges(user.id) };
	})
	.get('/answers', async ({ request, set }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		return { items: await listChallengeAnswers(user.id) };
	})
	// Public: the receiving page and the link preview read it before anyone
	// signs in. A session, when present, only decides `isOwner`; the answer
	// then belongs to that viewer, so no shared cache may keep it.
	.get('/:id', async ({ request, set, params }) => {
		const limited = enforceLimit({
			set,
			name: 'challenge_read',
			ip: clientIp(request),
			limit: CHALLENGE_READ_LIMIT_PER_HOUR,
			windowMs: HOUR_IN_MS
		});

		if (limited) {
			return limited;
		}

		const viewer = await requireUser(request);

		addVary(set, 'Cookie');

		if (nonNullish(viewer)) {
			set.headers['cache-control'] = 'private';
		}

		try {
			return { challenge: await getChallengeView({ id: params.id, viewerUserId: viewer?.id }) };
		} catch (err) {
			return refused({ set, err });
		}
	})
	.patch(
		'/:id',
		async ({ request, set, params, body }) => {
			const user = await requireUser(request);

			if (isNullish(user)) {
				return unauthenticated(set);
			}

			const limited = enforceLimit({
				set,
				name: 'challenge_consent',
				ip: user.id,
				limit: CHALLENGE_CONSENT_LIMIT_PER_HOUR,
				windowMs: HOUR_IN_MS
			});

			if (limited) {
				return limited;
			}

			try {
				return {
					challenge: await setChallengeConsent({
						userId: user.id,
						id: params.id,
						showIdentity: body.showIdentity
					})
				};
			} catch (err) {
				return refused({ set, err });
			}
		},
		{ body: t.Object({ showIdentity: t.Boolean() }) }
	)
	.delete('/:id', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		try {
			await revokeChallenge({ userId: user.id, id: params.id });

			return { ok: true };
		} catch (err) {
			return refused({ set, err });
		}
	})
	.post('/:id/redeem', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const limited = enforceLimit({
			set,
			name: 'challenge_redeem',
			ip: user.id,
			limit: CHALLENGE_REDEEM_LIMIT_PER_HOUR,
			windowMs: HOUR_IN_MS
		});

		if (limited) {
			return limited;
		}

		try {
			return { outcome: await redeemChallenge({ userId: user.id, id: params.id }) };
		} catch (err) {
			return refused({ set, err });
		}
	})
	.post('/:id/answer', async ({ request, set, params }) => {
		const user = await requireUser(request);

		if (isNullish(user)) {
			return unauthenticated(set);
		}

		const limited = enforceLimit({
			set,
			name: 'challenge_answer',
			ip: user.id,
			limit: CHALLENGE_ANSWER_LIMIT_PER_HOUR,
			windowMs: HOUR_IN_MS
		});

		if (limited) {
			return limited;
		}

		try {
			return { answer: await recordChallengeAnswer({ userId: user.id, id: params.id }) };
		} catch (err) {
			return refused({ set, err });
		}
	});
