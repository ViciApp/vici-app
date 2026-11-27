// End-to-end API server: the production app (src/index.ts) with its external
// dependencies swapped for local stand-ins, for the web2 Playwright suite.
//
//   - the engine actors and the VXP ledger are the deterministic fakes in
//     fake-engine.ts (no canister call ever leaves the process);
//   - outgoing email lands in an in-memory outbox, and `GET /__e2e/otp/:email`
//     hands the latest sign-in code back to the specs;
//   - `POST /__e2e/reset-rate-limits` clears the per-IP auth limiter, which
//     keys every local request on the same "unknown" IP and would otherwise
//     throttle a suite that signs in more than five times in ten minutes, and
//     the shared windows in Postgres, where the seeded admin's inbox would
//     run out after six sign-ins an hour;
//   - `POST /__e2e/fills` records an executed fill for an account in the fake
//     engine, so a spec can give a test account a call (orders are not served).
//
// These routes exist only on this entrypoint: src/index.ts never registers
// them, and guard.ts refuses to start this server outside a disposable local
// stack. Run with `bun run e2e:server`.

import { isNullish, nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import { t } from 'elysia';
import { applyAssetAllowlist } from '../src/custody/assets';
import { setEngineActorProvider } from '../src/engine/actors';
import { env } from '../src/env';
import { app } from '../src/index';
import { setEmailTransport } from '../src/lib/email';
import { userIcPrincipalText } from '../src/lib/keys';
import { logger } from '../src/lib/logger';
import { resetRateLimits, resetSharedRateLimits } from '../src/lib/rate-limit';
import { setVxpLedgerProvider } from '../src/vxp/payout';
import { fakeEngineActorProvider, fakeVxpLedgerProvider, seedFakeFill } from './fake-engine';
import { assertE2eEnvironment } from './guard';

/** Mirrors the OTP email copy in src/lib/email.ts. */
const OTP_CODE_PATTERN = /sign-in code is (\d+)/;

const latestOtpByEmail = new Map<string, string>();

if (import.meta.main) {
	assertE2eEnvironment(process.env);

	setEngineActorProvider(fakeEngineActorProvider);
	setVxpLedgerProvider(fakeVxpLedgerProvider);
	setEmailTransport(({ to, text }) => {
		const code = OTP_CODE_PATTERN.exec(text)?.[1];

		if (nonNullish(code)) {
			latestOtpByEmail.set(to.toLowerCase(), code);
		}

		return Promise.resolve();
	});

	// Same boot step as src/index.ts, but awaited before listening: the suite
	// starts as soon as the server answers, so the asset flags must already
	// match the env by then.
	await applyAssetAllowlist();

	app
		.get('/__e2e/otp/:email', ({ params, set }) => {
			const code = latestOtpByEmail.get(decodeURIComponent(params.email).toLowerCase());

			if (isNullish(code)) {
				set.status = 404;

				return { error: 'not_found' };
			}

			return { code };
		})
		.post('/__e2e/reset-rate-limits', async () => {
			resetRateLimits();
			await resetSharedRateLimits();

			return { ok: true };
		})
		.post(
			'/__e2e/fills',
			({ body }) => {
				seedFakeFill({
					owner: Principal.fromText(userIcPrincipalText(body.userId)),
					seriesId: body.seriesId,
					side: body.side,
					entryPriceBps: body.entryPriceBps,
					qty: BigInt(body.qty)
				});

				return { ok: true };
			},
			{
				body: t.Object({
					userId: t.String(),
					seriesId: t.String(),
					side: t.Union([t.Literal('YES'), t.Literal('NO')]),
					entryPriceBps: t.Integer({ minimum: 1, maximum: 9999 }),
					qty: t.Integer({ minimum: 1 })
				})
			}
		)
		.listen(env.port);

	logger.info(`vici e2e backend listening on :${env.port} (fake engine, in-memory outbox)`);
}
