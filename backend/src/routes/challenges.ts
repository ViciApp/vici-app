// Challenge links: issue one for the caller's own call, the public read of
// it, the owner's consent switch and revocation, the redemption that credits
// the challenger as referrer, the engine-verified answer, and the owner's two
// lists. No challenge endpoint takes a Turnstile token: every write needs a
// session (and, to create or answer, a real engine position), and the public
// read is addressed by an 80-bit random id behind a per-IP limit.

import { isNullish } from '@dfinity/utils';
import { Elysia, t } from 'elysia';
import { requireUser, unauthenticated } from '../auth/guard';
import { env } from '../env';
import { badRequest, clientIp, type StatusContext } from '../lib/http';
import { enforceLimit, enforceSharedLimit } from '../lib/rate-limit';
import { HOUR_IN_MS } from '../lib/time';
import {
	listChallengeAnswers,
	recordChallengeAnswer,
	redeemChallenge
} from '../social/challenge-answers';
import { challengeMarketTitle, renderChallengeHead } from '../social/challenge-head';
import {
	ChallengeError,
	ChallengeNotFoundError,
	createChallenge,
	getChallengeView,
	listMyChallenges,
	requireChallengeId,
	revokeChallenge,
	setChallengeConsent
} from '../social/challenges';

// The public read resolves a bearer id, so it is limited per client IP; the
// budget matches the referral lookup's, room for a class on one network
// opening the same link.
const CHALLENGE_READ_LIMIT_PER_HOUR = 120;

// The head fragment is fetched by the web image's nginx, so its requests
// carry the web machine's address (Fly's edge sets it): this is a ceiling for
// the whole web tier, counted in Postgres so it holds however many API
// machines run, not a per-visitor budget. nginx limits each visitor and
// renders an id at most once a minute (nginx.web.conf). One render a second
// on average leaves a preview storm across many ids room before the stub
// takes over; a direct caller gets a budget of its own address.
const CHALLENGE_HEAD_LIMIT_PER_HOUR = 3600;

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

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
	// signs in.
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

		try {
			return { challenge: await getChallengeView(params.id) };
		} catch (err) {
			return refused({ set, err });
		}
	})
	// The link preview's head fragment, included by nginx into the shell it
	// serves on /c/<id>. A link that reads as not found answers 404 with an
	// empty body, so nginx keeps the generic preview.
	.get('/:id/head', async ({ request, set, params }) => {
		const limited = await enforceSharedLimit({
			set,
			name: 'challenge_head',
			key: clientIp(request) ?? 'unknown',
			limit: CHALLENGE_HEAD_LIMIT_PER_HOUR,
			windowMs: HOUR_IN_MS
		});

		if (limited) {
			return limited;
		}

		try {
			const id = requireChallengeId(params.id);
			const view = await getChallengeView(id);

			set.headers['content-type'] = HTML_CONTENT_TYPE;

			return renderChallengeHead({
				id,
				view,
				marketTitle: await challengeMarketTitle(view.seriesId),
				appOrigin: env.publicAppUrl
			});
		} catch (err) {
			if (err instanceof ChallengeNotFoundError) {
				set.status = 404;

				return '';
			}

			throw err;
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
