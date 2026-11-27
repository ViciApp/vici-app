// The handle rule: what a handle picked or changed on vici.app may be, and
// when two handles count as the same one. A pure module (no imports), so the
// API's shared-drift suite loads it as-is and holds the API's copy of the rule
// (backend/src/profiles/nickname.ts) to this one.

/** A handle is {@link MIN_HANDLE_LENGTH} to {@link MAX_HANDLE_LENGTH} characters. */
export const MIN_HANDLE_LENGTH = 3;
export const MAX_HANDLE_LENGTH = 15;

/**
 * Lowercase `a-z` and `0-9` only. No accents, no other scripts, no `.` / `_` /
 * `-`, so two handles can never differ by a lookalike alone.
 */
export const HANDLE_PATTERN = new RegExp(`^[a-z0-9]{${MIN_HANDLE_LENGTH},${MAX_HANDLE_LENGTH}}$`);

/**
 * Latin letters that read as a plain spelling but carry no accent to strip
 * (NFKD leaves them whole). Folded as written here, after lowercasing, so
 * `Strøm` reads `strom` and `Straße` reads `strasse`.
 */
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
 * Same letters and digits once case, accents and everything else are
 * dropped: NFKD (an accented letter splits into its base letter and the
 * accent), lowercased, {@link HANDLE_LETTER_FOLDS} applied, every character
 * outside `a-z0-9` removed (the accents with it). `antonio.ventilii`, `Antonio_Ventilii` and `antonioventílii` all
 * read `antonioventilii`. For a handle that satisfies {@link HANDLE_PATTERN}
 * the key is the handle itself; a handle written entirely in another script
 * has an empty key, which never collides.
 */
export const handleUniqueKey = (raw: string): string =>
	HANDLE_LETTER_FOLDS.reduce(
		(folded, [letter, plain]) => folded.replaceAll(letter, plain),
		raw.normalize('NFKD').toLowerCase()
	).replace(OUTSIDE_HANDLE_CHARS, '');

/**
 * Handles only VICI may use, so nobody can pass for the company, its
 * products or its staff. Entries are handle keys and are matched on
 * {@link handleUniqueKey}, so `VÍCI` and `vi.ci` count as `vici`. Exact match,
 * no prefix rule, because "vici..." also starts ordinary words. Names already
 * held by real accounts are left out: reserving them would lock their owners.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
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

/** Whether `raw` is one of {@link RESERVED_HANDLES} once folded. */
export const isReservedHandle = (raw: string): boolean =>
	RESERVED_HANDLES.has(handleUniqueKey(raw));
