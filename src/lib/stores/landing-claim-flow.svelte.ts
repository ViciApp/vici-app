import {
	LANDING_CLAIM_CHECK_DEBOUNCE_MS,
	LANDING_CLAIM_CODE_LENGTH
} from '#lib/constants/landing-claim.constants.ts';
import { checkHandleAvailabilityPublic } from '#lib/services/handle-availability.services.ts';
import type {
	LandingClaimCheck,
	LandingClaimNotice,
	LandingClaimStep,
	LandingClaimSubmit
} from '#lib/types/landing-claim.ts';
import {
	cleanClaimCode,
	cleanClaimHandle,
	isLikelyEmail,
	landingClaimRefusalOf,
	localClaimCheck
} from '#lib/utils/landing-claim.utils.ts';

/** What one press of the capsule's button led to. */
export type LandingClaimAdvance =
	{ kind: 'advanced' } | { kind: 'refused' } | { kind: 'claimed'; handle: string };

/**
 * The claim capsule's steps (handle, email, code) and what each press does,
 * apart from the DOM: the handle is probed as it is typed (debounced, stale
 * answers dropped), the email and code go through the page's waitlist
 * calls, and a handle the waitlist finds taken sends the visitor back to it
 * with the email kept.
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

	readonly busy = $derived(this.notice.kind === 'busy');

	readonly #submit: () => LandingClaimSubmit;
	#probeToken = 0;
	#probeTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(submit: () => LandingClaimSubmit) {
		this.#submit = submit;
	}

	/** Sets the typed handle, cleaned and capped by the handle rule, and probes it. */
	inputHandle(raw: string): string {
		this.handle = cleanClaimHandle(raw);
		this.typed = true;
		this.notice = { kind: 'none' };
		this.#scheduleProbe();

		return this.handle;
	}

	inputEmail(value: string): void {
		this.email = value;
		this.notice = { kind: 'none' };
	}

	/** Sets the typed code, digits only. */
	inputCode(raw: string): string {
		this.code = cleanClaimCode(raw);
		this.notice = { kind: 'none' };

		return this.code;
	}

	/** Every opening starts at the handle; what was typed stays. */
	reopen(): void {
		this.step = 'handle';
		this.notice = { kind: 'none' };
		this.typed = this.handle !== '';
	}

	/** From the code back to the email, to fix it or ask for a new code. */
	back(): void {
		this.notice = { kind: 'none' };
		this.step = 'email';
	}

	/** What the step's button does. Ignored while a call is in flight. */
	async next(): Promise<LandingClaimAdvance> {
		if (this.busy) {
			return { kind: 'advanced' };
		}

		if (this.step === 'handle') {
			return await this.#nextFromHandle();
		}

		if (this.step === 'email') {
			return await this.#nextFromEmail();
		}

		return await this.#nextFromCode();
	}

	dispose(): void {
		clearTimeout(this.#probeTimer);
		this.#probeToken += 1;
	}

	#scheduleProbe(): void {
		this.dispose();
		this.check = localClaimCheck(this.handle);

		if (this.check.kind !== 'checking') {
			return;
		}

		const token = this.#probeToken;

		this.#probeTimer = setTimeout(() => void this.#probe(token), LANDING_CLAIM_CHECK_DEBOUNCE_MS);
	}

	async #probe(token: number): Promise<LandingClaimCheck> {
		let next: LandingClaimCheck;

		try {
			const res = await checkHandleAvailabilityPublic({ handle: this.handle });

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
			this.dispose();
			this.notice = { kind: 'busy' };
			current = await this.#probe(this.#probeToken);
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

		this.notice = { kind: 'busy' };

		try {
			const res = await this.#submit().requestCode({
				handle: this.handle,
				email: this.email.trim()
			});

			if ('ok' in res) {
				this.notice = { kind: 'none' };
				this.code = '';
				this.step = 'code';

				return { kind: 'advanced' };
			}

			this.#refuse(res.error);
		} catch (err: unknown) {
			console.error('Landing claim: code request failed', err);
			this.notice = { kind: 'refused', refusal: 'failed' };
		}

		return { kind: 'refused' };
	}

	async #nextFromCode(): Promise<LandingClaimAdvance> {
		if (this.code.length !== LANDING_CLAIM_CODE_LENGTH) {
			return { kind: 'refused' };
		}

		this.notice = { kind: 'busy' };

		try {
			const res = await this.#submit().confirm({ email: this.email.trim(), code: this.code });

			if ('handle' in res) {
				this.notice = { kind: 'none' };
				this.step = 'done';

				return { kind: 'claimed', handle: res.handle };
			}

			this.#refuse(res.error);
		} catch (err: unknown) {
			console.error('Landing claim: code confirmation failed', err);
			this.notice = { kind: 'refused', refusal: 'failed' };
		}

		return { kind: 'refused' };
	}

	#refuse(code: string): void {
		const refusal = landingClaimRefusalOf(code);

		this.notice = { kind: 'refused', refusal };

		// The handle went to someone else meanwhile: back to it, the email kept.
		if (refusal === 'handle_taken') {
			this.dispose();
			this.check = { kind: 'taken' };
			this.step = 'handle';
		}
	}
}
