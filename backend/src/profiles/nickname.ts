// Handle (= profiles.nickname) rules. Every handle picked or changed here
// follows the handle rule: lowercase a-z and 0-9, 3 to 15 characters, and no
// lookalike of another account's handle (same letters and digits once case,
// accents and separators are ignored). The rule, the letter table and the
// reserved keys mirror src/lib/constants/handle.constants.ts, pinned by the
// shared-drift suite. The legacy nickname rule below stays for the profile
// search bound and the nickname_key unique index, which predate the rule.

import { isNullish } from '@dfinity/utils';
import { query, type TxQuery } from '../db/client';
import { DAY_IN_MS, MINUTE_IN_MS, TEN_MINUTES_IN_MS } from '../lib/time';

export const MIN_NICKNAME_LENGTH = 2;
export const MAX_NICKNAME_LENGTH = 16;

/** Validates the legacy stored charset (letters + digits + '. _ -'). */
export const NICKNAME_PATTERN = new RegExp('^[\\p{L}\\p{M}0-9._-]+$', 'u');

export const MIN_HANDLE_LENGTH = 3;
export const MAX_HANDLE_LENGTH = 15;

/** Lowercase a-z and 0-9 only, {@link MIN_HANDLE_LENGTH} to {@link MAX_HANDLE_LENGTH}. */
export const HANDLE_PATTERN = new RegExp(`^[a-z0-9]{${MIN_HANDLE_LENGTH},${MAX_HANDLE_LENGTH}}$`);

/** Latin letters NFKD leaves whole, spelled plainly after lowercasing. The SQL
 * twin, handle_fold (migration 0026), carries the same table. */
export const HANDLE_LETTER_FOLDS: ReadonlyArray<readonly [string, string]> = [
	['ß', 'ss'],
	['æ', 'ae'],
	['œ', 'oe'],
	['ø', 'o'],
	['ł', 'l'],
	['đ', 'd'],
	['ð', 'd'],
	['þ', 'th'],
	['ı', 'i']
];

const OUTSIDE_HANDLE_CHARS = new RegExp('[^a-z0-9]', 'g');

/**
 * The lookalike key: NFKD, lowercased, {@link HANDLE_LETTER_FOLDS} applied,
 * everything outside a-z0-9 removed. 'antonio.ventilii', 'Antonio_Ventilii'
 * and 'antonioventílii' all read 'antonioventilii'; a handle within the rule
 * is its own key; another script folds to '' (never a collision). Stored as
 * profiles.handle_key.
 */
export const handleUniqueKey = (raw: string): string =>
	HANDLE_LETTER_FOLDS.reduce(
		(folded, [letter, plain]) => folded.replaceAll(letter, plain),
		raw.normalize('NFKD').toLowerCase()
	).replace(OUTSIDE_HANDLE_CHARS, '');

/** Handles only VICI may use, as handle keys. */
export const RESERVED_HANDLE_KEYS: ReadonlySet<string> = new Set([
	// Brand and company
	'vici',
	'viciai',
	'viciapp',
	'vicibot',
	'vicihq',
	'vicilabs',
	'vicilabsltd',
	'vicimarket',
	'vicimarkets',
	'vicinews',
	'viciofficial',
	'viciteam',
	'vicitoken',
	'vicixp',
	'venividivici',
	'wholesome',
	'official',
	'team',
	// Products, features and characters
	'archivist',
	'arena',
	'battles',
	'flow',
	'flowmode',
	'league',
	'leagues',
	'oracle',
	'trickster',
	'vxp',
	'worlds',
	// Staff, roles and mailboxes
	'abuse',
	'admin',
	'admins',
	'administrator',
	'billing',
	'careers',
	'ceo',
	'cfo',
	'compliance',
	'coo',
	'cto',
	'founder',
	'founders',
	'giovannitosi',
	'hello',
	'help',
	'hostmaster',
	'info',
	'investors',
	'legal',
	'mod',
	'moderation',
	'moderator',
	'mods',
	'noreply',
	'postmaster',
	'press',
	'privacy',
	'reply',
	'resolution',
	'safety',
	'security',
	'staff',
	'support',
	'sysadmin',
	'timschwartz',
	'trustandsafety',
	'viciadmin',
	'viciantonio',
	'vicigio',
	'vicisupport',
	'vicitim',
	'webmaster',
	// System voices and technical names
	'announcements',
	'anonymous',
	'api',
	'bot',
	'everyone',
	'guest',
	'leaderboard',
	'markets',
	'news',
	'notifications',
	'null',
	'payments',
	'payouts',
	'rewards',
	'root',
	'status',
	'system',
	'treasury',
	'undefined',
	'updates',
	'www'
]);

/**
 * The transaction-scoped lock every write of a handle takes on the handle's
 * key before it looks for a lookalike, so two writers of the same key
 * serialise (handle_key is not unique while lookalikes predating the rule
 * remain). Released at commit or rollback.
 */
export const lockHandleKey = async ({ key, q }: { key: string; q: TxQuery }): Promise<void> => {
	await q(`select pg_advisory_xact_lock(hashtext('handle:' || $1))`, [key]);
};

/**
 * Case- + accent-insensitive uniqueness key: 'Jose' with an accent, 'JOSE'
 * and 'jose' all fold to 'jose'. Trim, NFKD, strip combining marks,
 * lowercase. Separators '. _ -' are kept ('a_b' stays distinct from 'ab').
 * Used for collisions AND handle-change detection so both sides agree on
 * "the same handle".
 */
const COMBINING_DIACRITICAL_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export const nicknameUniqueKey = (raw: string): string =>
	raw.trim().normalize('NFKD').replace(COMBINING_DIACRITICAL_MARKS, '').toLowerCase();

/**
 * A handle can be changed once every {@link HANDLE_COOLDOWN_DAYS} days. The
 * profile carries a handle_last_change_ms stamp; the profile write guard
 * rejects a handle change while the stored value is inside the window and
 * requires the stamp to move to ~now on an allowed change.
 */
export const HANDLE_COOLDOWN_DAYS = 30;

/**
 * Tolerance (ms) for the "is handle_last_change_ms set to ~now?" check on an
 * allowed handle change. The client stamps its wall clock before the update
 * is submitted, so by validation time the value is slightly in the past;
 * allow a small slack on both sides (clock skew + request latency) but
 * reject values that are clearly stale or in the future, so a client cannot
 * backdate the stamp and dodge the cooldown.
 */
export const HANDLE_LAST_CHANGE_TOLERANCE_MS = 5 * MINUTE_IN_MS;

/**
 * Whole days the owner must still wait before the handle can change again.
 * Returns 0 when the cooldown has elapsed or no prior change is on record.
 * A stamp skewed slightly into the future yields a negative day delta, so
 * the result is clamped to the full window as the hard ceiling.
 */
export const handleCooldownDaysLeft = ({
	lastChangeMs,
	nowMs
}: {
	lastChangeMs: number | undefined | null;
	nowMs: number;
}): number => {
	if (isNullish(lastChangeMs) || lastChangeMs <= 0) {
		return 0;
	}

	const daysSince = Math.floor((nowMs - lastChangeMs) / DAY_IN_MS);

	if (daysSince >= HANDLE_COOLDOWN_DAYS) {
		return 0;
	}

	return Math.min(HANDLE_COOLDOWN_DAYS, HANDLE_COOLDOWN_DAYS - daysSince);
};

/**
 * The anonymous availability probe answers a signed-out visitor picking a
 * handle before sign-up. A Turnstile solve per keystroke would be slow and
 * visible, so one solve buys a proof bound to the caller's IP for
 * {@link NICKNAME_CHECK_PROOF_TTL_MS}, and the probe only checks that proof.
 * The action is the one the app renders its widget with (mirrored, see
 * backend/README.md "Mirrored constants"); the scope keeps the proof from
 * opening any other surface.
 */
export const NICKNAME_CHECK_TURNSTILE_ACTION = 'handle_check';
export const NICKNAME_CHECK_SCOPE = 'nickname_check';
export const NICKNAME_CHECK_PROOF_TTL_MS = TEN_MINUTES_IN_MS;

/**
 * Why a handle is refused, in the order they are checked:
 * - required: empty / whitespace.
 * - too_short: under {@link MIN_HANDLE_LENGTH}.
 * - too_long: over {@link MAX_HANDLE_LENGTH}.
 * - invalid: characters outside {@link HANDLE_PATTERN}.
 * - reserved: one of {@link RESERVED_HANDLE_KEYS}.
 * - taken: another account holds this handle or a lookalike of it.
 */
export const NICKNAME_REFUSALS = [
	'required',
	'too_short',
	'too_long',
	'invalid',
	'reserved',
	'taken'
] as const;

export type NicknameRefusal = (typeof NICKNAME_REFUSALS)[number];

export type NicknameAvailability =
	{ available: true } | { available: false; reason: NicknameRefusal };

/**
 * The handle validator, shared by the profile write guard and both
 * availability probes, so the UI and the server always agree. `excludeUserId`
 * is the editing user, passed so their own current handle does not count as
 * a conflict.
 */
export const checkNicknameAvailability = async ({
	nickname,
	excludeUserId,
	q = query
}: {
	nickname: string | undefined | null;
	excludeUserId?: string;
	q?: TxQuery;
}): Promise<NicknameAvailability> => {
	if (isNullish(nickname) || nickname.trim() === '') {
		return { available: false, reason: 'required' };
	}

	const trimmedNickname = nickname.trim();

	if (trimmedNickname.length < MIN_HANDLE_LENGTH) {
		return { available: false, reason: 'too_short' };
	}

	if (trimmedNickname.length > MAX_HANDLE_LENGTH) {
		return { available: false, reason: 'too_long' };
	}

	// Tested on the RAW value (the stored one), so surrounding whitespace is
	// refused too.
	if (!HANDLE_PATTERN.test(nickname)) {
		return { available: false, reason: 'invalid' };
	}

	if (RESERVED_HANDLE_KEYS.has(nickname)) {
		return { available: false, reason: 'reserved' };
	}

	// Within the rule the handle is its own key.
	const rows = await q<{ exists: boolean }>(
		`select exists (
		   select 1 from profiles
		   where handle_key = $1 and ($2::uuid is null or user_id <> $2::uuid)
		 ) as exists`,
		[nickname, excludeUserId ?? null]
	);

	if (rows[0]?.exists === true) {
		return { available: false, reason: 'taken' };
	}

	return { available: true };
};
