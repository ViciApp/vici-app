<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { ArrowLeft, Check, Search, X } from '@lucide/svelte/icons';
	import { untrack } from 'svelte';
	import SchoolAddConfirmStep from '#lib/components/leagues/SchoolAddConfirmStep.svelte';
	import SchoolAddFormStep from '#lib/components/leagues/SchoolAddFormStep.svelte';
	import SchoolCodeStep from '#lib/components/leagues/SchoolCodeStep.svelte';
	import SchoolVerifyStep from '#lib/components/leagues/SchoolVerifyStep.svelte';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import CountryFlag from '#lib/components/ui/CountryFlag.svelte';
	import {
		SCHOOL_FOUNDER_BADGE_CAP,
		SCHOOL_PASS2_ENABLED
	} from '#lib/constants/school-picker.constants.ts';
	import {
		WORLDS_COUNTRIES,
		WORLDS_UNIVERSITIES,
		type WorldsAffiliationOption
	} from '#lib/constants/worlds-affiliations.constants.ts';
	import { submitSchool, verifySchoolCode } from '#lib/services/school-verification.services.ts';
	import { joinAffiliation, switchAffiliation } from '#lib/services/worlds.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { AffiliationDoc, AffiliationKind } from '#lib/types/affiliation.ts';
	import { affiliationDisplayName } from '#lib/utils/affiliation-name.utils.ts';
	import { affiliationDaysLeft } from '#lib/utils/affiliation-stats.utils.ts';
	import { sleep } from '#lib/utils/async.utils.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { detectUserCountryCode } from '#lib/utils/locale-country.utils.ts';
	import {
		spFindCloseMatches,
		spFuzzy,
		spInferCountry,
		spIsValidCode,
		spIsValidEmail,
		spMatchEmail,
		spSanitizeCode
	} from '#lib/utils/school-picker.utils.ts';

	/**
	 * Affiliation picker: full-bleed bottom sheet with a large
	 * display-font title, a searchable roster, and a bottom-anchored
	 * CTA pill. The caller chooses the `kind` (one sheet per
	 * affiliation slot): there's no in-sheet toggle.
	 *
	 * The **country** kind is a plain browse-and-commit list. The
	 * **university** kind layers in directory features:
	 *
	 *  - fuzzy search across name + acronym (typo-tolerant);
	 *  - status badges: verified (gold tick) on schools that already
	 *    carry members, pending (amber) on the user's own awaiting
	 *    school, unverified (blue founder) on memberless rows;
	 *  - email-domain verification + add-your-own ("Pass 2"), gated by
	 *    {@link SCHOOL_PASS2_ENABLED}. When on, the submit / verify
	 *    round-trips call the satellite `submitSchool` / `verifySchoolCode`
	 *    endpoints (which mail the 6-digit code via the `vici-courier`
	 *    relay). The always-reachable "use it unverified" path stays
	 *    regardless of the flag.
	 *
	 * Selection is a two-step gesture: tap a row to mark it, then tap
	 * the CTA to commit. When the user already holds an affiliation of
	 * this kind, the picker commits via {@link switchAffiliation}
	 * (delete + re-join); otherwise it goes through
	 * {@link joinAffiliation} directly. The 90-day lock is enforced on
	 * the delete leg: when it's still active the CTA shows a
	 * "Locked for N days" disabled state instead of firing a doomed
	 * round-trip.
	 */
	interface Props {
		isOpen: boolean;
		kind: AffiliationKind;
		/** Caller's currently-joined affiliations (best-effort). The
		 *  picker reads the row of `kind` to drive switch vs join, the
		 *  "Joined" row badge, and the 90-day lock state. */
		current?: { university?: AffiliationDoc; country?: AffiliationDoc };
		/** Per-school live membership signal, keyed by option id. Drives
		 *  the member meta line. A row with no entry renders the founder /
		 *  "no members yet" state; a row with members but `monthRank`
		 *  unset (not ranked yet) renders the count without a rank. */
		schoolStats?: Readonly<Record<string, { members: number; monthRank?: number }>>;
		/** When set (a university id) and Pass-2 is on, the sheet opens
		 *  straight into the email-verification step for that school; the
		 *  "Verify your school" entry from the profile's Alma Mater slot. */
		initialVerifyId?: string;
		onClose: () => void;
		onPicked?: () => void;
	}

	const {
		isOpen,
		kind,
		current,
		schoolStats = {},
		initialVerifyId,
		onClose,
		onPicked
	}: Props = $props();

	const roster = $derived<readonly WorldsAffiliationOption[]>(
		kind === 'university' ? WORLDS_UNIVERSITIES : WORLDS_COUNTRIES
	);

	const isUniversity = $derived(kind === 'university');
	const pass2 = $derived(isUniversity && SCHOOL_PASS2_ENABLED);

	// Locale-aware row label: country names localize via
	// `Intl.DisplayNames`, university names render as-is.
	const optionName = (option: WorldsAffiliationOption): string =>
		affiliationDisplayName({ option, kind, locale: $localeStore });

	// How long the "you're verified" confirmation stays on screen before
	// the sheet auto-dismisses: long enough to register, short enough not
	// to feel stuck.
	const VERIFIED_HOLD_MS = 1400;

	// When launched via the profile's "Verify your school" CTA, resolve the
	// school to verify so the sheet can open directly on its email step
	// (only for a verifiable directory university: Pass-2 on + has domains).
	// `untrack`: this is a deliberate mount-time snapshot (the sheet is
	// remounted per open), not reactive; it seeds the initial `mode` /
	// `verifyTarget` below.
	const initialVerifyTarget: WorldsAffiliationOption | null = untrack(() =>
		nonNullish(initialVerifyId) && kind === 'university' && SCHOOL_PASS2_ENABLED
			? (WORLDS_UNIVERSITIES.find(
					(o) => o.id === initialVerifyId && (o.domains?.length ?? 0) > 0
				) ?? null)
			: null
	);

	const subKey: MessageKey = 'worlds.picker.lock_hint';
	const searchPlaceholderKey = $derived<MessageKey>(
		isUniversity ? 'worlds.picker.search_university' : 'worlds.picker.search_country'
	);

	/**
	 * Sheet sub-modes. `browse` is the only mode the country kind ever
	 * reaches; the rest are the university Pass-2 add/verify flow,
	 * reachable only when {@link SCHOOL_PASS2_ENABLED} is on.
	 */
	type Mode =
		'browse' | 'verify-existing' | 'add-confirm' | 'add-form' | 'add-verifying' | 'verified';
	let mode = $state<Mode>(nonNullish(initialVerifyTarget) ? 'verify-existing' : 'browse');

	let query = $state('');
	let selected = $state<string | null>(null);
	let region = $state<RegionTab>('ALL');
	let saving = $state(false);
	let errorMessage = $state<string | null>(null);

	// Add / verify flow state.
	let addName = $state('');
	let addEmail = $state('');
	let verifyEmail = $state('');
	let code = $state('');
	let submissionId = $state<string | null>(null);
	let verifyTarget = $state<WorldsAffiliationOption | null>(initialVerifyTarget);
	let verifyError = $state<string | null>(null);
	let submitting = $state(false);
	// School name shown on the post-verify success beat (resolved at the
	// moment of success: the directory target's name, else the typed one).
	let verifiedName = $state('');

	/**
	 * Region tabs (university kind only). `LATAM` / `MEA` entries have no
	 * tab: they surface only under "All" or via search. The tab `id`
	 * matches `WorldsAffiliationOption.region`; the AU tab covers both
	 * Australia and New Zealand (`region: 'AU'`).
	 */
	type RegionTab = 'ALL' | 'NA' | 'UK' | 'EU' | 'AS' | 'AU';
	const REGION_TABS: readonly { id: RegionTab; key: MessageKey }[] = [
		{ id: 'ALL', key: 'worlds.picker.region.all' },
		{ id: 'NA', key: 'worlds.picker.region.na' },
		{ id: 'UK', key: 'worlds.picker.region.uk' },
		{ id: 'EU', key: 'worlds.picker.region.eu' },
		{ id: 'AS', key: 'worlds.picker.region.as' },
		{ id: 'AU', key: 'worlds.picker.region.au' }
	];

	// Best-effort home country from `navigator.language`: drives the
	// "Near you" pinning. Read once at setup: the heuristic has no
	// reactive inputs, so there's nothing to re-derive.
	const homeCountry = detectUserCountryCode();

	const currentDoc = $derived<AffiliationDoc | undefined>(current?.[kind]);
	const currentForKind = $derived<string | undefined>(currentDoc?.affiliationIdentifier);
	const lockDaysLeft = $derived(
		currentDoc ? affiliationDaysLeft({ lockedUntilMs: currentDoc.lockedUntilMs }) : 0
	);
	const isLocked = $derived(lockDaysLeft > 0);
	const isSwitching = $derived(
		nonNullish(currentForKind) && nonNullish(selected) && selected !== currentForKind
	);

	const isSearching = $derived(query.trim().length > 0);

	/**
	 * CTA copy follows the action being committed: "Switch to {name}"
	 * when a different row is selected over an existing affiliation,
	 * "Locked for N days" when the 90-day lock blocks the switch,
	 * "Pick a school/country" otherwise. Returns the resolved string,
	 * not a key, so all branches can pass through one i18n call.
	 */
	const ctaLabel = $derived.by<string>(() => {
		if (isSwitching && isLocked) {
			return t({
				locale: $localeStore,
				key: 'worlds.picker.cta_locked',
				params: { count: lockDaysLeft }
			});
		}

		if (isSwitching && nonNullish(selected)) {
			const option = roster.find((o) => o.id === selected);

			return t({
				locale: $localeStore,
				key: 'worlds.picker.cta_switch',
				params: { name: nonNullish(option) ? optionName(option) : '' }
			});
		}

		return t({
			locale: $localeStore,
			key: isUniversity ? 'worlds.picker.cta_university' : 'worlds.picker.cta_country'
		});
	});

	const ctaDisabled = $derived(isNullish(selected) || saving || (isSwitching && isLocked));

	const selectedOption = $derived<WorldsAffiliationOption | undefined>(
		isNullish(selected) ? undefined : roster.find((o) => o.id === selected)
	);
	// The selected school can be verified when Pass 2 is on and the
	// directory entry carries an email domain to match against.
	const selectedCanVerify = $derived(pass2 && (selectedOption?.domains?.length ?? 0) > 0);

	const filtered = $derived.by(() => {
		const trimmed = query.trim();

		if (trimmed.length > 0) {
			if (isUniversity) {
				// Fuzzy across name + acronym, ranked by score.
				return roster
					.map((option) => ({
						option,
						score: Math.max(
							spFuzzy({ query: trimmed, target: option.name }),
							spFuzzy({ query: trimmed, target: option.short ?? '' })
						)
					}))
					.filter((scored) => scored.score > 0)
					.sort((a, b) => b.score - a.score)
					.slice(0, 50)
					.map((scored) => scored.option);
			}

			const lowered = trimmed.toLowerCase();

			// Countries match on the localized name first, with the English
			// roster name kept as a query alias.
			return roster
				.filter(
					(opt) =>
						optionName(opt).toLowerCase().includes(lowered) ||
						opt.name.toLowerCase().includes(lowered) ||
						opt.glyph.toLowerCase().includes(lowered)
				)
				.slice(0, 40);
		}

		// Idle, country kind: unchanged, first 20 of the roster.
		if (!isUniversity) {
			return roster.slice(0, 20);
		}

		// Idle, university kind: apply the region tab, then pin "Near you"
		// (home-country schools) to the top. Both groups sort by QS rank;
		// entries without a rank fall to the bottom of their group.
		const scoped = region === 'ALL' ? roster : roster.filter((opt) => opt.region === region);
		// eslint-disable-next-line local-rules/prefer-object-params -- Compare functions are more readable with primitive params
		const byRank = (a: WorldsAffiliationOption, b: WorldsAffiliationOption) =>
			(a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
		const pinned = scoped.filter((opt) => opt.country === homeCountry).sort(byRank);
		const rest = scoped.filter((opt) => opt.country !== homeCountry).sort(byRank);

		return [...pinned, ...rest].slice(0, 80);
	});

	// Count of home-country schools in the active scope: drives the
	// "Near you · N schools" divider. Zero when there's no home country,
	// while searching, or for the country kind.
	const nearYouCount = $derived(
		!isUniversity || isSearching || isNullish(homeCountry)
			? 0
			: filtered.filter((opt) => opt.country === homeCountry).length
	);

	// Fuzzy dedupe for the add-your-own confirm step.
	const dupeMatches = $derived(
		isUniversity ? spFindCloseMatches({ query: addName.trim(), directory: roster, limit: 3 }) : []
	);

	// Ids that render the "founder" badge; the first
	// {@link SCHOOL_FOUNDER_BADGE_CAP} memberless, unjoined rows in the
	// current list (Pass 2 only), so an unseeded region doesn't paint
	// every row with the badge. Empty when Pass 2 is off.
	const founderIds = $derived.by<readonly string[]>(() => {
		if (!pass2) {
			return [];
		}

		const ids: string[] = [];

		for (const option of filtered) {
			if (ids.length >= SCHOOL_FOUNDER_BADGE_CAP) {
				break;
			}

			if (isNullish(schoolStats[option.id]) && currentForKind !== option.id) {
				ids.push(option.id);
			}
		}

		return ids;
	});

	const handleSelect = (option: WorldsAffiliationOption) => {
		errorMessage = null;

		// Tap on the already-joined row: don't queue it as a selection
		// (there's nothing to commit). Surface the friendly hint and
		// clear any prior selection so the CTA returns to its idle
		// state.
		if (nonNullish(currentForKind) && currentForKind === option.id) {
			selected = null;
			errorMessage = t({
				locale: $localeStore,
				key: 'worlds.picker.error_already_affiliated'
			});

			return;
		}

		selected = selected === option.id ? null : option.id;
	};

	const handleCommit = async () => {
		if (isNullish(selected) || saving) {
			return;
		}

		saving = true;
		errorMessage = null;

		try {
			if (isSwitching && nonNullish(currentDoc)) {
				await switchAffiliation({
					kind,
					currentAffiliationIdentifier: currentDoc.affiliationIdentifier,
					currentLockedUntilMs: currentDoc.lockedUntilMs,
					nextAffiliationIdentifier: selected
				});
			} else {
				await joinAffiliation({ kind, affiliationIdentifier: selected });
			}

			haptic('firm-tap');
			onPicked?.();
			onClose();
		} catch (err) {
			// Four branches that need distinct UI:
			//  - Lock active: switch attempted while still inside the
			//    90-day window. `switchAffiliation` throws synchronously
			//    so this also covers a clock-skew race.
			//  - "Already affiliated": `current` was stale and the
			//    server rejected on the join leg.
			//  - Timeout: `joinAffiliation` / `leaveAffiliation` wrap
			//    each round-trip in a 15s race; the pick may or may not
			//    have committed.
			//  - Anything else: generic fallback, error logged.
			const message = err instanceof Error ? err.message : '';
			const isLockActive = message.includes('lock active');
			const isAlreadyAffiliated = message.includes('Already affiliated');
			const isTimeout = message.includes('timed out');
			console.error('AffiliationPickerModal: commit failed', err);
			errorMessage = t({
				locale: $localeStore,
				key: isLockActive
					? 'worlds.picker.error_locked'
					: isAlreadyAffiliated
						? 'worlds.picker.error_already_affiliated'
						: isTimeout
							? 'worlds.picker.error_timeout'
							: 'common.error.generic'
			});
		} finally {
			saving = false;
		}
	};

	// ── Pass-2 transitions ────────────────────────────────────────
	const resetAddState = () => {
		addName = '';
		addEmail = '';
		verifyEmail = '';
		code = '';
		submissionId = null;
		verifyTarget = null;
		verifyError = null;
		submitting = false;
		verifiedName = '';
	};

	const openAddConfirm = () => {
		addName = query.trim();
		addEmail = '';
		verifyError = null;
		mode = 'add-confirm';
	};

	const openVerifyExisting = (option: WorldsAffiliationOption) => {
		verifyTarget = option;
		verifyEmail = '';
		code = '';
		submissionId = null;
		verifyError = null;
		submitting = false;
		mode = 'verify-existing';
	};

	// Inferred country for the add flow (from the typed school email).
	const inferredCountry = $derived(spInferCountry({ email: addEmail, fallback: homeCountry }));

	// add-form email validation.
	const addEmailMatch = $derived(
		spIsValidEmail(addEmail) ? spMatchEmail({ email: addEmail, directory: roster }) : null
	);
	const addConsumerBlock = $derived(addEmailMatch?.kind === 'consumer');
	const addDomainMatch = $derived(addEmailMatch?.kind === 'match' ? addEmailMatch.option : null);
	const addCanSubmit = $derived(
		spIsValidEmail(addEmail) && !addConsumerBlock && isNullish(addDomainMatch) && !submitting
	);

	// verify-existing email validation against the school's own domains.
	const verifyDomainOk = $derived.by(() => {
		const target = verifyTarget;

		if (isNullish(target) || !spIsValidEmail(verifyEmail)) {
			return false;
		}

		const host = verifyEmail.toLowerCase().trim().split('@')[1] ?? '';

		return (target.domains ?? []).some((d) => host === d || host.endsWith(`.${d}`));
	});
	const verifyWrongDomain = $derived(spIsValidEmail(verifyEmail) && !verifyDomainOk);

	const codeValid = $derived(spIsValidCode(code));

	/**
	 * Commit a Pass-2 verified pick. The verified status itself is
	 * persisted server-side by `verifySchoolCode` (it sets the profile's
	 * `schoolStatus` and bumps the school's verified-member count); here
	 * we just commit the affiliation the same way as an unverified pick
	 * (the directory row is the same school).
	 */
	const commitVerified = async (option: WorldsAffiliationOption) => {
		selected = option.id;
		await handleCommit();
	};

	/**
	 * Commit the affiliation row *after* a successful code verification.
	 * Unlike {@link handleCommit}, a failure here must never strand the
	 * user on the code screen: `verifySchoolCode` has already flipped the
	 * profile's `schoolStatus` server-side, so verification is terminal.
	 * We still join / switch the row when it differs, but a redundant
	 * commit (already affiliated with this exact school) or a blocked one
	 * (90-day lock) is swallowed; the verification stands regardless.
	 */
	const commitAfterVerify = async (affiliationIdentifier: string) => {
		// Already on this exact affiliation: verification was the whole
		// point; there's nothing to join or switch.
		if (currentForKind === affiliationIdentifier) {
			return;
		}

		try {
			if (nonNullish(currentDoc)) {
				await switchAffiliation({
					kind,
					currentAffiliationIdentifier: currentDoc.affiliationIdentifier,
					currentLockedUntilMs: currentDoc.lockedUntilMs,
					nextAffiliationIdentifier: affiliationIdentifier
				});
			} else {
				await joinAffiliation({ kind, affiliationIdentifier });
			}
		} catch (err) {
			// Non-fatal: the verification itself already succeeded.
			console.error('AffiliationPickerModal: post-verify commit failed', err);
		}
	};

	// Send a 6-digit code for the add-your-own flow.
	const requestAddCode = async () => {
		submitting = true;
		verifyError = null;

		try {
			const { submissionId: id } = await submitSchool({
				name: addName.trim(),
				country: inferredCountry,
				email: addEmail,
				locale: $localeStore
			});
			submissionId = id;
			code = '';
			mode = 'add-verifying';
		} catch (err) {
			verifyError =
				err instanceof Error
					? t({ locale: $localeStore, key: 'worlds.picker.school.error_send' })
					: t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			submitting = false;
		}
	};

	// Send a 6-digit code to verify membership of a directory school.
	const requestExistingCode = async () => {
		const target = verifyTarget;

		if (isNullish(target)) {
			return;
		}

		submitting = true;
		verifyError = null;

		try {
			const { submissionId: id } = await submitSchool({
				name: target.name,
				schoolId: target.id,
				country: target.country ?? homeCountry,
				email: verifyEmail,
				locale: $localeStore
			});
			submissionId = id;
			code = '';
			mode = 'add-verifying';
		} catch (err) {
			verifyError =
				err instanceof Error
					? t({ locale: $localeStore, key: 'worlds.picker.school.error_send' })
					: t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			submitting = false;
		}
	};

	// Verify the entered code, then commit the affiliation.
	const submitCode = async () => {
		if (isNullish(submissionId)) {
			return;
		}

		submitting = true;
		verifyError = null;

		try {
			const result = await verifySchoolCode({ submissionId, code });

			if (result.ok === false) {
				throw new Error(result.message ?? 'invalid-code');
			}

			// Resolve the school to commit: an existing directory row, or the
			// canonical id the verify endpoint minted for a brand-new school
			// (backend B.1) that has no directory entry yet.
			const affiliationIdentifier = verifyTarget?.id ?? result.schoolId;

			if (isNullish(affiliationIdentifier)) {
				// No target and no schoolId in the response: unexpected.
				verifyError = t({ locale: $localeStore, key: 'worlds.picker.school.error_verify' });

				return;
			}

			// Verification is terminal. Show a success beat, then auto-dismiss
			// after a fixed hold. The affiliation commit runs in the
			// background (it catches / logs its own errors): awaiting it
			// would let a slow write drag the success beat out and reintroduce
			// the "feels stuck" problem, and a redundant or blocked commit
			// must not block the close.
			haptic('celebration');
			verifiedName = verifyTarget?.name ?? addName.trim();
			mode = 'verified';

			void commitAfterVerify(affiliationIdentifier);
			await sleep(VERIFIED_HOLD_MS);

			onPicked?.();
			onClose();
		} catch {
			verifyError = t({ locale: $localeStore, key: 'worlds.picker.school.error_code' });
		} finally {
			submitting = false;
		}
	};

	const handleClose = () => {
		query = '';
		selected = null;
		region = 'ALL';
		errorMessage = null;
		mode = 'browse';
		resetAddState();
		onClose();
	};

	const backToBrowse = () => {
		if (submitting) {
			return;
		}

		mode = 'browse';
		resetAddState();
	};

	// Thin `t()` wrapper that binds the locale once per render: keeps
	// the dense markup readable. `key` stays positional (it's the one
	// required arg and reads naturally first); `params` trails it.
	// eslint-disable-next-line local-rules/prefer-object-params -- Locale-bound translate shorthand; key reads best positionally
	const tr = (key: MessageKey, params?: Record<string, string | number>) =>
		t({ locale: $localeStore, key, params });
</script>

{#snippet pickerFooter()}
	<div class="affil-picker-footer">
		{#if mode === 'browse'}
			{#if errorMessage}
				<p class="affil-picker-error" role="alert">{errorMessage}</p>
			{/if}

			{#if selectedCanVerify && selectedOption}
				<button
					class="affil-picker-cta"
					disabled={ctaDisabled}
					onclick={() => openVerifyExisting(selectedOption)}
					type="button"
				>
					{tr('worlds.picker.school.verify_with', { domain: selectedOption.domains?.[0] ?? '' })}
				</button>
				<button
					class="affil-picker-foot-link"
					disabled={ctaDisabled}
					onclick={handleCommit}
					type="button"
				>
					{tr('worlds.picker.school.skip_unverified')}
				</button>
			{:else}
				<button
					class="affil-picker-cta"
					disabled={ctaDisabled}
					onclick={handleCommit}
					type="button"
				>
					{#if saving}
						{tr('worlds.cta.joining')}
					{:else}
						{ctaLabel}
					{/if}
				</button>
			{/if}
		{:else if mode === 'verify-existing' && verifyTarget}
			<button
				class="affil-picker-cta"
				disabled={!verifyDomainOk || submitting}
				onclick={requestExistingCode}
				type="button"
			>
				{submitting ? tr('worlds.picker.school.sending') : tr('worlds.picker.school.send_code')}
			</button>
			<button
				class="affil-picker-foot-link"
				onclick={() => verifyTarget && commitVerified(verifyTarget)}
				type="button"
			>
				{tr('worlds.picker.school.skip_unverified')}
			</button>
		{:else if mode === 'add-confirm'}
			<button
				class="affil-picker-cta"
				disabled={addName.trim().length < 3}
				onclick={() => (mode = 'add-form')}
				type="button"
			>
				{addName.trim().length < 3
					? tr('worlds.picker.school.enter_name')
					: tr('worlds.picker.school.continue')}
			</button>
		{:else if mode === 'add-form'}
			<button
				class="affil-picker-cta"
				disabled={!addCanSubmit}
				onclick={requestAddCode}
				type="button"
			>
				{submitting ? tr('worlds.picker.school.sending') : tr('worlds.picker.school.send_code')}
			</button>
			<button class="affil-picker-foot-link" onclick={backToBrowse} type="button">
				{tr('worlds.picker.school.no_email_unverified')}
			</button>
		{:else if mode === 'add-verifying'}
			<button
				class="affil-picker-cta"
				disabled={!codeValid || submitting}
				onclick={submitCode}
				type="button"
			>
				{submitting ? tr('worlds.picker.school.verifying') : tr('worlds.picker.school.verify_cta')}
			</button>
			<button
				class="affil-picker-foot-link"
				disabled={submitting}
				onclick={() => (mode = verifyTarget ? 'verify-existing' : 'add-form')}
				type="button"
			>
				{tr('worlds.picker.school.wrong_address')}
			</button>
		{/if}
	</div>
{/snippet}

<BottomSheet footer={pickerFooter} {isOpen} onClose={handleClose}>
	<div class="affil-picker">
		<header class="affil-picker-head">
			{#if mode !== 'browse' && mode !== 'verified'}
				<button
					class="affil-picker-icon-btn"
					aria-label={tr('worlds.picker.back')}
					disabled={submitting}
					onclick={backToBrowse}
					type="button"
				>
					<ArrowLeft size={18} strokeWidth={1.8} />
				</button>
			{/if}
			<h2 class="affil-picker-title">
				{#if mode === 'browse'}
					{tr(isUniversity ? 'worlds.picker.title_university' : 'worlds.picker.title_country')}
				{:else if mode === 'verify-existing' && verifyTarget}
					{tr('worlds.picker.school.verify_title', {
						name: verifyTarget.short ?? verifyTarget.name
					})}
				{:else if mode === 'add-confirm'}
					{tr('worlds.picker.school.add_title')}
				{:else if mode === 'add-form'}
					{tr('worlds.picker.school.verify_school_title')}
				{:else if mode === 'verified'}
					{tr('worlds.picker.school.verified_title')}
				{:else}
					{tr('worlds.picker.school.inbox_title')}
				{/if}
			</h2>
			<button
				class="affil-picker-icon-btn"
				aria-label={tr('worlds.picker.close')}
				onclick={handleClose}
				type="button"
			>
				<X size={14} strokeWidth={1.8} />
			</button>
		</header>

		{#if mode === 'browse'}
			<p class="affil-picker-hint serif-italic">
				{tr(subKey)}
			</p>

			<div class="affil-picker-search">
				<Search aria-hidden="true" size={14} strokeWidth={1.6} />
				<input
					onkeydown={(event) => {
						if (event.key === 'Enter' && filtered.length > 0) {
							event.preventDefault();
							handleSelect(filtered[0]);
						}
					}}
					placeholder={tr(searchPlaceholderKey, { count: roster.length })}
					type="text"
					bind:value={query}
				/>
				{#if query}
					<button
						class="affil-picker-clear"
						aria-label={tr('worlds.picker.clear')}
						onclick={() => (query = '')}
						type="button"
					>
						<X size={12} strokeWidth={1.8} />
					</button>
				{/if}
			</div>

			{#if isUniversity && !isSearching}
				<div class="affil-picker-tabs" role="tablist">
					{#each REGION_TABS as tab (tab.id)}
						<button
							class="affil-picker-tab"
							class:is-active={region === tab.id}
							aria-selected={region === tab.id}
							onclick={() => (region = tab.id)}
							role="tab"
							type="button"
						>
							{tr(tab.key)}
						</button>
					{/each}
				</div>
			{/if}

			<ul class="affil-picker-list">
				{#if filtered.length === 0}
					{#if pass2 && isSearching}
						<li class="affil-picker-empty-add">
							<p class="affil-picker-empty-add-title serif-italic">
								{tr('worlds.picker.school.empty_add_title')}
							</p>
							<p class="affil-picker-empty-add-body">
								{tr('worlds.picker.school.empty_add_body')}
							</p>
							<button class="affil-picker-cta" onclick={openAddConfirm} type="button">
								{tr('worlds.picker.school.empty_add_cta', { name: query.trim() })}
							</button>
							<p class="affil-picker-empty-add-foot num allcaps">
								{tr('worlds.picker.school.verified_by_email')}
							</p>
						</li>
					{:else}
						<li class="affil-picker-empty">
							{tr('worlds.picker.empty')}
						</li>
					{/if}
				{:else}
					{#each filtered as option, index (option.id)}
						{@const isJoined = currentForKind === option.id}
						{@const isSelected = selected === option.id}
						{@const stats = schoolStats[option.id]}
						{@const isOwnPending = pass2 && isJoined && isNullish(stats)}
						{@const isNearYouLead =
							nearYouCount > 0 && index === 0 && option.country === homeCountry}
						{@const founderEligible = founderIds.includes(option.id)}
						{#if isNearYouLead}
							<li class="affil-picker-divider" aria-hidden="true">
								{tr('worlds.picker.near_you', { count: nearYouCount })}
							</li>
						{/if}
						<li>
							<button
								class="affil-picker-row"
								class:is-joined={isJoined}
								class:is-selected={isSelected}
								aria-current={isJoined ? 'true' : undefined}
								aria-pressed={isSelected}
								onclick={() => handleSelect(option)}
								type="button"
							>
								<span class="affil-picker-glyph" aria-hidden="true">
									{#if kind === 'country'}
										<CountryFlag class="affil-picker-flag" countryCode={option.id} />
									{:else}
										{option.glyph}
									{/if}
								</span>
								<span class="affil-picker-body">
									<span class="affil-picker-name">
										<span class="affil-picker-name-text">{optionName(option)}</span>
										{#if nonNullish(stats)}
											<span class="affil-picker-badge affil-picker-badge-verified">
												<Check aria-hidden="true" size={9} strokeWidth={3.5} />
												<span class="sr-only">{tr('worlds.picker.school.status_verified')}</span>
											</span>
										{:else if isOwnPending}
											<span class="affil-picker-badge-pill affil-picker-badge-pending num">
												{tr('worlds.picker.school.status_pending')}
											</span>
										{:else if founderEligible}
											<span class="affil-picker-badge-pill affil-picker-badge-founder num">
												{tr('worlds.picker.school.founder')}
											</span>
										{/if}
									</span>
									{#if isUniversity}
										<span class="affil-picker-meta num">
											{#if nonNullish(stats) && nonNullish(stats.monthRank)}
												{tr('worlds.picker.school.meta_members', {
													members: stats.members,
													rank: stats.monthRank
												})}
											{:else if nonNullish(stats)}
												{tr('worlds.picker.school.meta_members_no_rank', {
													members: stats.members
												})}
											{:else}
												{tr(
													pass2
														? 'worlds.picker.school.meta_be_founder'
														: 'worlds.picker.school.meta_no_members'
												)}
											{/if}
										</span>
									{/if}
								</span>
								{#if isJoined}
									<span class="num allcaps affil-picker-joined">
										{tr('worlds.picker.already_joined')}
									</span>
								{/if}
							</button>
						</li>
					{/each}

					{#if pass2}
						<li>
							<button class="affil-picker-add-cta" onclick={openAddConfirm} type="button">
								<span class="affil-picker-add-cta-icon" aria-hidden="true">+</span>
								<span class="affil-picker-add-cta-body">
									<span class="affil-picker-add-cta-title"
										>{tr('worlds.picker.school.add_cta_title')}</span
									>
									<span class="affil-picker-add-cta-sub num allcaps"
										>{tr('worlds.picker.school.verified_by_email')}</span
									>
								</span>
								<span class="affil-picker-add-cta-arrow" aria-hidden="true">→</span>
							</button>
						</li>
					{/if}
				{/if}
			</ul>
		{:else if mode === 'verify-existing' && verifyTarget}
			<SchoolVerifyStep
				canSend={verifyDomainOk && !submitting}
				email={verifyEmail}
				error={verifyError}
				onEmailInput={(value) => {
					verifyEmail = value;
					verifyError = null;
				}}
				onSubmit={() => void requestExistingCode()}
				{submitting}
				target={verifyTarget}
				wrongDomain={verifyWrongDomain}
			/>
		{:else if mode === 'add-confirm'}
			<SchoolAddConfirmStep
				name={addName}
				{dupeMatches}
				onNameInput={(value) => (addName = value)}
				onUseDupe={commitVerified}
			/>
		{:else if mode === 'add-form'}
			<SchoolAddFormStep
				name={addName}
				canSubmit={addCanSubmit}
				consumerBlock={addConsumerBlock}
				domainMatch={addDomainMatch}
				email={addEmail}
				error={verifyError}
				{inferredCountry}
				onEmailInput={(value) => {
					addEmail = value;
					verifyError = null;
				}}
				onSubmit={() => void requestAddCode()}
				onUseDomainMatch={commitVerified}
				{submitting}
			/>
		{:else if mode === 'add-verifying'}
			<SchoolCodeStep
				canSubmit={codeValid && !submitting}
				{code}
				email={verifyTarget ? verifyEmail : addEmail}
				error={verifyError}
				onCodeInput={(rawValue) => {
					code = spSanitizeCode(rawValue);
					verifyError = null;
				}}
				onSubmit={() => void submitCode()}
				{submitting}
			/>
		{:else if mode === 'verified'}
			<div class="affil-picker-verified">
				<span class="affil-picker-verified-icon" aria-hidden="true">
					<Check size={28} strokeWidth={2.4} />
				</span>
				<h3 class="affil-picker-verified-msg serif-italic">
					{tr('worlds.picker.school.verified_body', { name: verifiedName })}
				</h3>
			</div>
		{/if}
	</div>
</BottomSheet>

<style lang="postcss">
	.affil-picker {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 0.25rem 0 0.5rem;
	}

	/* Post-verify success beat: a centered laurel tick that pops in,
	   shown briefly before the sheet auto-dismisses. */
	.affil-picker-verified {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		padding: 1.6rem 0 1rem;
		text-align: center;
	}

	.affil-picker-verified-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		color: var(--laurel);
		background: color-mix(in srgb, var(--laurel) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--laurel) 32%, transparent);
		border-radius: var(--r-pill);
		animation: affil-verified-pop 0.34s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}

	.affil-picker-verified-msg {
		margin: 0;
		max-width: 30ch;
		font-size: var(--t-20, 1.25rem);
		line-height: 1.3;
		color: var(--text-base);
		overflow-wrap: anywhere;
	}

	@keyframes affil-verified-pop {
		from {
			transform: scale(0.6);
			opacity: 0;
		}

		to {
			transform: scale(1);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.affil-picker-verified-icon {
			animation: none;
		}
	}

	.affil-picker-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.affil-picker-title {
		flex: 1;
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--t-32, 2rem);
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: var(--tracking-tight);
		color: var(--text-base);
	}

	.affil-picker-icon-btn {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		background: color-mix(in srgb, var(--bg-surface) 70%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		color: var(--text-muted);
		cursor: pointer;
	}

	.affil-picker-icon-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.affil-picker-hint {
		margin: 0;
		font-size: var(--t-13);
		line-height: 1.45;
		color: var(--text-muted);
	}

	.affil-picker-search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		background: color-mix(in srgb, var(--bg-surface) 70%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		color: var(--text-muted);
	}

	.affil-picker-search input {
		flex: 1;
		appearance: none;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-base);
		font: inherit;
	}

	.affil-picker-clear {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
	}

	.affil-picker-tabs {
		display: flex;
		gap: 0.35rem;
		overflow-x: auto;
		padding-bottom: 0.15rem;
		scrollbar-width: none;
	}

	.affil-picker-tabs::-webkit-scrollbar {
		display: none;
	}

	.affil-picker-tab {
		appearance: none;
		flex-shrink: 0;
		padding: 0.4rem 0.7rem;
		font: inherit;
		font-size: var(--t-12);
		font-weight: 600;
		white-space: nowrap;
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 70%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			background 140ms ease,
			color 140ms ease,
			border-color 140ms ease;
	}

	.affil-picker-tab:hover {
		color: var(--text-base);
	}

	.affil-picker-tab.is-active {
		color: var(--ink, #0e0d0b);
		background: var(--laurel);
		border-color: var(--laurel);
	}

	.affil-picker-list {
		/* No own scroll cap: the list flows inside the sheet's single
		 * scrolling body (`.sheet-body`), while the commit CTA rides in the
		 * sheet's non-scrolling `footer` snippet, so a long roster scrolls
		 * the body and the CTA stays docked in view. */
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.affil-picker-divider {
		padding: 0.6rem 0.5rem 0.35rem;
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 600;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		color: var(--laurel);
	}

	.affil-picker-row {
		appearance: none;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.7rem 0.5rem;
		font: inherit;
		text-align: left;
		color: var(--text-base);
		background: none;
		border: none;
		border-bottom: 1px solid color-mix(in srgb, var(--border-base) 60%, transparent);
		cursor: pointer;
		transition: background 140ms ease;
	}

	.affil-picker-row:hover {
		background: color-mix(in srgb, var(--laurel) 8%, var(--bg-surface));
	}

	.affil-picker-row.is-selected {
		background: color-mix(in srgb, var(--laurel) 14%, var(--bg-surface));
	}

	.affil-picker-row.is-joined {
		background: color-mix(in srgb, var(--laurel) 10%, var(--bg-surface));
	}

	.affil-picker-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border-radius: var(--r-8);
		background: var(--bg-surface);
		font-family: var(--font-mono);
		font-size: 0.85rem;
		font-weight: 700;
		overflow: hidden;
	}

	.affil-picker :global(.affil-picker-flag) {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.affil-picker-body {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.15rem;
	}

	.affil-picker-name {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--t-14);
		font-weight: 600;
	}

	.affil-picker-name-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.affil-picker-meta {
		font-size: var(--t-10);
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	/* ── Status badges ── */
	.affil-picker-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		border-radius: var(--r-pill);
	}

	.affil-picker-badge-verified {
		background: var(--laurel);
		color: var(--ink, #0e0d0b);
	}

	.affil-picker-badge-pill {
		padding: 0.1rem 0.4rem;
		font-size: var(--t-10);
		font-weight: 600;
		letter-spacing: 0.08em;
		border-radius: var(--r-pill);
		white-space: nowrap;
	}

	.affil-picker-badge-pending {
		/* Amber "awaiting verification": distinct from the gold accent
		   (verified) and the blue founder badge. */
		color: #d8a23a;
		background: color-mix(in srgb, #d8a23a 12%, transparent);
		border: 1px solid color-mix(in srgb, #d8a23a 35%, transparent);
	}

	.affil-picker-badge-founder {
		color: #6b9fff;
		background: color-mix(in srgb, #6b9fff 10%, transparent);
		border: 1px solid color-mix(in srgb, #6b9fff 30%, transparent);
	}

	.affil-picker-joined {
		font-size: var(--t-10);
		color: var(--laurel);
	}

	.affil-picker-empty {
		padding: 1.4rem 1rem;
		font-size: var(--t-13);
		text-align: center;
		color: var(--text-muted);
	}

	/* ── Empty-state add hero (Pass 2) ── */
	.affil-picker-empty-add {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1.4rem 1rem;
		text-align: center;
		background: color-mix(in srgb, var(--laurel) 4%, transparent);
		border: 1px dashed color-mix(in srgb, var(--laurel) 40%, transparent);
		border-radius: var(--r-12);
	}

	.affil-picker-empty-add-title {
		margin: 0;
		font-size: var(--t-20, 1.25rem);
		color: var(--laurel);
	}

	.affil-picker-empty-add-body {
		margin: 0;
		font-size: var(--t-13);
		color: var(--text-muted);
	}

	.affil-picker-empty-add-foot {
		margin: 0;
		font-size: var(--t-10);
		letter-spacing: 0.1em;
		color: var(--text-muted);
	}

	/* ── Add-your-own footer CTA (Pass 2) ── */
	.affil-picker-add-cta {
		appearance: none;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		margin-top: 0.6rem;
		padding: 0.85rem 1rem;
		font: inherit;
		text-align: left;
		color: var(--text-muted);
		background: transparent;
		border: 1px dashed var(--border-base);
		border-radius: var(--r-12);
		cursor: pointer;
	}

	.affil-picker-add-cta-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		flex-shrink: 0;
		font-size: 1.1rem;
		color: var(--laurel);
		border: 1px dashed var(--border-base);
		border-radius: var(--r-8);
	}

	.affil-picker-add-cta-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.15rem;
	}

	.affil-picker-add-cta-title {
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-base);
	}

	.affil-picker-add-cta-sub {
		font-size: var(--t-10);
		letter-spacing: 0.04em;
	}

	.affil-picker-add-cta-arrow {
		color: var(--laurel);
	}

	/* ── Docked footer ── */
	/* Holds the commit CTA (plus the browse-mode error + the optional
	 * skip/back foot-link) in the sheet's non-scrolling footer slot. Stacks
	 * its rows with the same rhythm the content column used before the CTA
	 * moved out. */
	.affil-picker-footer {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* ── CTAs ── */
	.affil-picker-error {
		margin: 0;
		padding: 0.6rem 0.85rem;
		font-size: var(--t-12);
		color: var(--no);
		background: color-mix(in srgb, var(--no-wash, var(--no)) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--no) 35%, var(--border-base));
		border-radius: var(--r-12);
	}

	.affil-picker-cta {
		appearance: none;
		width: 100%;
		padding: 0.95rem 1rem;
		font: inherit;
		font-size: var(--t-14);
		font-weight: 700;
		color: var(--ink, #0e0d0b);
		background: var(--color-primary);
		border: 0;
		border-radius: var(--r-pill);
		cursor: pointer;
		transition: opacity 140ms ease;
	}

	.affil-picker-cta:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.affil-picker-foot-link {
		appearance: none;
		width: 100%;
		padding: 0.25rem 0 0;
		font: inherit;
		font-size: var(--t-12);
		color: var(--text-muted);
		background: none;
		border: none;
		text-align: center;
		cursor: pointer;
	}

	.affil-picker-foot-link:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
