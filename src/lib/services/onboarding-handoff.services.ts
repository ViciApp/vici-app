import type { AppLocale } from '#lib/constants/locale.constants.ts';
import { PENDING_ONBOARDING_STORAGE_KEY } from '#lib/constants/profile.constants.ts';
import {
	REFERRAL_CODE_REGEX,
	REFERRAL_EXISTING_USER_REASON,
	REFERRAL_VXP_BONUS_BASE_UNITS
} from '#lib/constants/referral.constants.ts';
import { track } from '#lib/services/analytics.services.ts';
import { joinLeagueByInvite } from '#lib/services/leagues.services.ts';
import {
	applyOnboardingPicks,
	checkNicknameAvailability,
	saveMyEmail,
	wasBootstrappedThisSession
} from '#lib/services/profile.services.ts';
import { claimReferralFriendship, redeemReferralCode } from '#lib/services/referral.services.ts';
import { notificationsStore } from '#lib/stores/notification.store.ts';
import { userStore } from '#lib/stores/user.store.ts';
import { LEAGUE_INVITE_CODE_REGEX } from '#lib/types/league.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { t } from '#lib/utils/i18n.utils.ts';
import { formatVxpBalance } from '#lib/utils/playground-display.utils.ts';
import { browser } from '$app/env';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Pre-auth onboarding payload stashed under {@link PENDING_ONBOARDING_STORAGE_KEY} while the
 * visitor is signed-out (by the 3-beat onboarding flow, the `/i/{code}` referral landing, the
 * `/league/[code]` invite landing, or a share-link `?ref=` capture). Drained post-signin by
 * {@link drainPendingOnboarding}.
 */
interface PendingOnboarding {
	handle: string | null;
	participantId: string | null;
	side: 'YES' | 'NO' | null;
	interests: string[];
	email?: string;
	referralCode?: string;
	leagueInvite?: string;
	/**
	 * How many times the league auto-join has been attempted so far (0 on the first drain,
	 * incremented each time a transient failure re-stashes the code). Bounds the
	 * {@link MAX_DRAIN_ATTEMPTS} retry loop the same way {@link referralAttempts} does for the
	 * referral side-flow.
	 */
	leagueAttempts?: number;
	/**
	 * Which sign-in provider finished the flow (stashed by `SignInProviderStack`
	 * before the provider runs, so it survives a redirect). Drives the
	 * `onboarding_completed` analytics dimension; absent on a stash written by a
	 * pre-provider surface.
	 */
	provider?: OnboardingProvider;
	/**
	 * How many times the referral redeem/claim has been attempted so far (0 on the first drain,
	 * incremented each time a transient failure re-stashes the code). Bounds the
	 * {@link MAX_DRAIN_ATTEMPTS} retry loop so a persistently failing redeem can't keep the
	 * slot armed forever.
	 */
	referralAttempts?: number;
}

/**
 * Upper bound on the referral redeem/claim and league auto-join retries (each side-flow counts
 * its own attempts). A transient failure (network / replica blip) re-stashes the bare code so the
 * next drain re-attempts it — but only up to this many times, after which the slot is abandoned so
 * a hard failure doesn't loop indefinitely.
 */
const MAX_DRAIN_ATTEMPTS = 3;

/** Bounded vocabulary of sign-in providers, for the completion analytics. */
const ONBOARDING_PROVIDERS = ['apple', 'google', 'email', 'ii', 'passkey', 'dev'] as const;
export type OnboardingProvider = (typeof ONBOARDING_PROVIDERS)[number];

const isOnboardingProvider = (value: unknown): value is OnboardingProvider =>
	typeof value === 'string' && (ONBOARDING_PROVIDERS as readonly string[]).includes(value);

/**
 * Substrings of the satellite's deterministic referral rejections (bad code, already redeemed,
 * self-referral, …). These are terminal — retrying can't change the outcome — so a match resolves
 * the slot rather than re-stashing it. Anything NOT in this set (a thrown agent / replica error)
 * is treated as transient and kept for a bounded retry.
 */
const TERMINAL_REFERRAL_REASONS = [
	'Invalid referral code',
	'already redeemed',
	'Unknown referral code',
	'cannot redeem your own',
	'cannot use your own',
	'Create your profile'
];

const isTerminalReferralReason = (reason: string): boolean =>
	TERMINAL_REFERRAL_REASONS.some((terminal) => reason.includes(terminal));

/**
 * Typed outcome of {@link drainPendingOnboarding}. The layout maps this to the primary
 * notification toast; the best-effort referral / league side-flows surface their own toasts
 * from inside the service.
 */
export type DrainOutcome =
	| { kind: 'noop' }
	| { kind: 'account_exists'; nickname: string }
	| { kind: 'applied' }
	| { kind: 'collision'; handle: string }
	| { kind: 'failed' };

const parsePendingOnboarding = (raw: string): PendingOnboarding | undefined => {
	let parsed: unknown;

	try {
		parsed = JSON.parse(raw);
	} catch {
		parsed = null;
	}

	if (typeof parsed !== 'object' || isNullish(parsed)) {
		return;
	}

	// Tolerate legacy payloads — older clients wrote `handle` as the
	// only required field. New clients also serialize team + side, but
	// any combination of {handle, participantId, side} may be null.
	const handle =
		'handle' in parsed && typeof parsed.handle === 'string' && parsed.handle.length > 0
			? parsed.handle
			: null;
	const participantId =
		'participantId' in parsed &&
		typeof parsed.participantId === 'string' &&
		parsed.participantId.length > 0
			? parsed.participantId
			: null;
	const rawSide = 'side' in parsed && typeof parsed.side === 'string' ? parsed.side : null;
	const side: 'YES' | 'NO' | null = rawSide === 'YES' || rawSide === 'NO' ? rawSide : null;

	const interests =
		'interests' in parsed && Array.isArray(parsed.interests)
			? parsed.interests.filter((interest): interest is string => typeof interest === 'string')
			: [];
	const email =
		'email' in parsed && typeof parsed.email === 'string' && parsed.email.trim().length > 0
			? parsed.email.trim()
			: undefined;
	const rawReferral =
		'referralCode' in parsed && typeof parsed.referralCode === 'string'
			? parsed.referralCode.toUpperCase().trim()
			: undefined;
	const referralCode =
		rawReferral && REFERRAL_CODE_REGEX.test(rawReferral) ? rawReferral : undefined;
	const rawLeagueInvite =
		'leagueInvite' in parsed && typeof parsed.leagueInvite === 'string'
			? parsed.leagueInvite.toUpperCase().trim()
			: undefined;
	const leagueInvite =
		rawLeagueInvite && LEAGUE_INVITE_CODE_REGEX.test(rawLeagueInvite) ? rawLeagueInvite : undefined;
	const referralAttempts =
		'referralAttempts' in parsed &&
		typeof parsed.referralAttempts === 'number' &&
		Number.isFinite(parsed.referralAttempts) &&
		parsed.referralAttempts > 0
			? Math.floor(parsed.referralAttempts)
			: 0;
	const leagueAttempts =
		'leagueAttempts' in parsed &&
		typeof parsed.leagueAttempts === 'number' &&
		Number.isFinite(parsed.leagueAttempts) &&
		parsed.leagueAttempts > 0
			? Math.floor(parsed.leagueAttempts)
			: 0;

	// At least one actionable signal is required for the payload to be useful — onboarding
	// picks (handle / participantId / side) drive the profile upsert, `referralCode` drives
	// the redeem-or-friendship flow, `leagueInvite` drives the auto-join, and `email` (stashed
	// by the passkey-backed email sign-up) is persisted onto the new profile. A bare payload
	// with none of those is dropped so the caller can clear the slot.
	if (
		isNullish(handle) &&
		isNullish(participantId) &&
		isNullish(side) &&
		isNullish(referralCode) &&
		isNullish(leagueInvite) &&
		isNullish(email)
	) {
		return;
	}

	const provider =
		'provider' in parsed && isOnboardingProvider(parsed.provider) ? parsed.provider : undefined;

	return {
		handle,
		participantId,
		side,
		interests,
		email,
		referralCode,
		leagueInvite,
		referralAttempts,
		leagueAttempts,
		provider
	};
};

/**
 * Post-signin redemption of the pre-auth referral code. Tries the VXP-bonus redeem first and
 * falls back to a friendship-only claim when the signup window has elapsed. The friendship is the
 * whole point of the invite, so a transient failure must NOT silently drop the code — instead this
 * reports back whether the slot reached a terminal outcome.
 *
 * @returns `true` when the referral is resolved or has terminally failed (bad code, already
 *   redeemed, self-referral, …) — the caller should clear the slot. `false` when the call failed
 *   transiently (network / replica) and the caller should keep the code for a bounded retry.
 */
const resolvePendingReferral = async ({
	code,
	locale,
	source
}: {
	code: string | undefined;
	locale: AppLocale;
	source: string;
}): Promise<boolean> => {
	if (!code) {
		return true;
	}

	const notifyFailed = (reason: string): void => {
		notificationsStore.add({
			title: t({
				locale,
				key: 'onboarding.handoff.referral_failed_title'
			}),
			message: t({
				locale,
				key: 'onboarding.handoff.referral_failed',
				params: { reason: reason || code }
			}),
			type: 'error'
		});
	};

	try {
		await redeemReferralCode({ code });

		track({ name: 'referral_redeemed', source });

		notificationsStore.add({
			title: t({
				locale,
				key: 'onboarding.handoff.referral_ok_title'
			}),
			message: t({
				locale,
				key: 'onboarding.handoff.referral_ok',
				params: { amount: formatVxpBalance({ value: REFERRAL_VXP_BONUS_BASE_UNITS }) }
			}),
			type: 'success'
		});

		return true;
	} catch (err: unknown) {
		const reason = err instanceof Error ? err.message : '';

		// Signup-window grace period elapsed (clicked the invite, took >24h to finish
		// signing up). The VXP bonus is forfeited, but we still want the friendship to
		// land — otherwise the click attribution was wasted. The satellite is idempotent
		// if a relation already exists.
		if (reason === REFERRAL_EXISTING_USER_REASON) {
			try {
				await claimReferralFriendship({ code });

				track({ name: 'referral_redeemed', source });

				notificationsStore.add({
					title: t({
						locale,
						key: 'onboarding.handoff.referral_late_title'
					}),
					message: t({
						locale,
						key: 'onboarding.handoff.referral_late'
					}),
					type: 'info'
				});

				return true;
			} catch (friendErr: unknown) {
				const friendReason = friendErr instanceof Error ? friendErr.message : '';

				// `redeemReferralCode` throws the signup-window reason *before* validating the
				// code/owner, so the claim is the first call to reach those checks — a bad code or
				// self-referral surfaces deterministically here. Treat those as terminal (surface +
				// clear); keep only genuine transient failures for a bounded retry.
				if (isTerminalReferralReason(friendReason)) {
					notifyFailed(friendReason);

					return true;
				}

				console.warn('claimReferralFriendship fallback failed', friendReason || friendErr);

				return false;
			}
		}

		// Deterministic rejection (bad code, already redeemed, self-referral) — retrying can't
		// help, so surface it and let the caller clear the slot.
		if (isTerminalReferralReason(reason)) {
			notifyFailed(reason);

			return true;
		}

		// Anything else (thrown agent / replica error) is transient — keep the code armed.
		console.warn('referral redeem transient failure', reason || err);

		return false;
	}
};

/**
 * Substrings of the deterministic league-join rejections surfaced by `joinLeagueByInvite`
 * (malformed code, no league behind the code), each mapped to the toast copy the signed-in
 * `/league/[code]` landing uses for the same case. Terminal — retrying can't change the
 * outcome — so a match resolves the slot rather than re-stashing it. Anything NOT in this set
 * (a thrown agent / replica error) is treated as transient and kept for a bounded retry.
 */
const TERMINAL_LEAGUE_REASONS = [
	{ match: 'Invite code is malformed', toast: 'invalid' },
	{ match: 'No league found for that invite', toast: 'unknown' }
] as const;

const terminalLeagueReason = (
	reason: string
): (typeof TERMINAL_LEAGUE_REASONS)[number] | undefined =>
	TERMINAL_LEAGUE_REASONS.find(({ match }) => reason.includes(match));

/**
 * Post-signin auto-join of the pre-auth league invite (stashed by `/league/[code]` when the
 * user was signed-out). Idempotent — "already a member" is a silent no-op.
 *
 * @returns `true` when the invite is resolved (joined, already a member) or has terminally
 *   failed (malformed / unknown code) — the caller should clear the slot. `false` when the call
 *   failed transiently (network / replica) and the caller should keep the code for a bounded
 *   retry, so a blip during the drain doesn't silently drop the join.
 */
const joinPendingLeagueIfAny = async ({
	code,
	locale
}: {
	code: string | undefined;
	locale: AppLocale;
}): Promise<boolean> => {
	if (!code) {
		return true;
	}

	try {
		const league = await joinLeagueByInvite({ inviteCode: code });

		notificationsStore.add({
			title: t({
				locale,
				key: 'league_invite.joined_title',
				params: { name: league.name }
			}),
			message: t({ locale, key: 'league_invite.joined_body' }),
			type: 'success'
		});

		return true;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : '';

		// Already a member is a no-op success — nothing to surface.
		if (message === 'Already a member of this league.') {
			return true;
		}

		// Deterministic rejection — retrying can't help, so tell the user which kind it was
		// (the invitee otherwise lands in the app believing they joined).
		const terminal = terminalLeagueReason(message);

		if (nonNullish(terminal)) {
			console.warn('joinPendingLeagueIfAny terminally failed', message);

			notificationsStore.add({
				title: t({
					locale,
					key:
						terminal.toast === 'unknown'
							? 'league_invite.unknown_title'
							: 'league_invite.invalid_title'
				}),
				message: t({
					locale,
					key:
						terminal.toast === 'unknown'
							? 'league_invite.unknown_body'
							: 'league_invite.invalid_body'
				}),
				type: 'error'
			});

			return true;
		}

		console.warn('joinPendingLeagueIfAny transient failure', message || err);

		return false;
	}
};

/**
 * Cheap synchronous peek: is there a pending-onboarding payload stashed? Lets the caller skip
 * arming its mid-drain guard when there's nothing to drain (so the forced-onboarding redirect
 * isn't held off on the common empty path). Browser-guarded — `false` in any non-browser context.
 */
export const hasPendingOnboarding = (): boolean =>
	browser && nonNullish(localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY));

/**
 * Cheap synchronous peek at the stashed sign-in provider
 * (`SignInProviderStack` merges it into the pending payload before the
 * provider runs). Lets an auth-success emitter (e.g. the guest-convert
 * `signed_up`) attach the bounded provider dimension without threading a
 * callback argument through the sheet stack. Reads the raw payload rather
 * than {@link parsePendingOnboarding} so a bare `{ provider }` stash (no
 * actionable picks) still resolves. Best-effort: `undefined` outside the
 * browser, on storage failure, or when nothing valid is stashed.
 */
export const pendingOnboardingProvider = (): OnboardingProvider | undefined => {
	if (!browser) {
		return;
	}

	try {
		const raw = localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY);

		if (isNullish(raw)) {
			return;
		}

		const parsed: unknown = JSON.parse(raw);

		if (typeof parsed !== 'object' || isNullish(parsed) || !('provider' in parsed)) {
			return;
		}

		const { provider } = parsed;

		return isOnboardingProvider(provider) ? provider : undefined;
	} catch {
		// Storage unavailable / malformed stash — the dimension is simply absent.
	}
};

/**
 * Settles the pre-auth storage slot once the referral and league side-flows have run. Clears it
 * when both resolved (or were absent); otherwise re-stashes only the unresolved bare code(s),
 * each with its own incremented attempt counter so the next drain retries — until
 * {@link MAX_DRAIN_ATTEMPTS} is reached, after which that code is abandoned so a hard failure
 * can't loop forever.
 *
 * The profile picks are intentionally dropped from the retry payload: the profile is already
 * applied.
 *
 * Abandoning a league invite (retry budget exhausted on a still-transient failure) surfaces the
 * generic join-failure toast — without it the user would believe they joined. They can still
 * join manually with the code afterwards.
 */
const settlePendingSlot = ({
	pending,
	referralResolved,
	leagueResolved,
	locale
}: {
	pending: PendingOnboarding;
	referralResolved: boolean;
	leagueResolved: boolean;
	locale: AppLocale;
}): void => {
	if (!browser) {
		return;
	}

	const referralAttempts = pending.referralAttempts ?? 0;
	const leagueAttempts = pending.leagueAttempts ?? 0;

	const keepReferral =
		!referralResolved &&
		nonNullish(pending.referralCode) &&
		referralAttempts + 1 < MAX_DRAIN_ATTEMPTS;
	const keepLeague =
		!leagueResolved && nonNullish(pending.leagueInvite) && leagueAttempts + 1 < MAX_DRAIN_ATTEMPTS;

	if (!leagueResolved && nonNullish(pending.leagueInvite) && !keepLeague) {
		notificationsStore.add({
			title: t({ locale, key: 'league_invite.error_title' }),
			message: t({ locale, key: 'league_invite.error_body' }),
			type: 'error'
		});
	}

	if (!keepReferral && !keepLeague) {
		localStorage.removeItem(PENDING_ONBOARDING_STORAGE_KEY);

		return;
	}

	localStorage.setItem(
		PENDING_ONBOARDING_STORAGE_KEY,
		JSON.stringify({
			...(keepReferral && {
				referralCode: pending.referralCode,
				referralAttempts: referralAttempts + 1
			}),

			...(keepLeague && {
				leagueInvite: pending.leagueInvite,
				leagueAttempts: leagueAttempts + 1
			})
		})
	);
};

/**
 * Drains the pre-auth onboarding payload for a freshly signed-in session: parses the stash,
 * branches on returning-vs-new user, applies the profile upsert (with a nickname-collision
 * probe), awaits the referral redeem/claim and the idempotent league auto-join, then settles the
 * storage slot via {@link settlePendingSlot} (cleared on terminal outcomes, or re-armed with the
 * unresolved bare code(s) for a bounded retry on a transient failure). Returns a
 * {@link DrainOutcome} the caller maps to the primary notification toast.
 *
 * Preconditions (the caller must already have verified): running in the browser, signed-in,
 * a hydrated `userStore.profile`, and that this is not already mid-drain.
 *
 * @param locale the active app locale, for the best-effort side-flow toasts emitted here.
 * @param profile the hydrated profile snapshot (`$userStore.profile`).
 * @param profileExisted whether the satellite already held a profile at sign-in time
 *        (`$userStore.profileExisted`).
 */
export const drainPendingOnboarding = async ({
	locale,
	profile,
	profileExisted
}: {
	locale: AppLocale;
	profile: UserProfile;
	profileExisted: boolean;
}): Promise<DrainOutcome> => {
	if (!browser) {
		return { kind: 'noop' };
	}

	const raw = localStorage.getItem(PENDING_ONBOARDING_STORAGE_KEY);

	if (!raw) {
		return { kind: 'noop' };
	}

	const pending = parsePendingOnboarding(raw);

	if (!pending) {
		localStorage.removeItem(PENDING_ONBOARDING_STORAGE_KEY);

		return { kind: 'noop' };
	}

	// Returning user — the satellite already had a profile for this
	// principal at sign-in time. The pending onboarding (picked
	// pre-auth, while signed-out) belongs to a different intent;
	// silently overwriting their saved nickname / interests / email
	// is destructive. Preserve the existing profile and tell them.
	//
	// A stashed `referralCode` is the one piece of the payload that
	// *is* still actionable for a returning user: a genuine returning
	// user can't redeem the VXP bonus (the satellite's signup-window
	// check rejects them, falling back to a friendship-only claim), but
	// they still land in the inviter's friends list. We await the
	// resolve below so the slot is settled correctly — re-armed for a
	// bounded retry on a transient failure rather than silently dropped.
	// `profileExisted` alone is racy: a second `onAuthStateChange` pass during a
	// fresh sign-in re-reads the doc this session just bootstrapped and reports
	// it as pre-existing, which would route a brand-new user here and drop their
	// picks. Trust the deterministic session capture — only a principal whose
	// doc predates this session is a genuine returning user.
	const isReturningUser = profileExisted && !wasBootstrappedThisSession(profile.owner);

	if (isReturningUser) {
		// A stashed league invite is still actionable for a returning user — join is
		// independent of the signup bonus and idempotent. `resolvePendingReferral` tries the
		// bonus redeem first and falls back to a friendship-only claim when the signup window
		// has elapsed (the case for a genuine returning user). Both also cover the retry of a
		// re-stashed code from an earlier drain that failed transiently — if the referral retry
		// still lands inside the window, the bonus is honoured. Await both so the slot is
		// settled (cleared, or re-armed per unresolved code for a bounded retry).
		const [leagueResolved, referralResolved] = await Promise.all([
			joinPendingLeagueIfAny({ code: pending.leagueInvite, locale }),
			resolvePendingReferral({
				code: pending.referralCode,
				locale,
				source: nonNullish(pending.leagueInvite) ? 'league_invite' : 'onboarding'
			})
		]);
		settlePendingSlot({ pending, referralResolved, leagueResolved, locale });

		return { kind: 'account_exists', nickname: profile.nickname };
	}

	// Onboarding picks live under `preferences`. Always apply
	// team/side/onboardingCompleted on the new-user path — the user
	// just finished the 3-beat flow, so completion is recorded even
	// when they skipped the picks. Preserve everything else under
	// `preferences` so the seed defaults stay intact.
	const sidePreference = pending.side ?? '';
	const participantPreference = pending.participantId ?? '';

	try {
		// Pre-flight: a brand-new user can still collide if the handle was claimed in the window
		// between onboarding step 4 and sign-in landing. Probe first so we can keep
		// team/side/onboardingCompleted (which are independent of the handle) and let the user
		// rename later from their profile. Any unavailable reason — `'taken'`, or the
		// `'too_short'` / `'required'` cases that `parsePendingOnboarding`'s tolerated legacy
		// payloads can still produce — skips the nickname update; only `'taken'` is worth a toast.
		let setHandle = false;
		let handleCollision = false;

		if (nonNullish(pending.handle)) {
			const probe = await checkNicknameAvailability({
				nickname: pending.handle,
				principal: profile.owner
			});

			if (probe.available) {
				setHandle = true;
			} else if (probe.reason === 'taken') {
				handleCollision = true;
			}
		}

		// Field-level patch (NOT a full-snapshot write): `calculateAndSyncStats` writes this same
		// doc concurrently on the finishing login, so a stale full snapshot would lose the
		// optimistic-version race and throw — silently dropping these picks. A handle claimed in
		// the TOCTOU window after the probe is dropped here (the rest still persists), reported via
		// `handleApplied`.
		const { profile: nextProfile, handleApplied } = await applyOnboardingPicks({
			principal: profile.owner,
			handle: pending.handle,
			setHandle,
			interests: pending.interests,
			favoriteParticipantId: participantPreference,
			favoriteSide: sidePreference
		});

		if (setHandle && !handleApplied) {
			handleCollision = true;
		}

		userStore.update((curr) => ({ ...curr, profile: nextProfile }));

		// The stashed email (passkey-backed email sign-up) goes to the
		// owner-private `profile_private` doc, never the public profile.
		// Best-effort like every other drain side-flow: a failed write
		// must not sink the picks that already landed.
		const pendingEmail = pending.email?.trim() ?? '';

		if (pendingEmail.length > 0) {
			try {
				await saveMyEmail({ principal: profile.owner, email: pendingEmail });
				userStore.update((curr) => ({ ...curr, email: pendingEmail }));
			} catch (err: unknown) {
				console.warn('Onboarding handoff: email persist failed', err);
			}
		}

		// Redeem after the profile is in place so the satellite assertion (which requires an
		// existing profile) passes. Await both side-flows so the slot is only cleared once each
		// has terminally resolved — a transient failure re-arms that code for a bounded retry
		// instead of silently dropping the friendship + bonus or the league join. Redeeming
		// itself does no ledger transfer (the bonus is deferred to the referee's first trade),
		// so this stays cheap; the league join is idempotent. A handle collision is independent
		// of all this — the user is still a new sign-up and deserves the bonus.
		const [leagueResolved, referralResolved] = await Promise.all([
			joinPendingLeagueIfAny({ code: pending.leagueInvite, locale }),
			resolvePendingReferral({
				code: pending.referralCode,
				locale,
				source: nonNullish(pending.leagueInvite) ? 'league_invite' : 'onboarding'
			})
		]);
		settlePendingSlot({ pending, referralResolved, leagueResolved, locale });

		// Activation milestone. `label` carries the finishing provider (bounded
		// vocab, stashed pre-redirect) and `ok` whether a team was persisted —
		// the dimensions that make a provider-specific persistence regression
		// visible. Reuses existing props (no new key → no analytics schema regen).
		track({
			name: 'onboarding_completed',
			source: 'onboarding',
			...(nonNullish(pending.provider) && { label: pending.provider }),
			ok: participantPreference.length > 0
		});

		return handleCollision
			? { kind: 'collision', handle: pending.handle ?? '' }
			: { kind: 'applied' };
	} catch (err: unknown) {
		// A handle collision is handled inside `applyOnboardingPicks` (it retries without the
		// handle and reports it via `handleApplied`), so anything reaching here is a genuine
		// failure to persist. Surface it — the generic toast otherwise swallows it, which is what
		// made this class of bug invisible.
		console.error('Onboarding handoff (pre-auth drain) failed:', err);

		localStorage.removeItem(PENDING_ONBOARDING_STORAGE_KEY);

		return { kind: 'failed' };
	}
};
