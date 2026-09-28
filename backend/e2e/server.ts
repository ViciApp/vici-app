// End-to-end API server: the production app (src/index.ts) with its external
// dependencies swapped for local stand-ins, for the web2 Playwright suite.
//
//   - the engine actors and the VXP ledger are the deterministic fakes in
//     fake-engine.ts (no canister call ever leaves the process);
//   - outgoing email lands in an in-memory outbox, and `GET /__e2e/otp/:email`
//     hands the latest sign-in code back to the specs;
//   - `POST /__e2e/reset-rate-limits` clears the per-IP auth limiter, which
//     keys every local request on the same "unknown" IP and would otherwise
//     throttle a suite that signs in more than five times in ten minutes.
//
// These routes exist only on this entrypoint: src/index.ts never registers
// them, and guard.ts refuses to start this server outside a disposable local
// stack. Run with `bun run e2e:server`.

import { isNullish, nonNullish } from '@dfinity/utils';
import { applyAssetAllowlist } from '../src/custody/assets';
import { setEngineActorProvider } from '../src/engine/actors';
import { env } from '../src/env';
import { app } from '../src/index';
import { setEmailTransport } from '../src/lib/email';
import { logger } from '../src/lib/logger';
import { resetRateLimits } from '../src/lib/rate-limit';
import { setVxpLedgerProvider } from '../src/vxp/payout';
import { fakeEngineActorProvider, fakeVxpLedgerProvider } from './fake-engine';
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
		.post('/__e2e/reset-rate-limits', () => {
			resetRateLimits();

			return { ok: true };
		})
		.listen(env.port);

	logger.info(`vici e2e backend listening on :${env.port} (fake engine, in-memory outbox)`);
}
