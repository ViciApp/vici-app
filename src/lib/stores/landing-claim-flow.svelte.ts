import {
	LANDING_CLAIM_CHECK_DEBOUNCE_MS,
	LANDING_CLAIM_CODE_LENGTH
} from '#lib/constants/landing-claim.constants.ts';
import type { WaitlistSource } from '#lib/constants/waitlist.constants.ts';
import type { PublicHandleAvailability } from '#lib/services/handle-availability.services.ts';
import type {
	LandingClaimCheck,
	LandingClaimNotice,
	LandingClaimStep,
	LandingClaimSubmit
} from '#lib/types/landing-claim.ts';
import { sanitizeHandleInput } from '#lib/utils/handle.utils.ts';
import {
	cleanClaimCode,
	isLikelyEmail,
	landingClaimRefusalOf,
	localClaimCheck
} from '#lib/utils/landing-claim.utils.ts';
import { nonNullish } from '@dfinity/utils';

/** What one press of the capsule's button led to. */
export type LandingClaimAdvance =
	| { kind: 'advanced' }
	| { kind: 'refused' }
	| { kind: 'claimed'; handle: string }
	// A call was already in flight, or the visitor edited, went back or closed before it answered.
	| { kind: 'ignored' };

/**
 * The claim capsule's steps (handle, email, code) and what each press does,
 * apart from the DOM: the handle is probed as it is typed (debounced, stale
 * answers dropped), the email and code go through the page's waitlist
 * calls, and a handle the waitlist finds taken sends the visitor back to it
 * with the email kept. A call's answer counts only while nothing has changed
 * since it was made: an edit, a step back or a close drops it.
 */
export class LandingClaimFlow {
	step = $state<LandingClaimStep>('handle');
	handle = $state('');
	email = $state('');
	code = $state('');
	check = $state<LandingClaimCheck>({ kind: 'idle' });
	notice = $state<LandingClaimNotice>({ kind: 'none' });
	// Once the visitor types, the opener's line has been read.
	typed = $state(false);

	get busy(): boolean {
		return this.notice.kind === 'busy';
	}

	readonly #submit: () => LandingClaimSubmit;
	readonly #checkAvailability: (params: { handle: string }) => Promise<PublicHandleAvailability>;
	readonly #source: () => WaitlistSource;
	#probeToken = 0;
	#probeTimer: ReturnType<typeof setTimeout> | undefined;
	// Bumped by anything that makes a pending call's answer stale.
	#opToken = 0;
	// The address the code went to: the code step confirms against it, whatever the field holds.
	#sentEmail = '';
	// The handle a code was sent for: the waitlist holds it for this browser until the code lapses,
	// so the probe would only report the visitor's own hold as taken.
	#pendingHold: { handle: string; untilMs: number } | undefined;

	constructor({
		submit,
		checkAvailability,
		source
	}: {
		submit: () => LandingClaimSubmit;
		checkAvailability: (params: { handle: string }) => Promise<PublicHandleAvailability>;
		source: () => WaitlistSource;
	}) {
		this.#submit = submit;
		this.#checkAvailability = checkAvailability;
		this.#source = source;
	}

	/** Sets the typed handle, lowercased, stripped and capped by the handle rule, and probes it. */
	inputHandle(raw: string): string {
		this.#opToken += 1;
		this.handle = sanitizeHandleInput(raw);
		this.typed = true;
		this.notice = { kind: 'none' };
		this.#scheduleProbe();

		return this.handle;
	}

	inputEmail(value: string): void {
		this.#opToken += 1;
		this.email = value;
		this.notice = { kind: 'none' };
	}

	/** Sets the typed code, digits only. */
	inputCode(raw: string): string {
		this.#opToken += 1;
		this.code = cleanClaimCode(raw);
		this.notice = { kind: 'none' };

		return this.code;
	}

	/** Every opening starts at the handle; what was typed stays. */
	reopen(): void {
		this.cancel();
		this.step = 'handle';
		this.notice = { kind: 'none' };
		this.typed = this.handle !== '';
	}

	/** From the code back to the email, to fix it or ask for a new code. */
	back(): void {
		this.#opToken += 1;
		this.notice = { kind: 'none' };
		this.step = 'email';
	}

	/** What the step's button does. Ignored while a call is in flight. */
	async next(): Promise<LandingClaimAdvance> {
		if (this.busy) {
			return { kind: 'ignored' };
		}

		if (this.step === 'handle') {
			return await this.#nextFromHandle();
		}

		if (this.step === 'email') {
			return await this.#nextFromEmail();
		}

		return await this.#nextFromCode();
	}

	/** Drops the pending call's answer, as the capsule closes. */
	cancel(): void {
		this.#opToken += 1;

		if (this.busy) {
			this.notice = { kind: 'none' };
		}
	}

	dispose(): void {
		this.#stopProbe();
		this.cancel();
	}

	#stopProbe(): void {
		clearTimeout(this.#probeTimer);
		this.#probeToken += 1;
	}

	#scheduleProbe(): void {
		this.#stopProbe();
		this.check = localClaimCheck(this.handle);

		if (this.check.kind !== 'checking') {
			return;
		}

		if (this.#holdsPending(this.handle)) {
			this.check = { kind: 'free' };

			return;
		}

		const token = this.#probeToken;

		this.#probeTimer = setTimeout(() => void this.#probe(token), LANDING_CLAIM_CHECK_DEBOUNCE_MS);
	}

	#holdsPending(handle: string): boolean {
		return (
			nonNullish(this.#pendingHold) &&
			this.#pendingHold.handle === handle &&
			Date.now() < this.#pendingHold.untilMs
		);
	}

	async #probe(token: number): Promise<LandingClaimCheck> {
		let next: LandingClaimCheck;

		try {
			const res = await this.#checkAvailability({ handle: this.handle });

			if (res.available) {
				next = { kind: 'free' };
			} else {
				next = res.reason === 'taken' ? { kind: 'taken' } : { kind: 'format', issue: res.reason };
			}
		} catch (err: unknown) {
			console.warn('Landing claim: availability check failed', err);
			next = { kind: 'failed' };
		}

		if (token === this.#probeToken) {
			this.check = next;
		}

		return next;
	}

	async #nextFromHandle(): Promise<LandingClaimAdvance> {
		let current = this.check;

		// Pressed before the probe answered, or after it failed: ask now.
		if (current.kind === 'checking' || current.kind === 'failed') {
			this.#stopProbe();

			const probeToken = this.#probeToken;
			const opToken = this.#opToken;

			this.notice = { kind: 'busy' };
			current = await this.#probe(probeToken);

			// The answer is for a handle the field no longer holds, or a capsule since closed.
			if (probeToken !== this.#probeToken || opToken !== this.#opToken) {
				return { kind: 'ignored' };
			}

			this.notice = { kind: 'none' };
		}

		if (current.kind !== 'free') {
			return { kind: 'refused' };
		}

		this.step = 'email';

		return { kind: 'advanced' };
	}

	async #nextFromEmail(): Promise<LandingClaimAdvance> {
		if (!isLikelyEmail(this.email)) {
			this.notice = { kind: 'refused', refusal: 'email_invalid' };

			return { kind: 'refused' };
		}

		const email = this.email.trim();
		const opToken = this.#opToken;

		this.notice = { kind: 'busy' };

		try {
			const { handle } = this;
			const res = await this.#submit().requestCode({ handle, email, source: this.#source() });

			if (opToken !== this.#opToken) {
				return { kind: 'ignored' };
			}

			if ('ok' in res) {
				this.#pendingHold = { handle, untilMs: Date.now() + res.codeTtlMs };
				this.notice = { kind: 'none' };
				this.#sentEmail = email;
				this.code = '';
				this.step = 'code';

				return { kind: 'advanced' };
			}

			this.#refuse(res.error);
		} catch (err: unknown) {
			if (opToken !== this.#opToken) {
				return { kind: 'ignored' };
			}

			console.error('Landing claim: code request failed', err);
			this.notice = { kind: 'refused', refusal: 'failed' };
		}

		return { kind: 'refused' };
	}

	async #nextFromCode(): Promise<LandingClaimAdvance> {
		if (this.code.length !== LANDING_CLAIM_CODE_LENGTH) {
			return { kind: 'refused' };
		}

		const opToken = this.#opToken;

		this.notice = { kind: 'busy' };

		try {
			const res = await this.#submit().confirm({ email: this.#sentEmail, code: this.code });

			if (opToken !== this.#opToken) {
				return { kind: 'ignored' };
			}

			if ('handle' in res) {
				this.notice = { kind: 'none' };
				this.step = 'done';

				return { kind: 'claimed', handle: res.handle };
			}

			this.#refuse(res.error);
		} catch (err: unknown) {
			if (opToken !== this.#opToken) {
				return { kind: 'ignored' };
			}

			console.error('Landing claim: code confirmation failed', err);
			this.notice = { kind: 'refused', refusal: 'failed' };
		}

		return { kind: 'refused' };
	}

	#refuse(code: string): void {
		const refusal = landingClaimRefusalOf(code);

		this.notice = { kind: 'refused', refusal };

		// The handle went to someone else meanwhile, or the waitlist refuses it: back to it, the
		// email kept.
		if (refusal === 'handle_taken' || refusal === 'handle_invalid') {
			this.#pendingHold = undefined;
			this.#stopProbe();
			this.check =
				refusal === 'handle_taken' ? { kind: 'taken' } : { kind: 'format', issue: 'reserved' };
			this.step = 'handle';
		}
	}
}
