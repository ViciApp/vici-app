import { expect, type Locator, type Page } from '@playwright/test';
import { E2E_EMAIL_DOMAIN } from '../../backend/e2e/fixtures';
import { enMessages } from '../../src/lib/constants/messages/en';
import { TestId } from '../../src/lib/constants/test-ids.constants';
import type { E2eBackend } from '../support/fixtures';

/**
 * Page object for the web2 build: the email one-time-code sign-in
 * (`SignInProviderStackWeb2`), the `/signup` onboarding in front of it, and
 * the signed-in shell. Copy is read from the English catalog so a wording
 * change updates one place.
 */
export class Web2AppPage {
	readonly page: Page;
	readonly emailInput: Locator;
	readonly emailSubmit: Locator;
	readonly codeInput: Locator;
	readonly codeSubmit: Locator;
	readonly betaClosedMessage: Locator;
	readonly legacyPendingMessage: Locator;
	readonly legacyAppLink: Locator;
	readonly onboarding: Locator;
	readonly onboardingHandleInput: Locator;
	readonly appMain: Locator;
	readonly marketFeed: Locator;
	readonly marketCard: Locator;
	/** Desktop nav handle or mobile pillnav tab, whichever the viewport shows. */
	readonly userMenu: Locator;
	readonly profileHandle: Locator;
	readonly signOutButton: Locator;
	readonly logoutButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.emailInput = page.getByLabel(enMessages['signin.email.aria']);
		this.emailSubmit = page.getByRole('button', {
			name: enMessages['signin.email.cta'],
			exact: true
		});
		this.codeInput = page.getByLabel(enMessages['signin.otp.aria']);
		this.codeSubmit = page.getByRole('button', { name: enMessages['signin.otp.verify_cta'] });
		this.betaClosedMessage = page.getByText(enMessages['signin.beta_closed']);
		this.legacyPendingMessage = page.getByText(enMessages['signin.legacy_pending.body']);
		this.legacyAppLink = page.getByRole('link', { name: enMessages['signin.legacy_pending.cta'] });
		this.onboarding = page.getByTestId(TestId.Onboarding);
		this.onboardingHandleInput = page.getByTestId(TestId.OnboardingHandleInput);
		this.appMain = page.getByTestId(TestId.AppMain);
		this.marketFeed = page.getByTestId(TestId.MarketFeed);
		this.marketCard = page.getByTestId(TestId.MarketCard);
		this.userMenu = page.locator(`[data-tid="${TestId.UserMenu}"]:visible`);
		this.profileHandle = this.appMain.locator('.profile-hero-handle');
		this.signOutButton = page.getByTestId(TestId.SignOutButton);
		this.logoutButton = page.getByTestId(TestId.Logout);
	}

	/** Submit an address on whichever sign-in surface is showing. */
	async requestCode(email: string): Promise<void> {
		await expect(this.emailInput).toBeEnabled();

		await this.emailInput.fill(email);
		await this.emailSubmit.click();
	}

	/** Type the code the API issued for `email` and verify it. */
	async enterCode({ email, backend }: { email: string; backend: E2eBackend }): Promise<void> {
		await expect(this.codeInput).toBeVisible();

		await this.codeInput.fill(await backend.otpFor(email));
		await this.codeSubmit.click();
	}

	/** Returning-user path: `/signin`, code, signed-in shell. */
	async signIn({ email, backend }: { email: string; backend: E2eBackend }): Promise<void> {
		await this.page.goto('/signin');
		await this.requestCode(email);
		await this.enterCode({ email, backend });
		await this.waitForSignedInShell();
	}

	/**
	 * New-user path: `/signup` onboarding, claim `handle`, then the email code.
	 * The provider stack stays disabled until the handle is claimable, so the
	 * email field turning enabled is the availability probe's all-clear.
	 */
	async signUp({
		email,
		handle,
		backend
	}: {
		email: string;
		handle: string;
		backend: E2eBackend;
	}): Promise<void> {
		await this.page.goto('/signup');

		await expect(this.onboarding).toBeVisible();

		await this.onboardingHandleInput.fill(handle);
		await this.requestCode(email);
		await this.enterCode({ email, backend });
		await this.waitForSignedInShell();
		await this.waitForOnboardingHandoff();
	}

	/**
	 * The claimed handle is written to the new profile asynchronously, by the
	 * `(app)` layout's drain of the pre-auth stash. A full page load before it
	 * settles re-hydrates a profile-less account mid-write, so wait for the
	 * stash to clear; every drain outcome clears it, so this cannot mask a
	 * failed write (the specs assert the handle itself).
	 */
	async waitForOnboardingHandoff(): Promise<void> {
		await expect
			// `PENDING_ONBOARDING_STORAGE_KEY` in src/lib/constants/profile.constants.ts.
			.poll(() => this.page.evaluate(() => localStorage.getItem('vici:pending-onboarding')))
			.toBeNull();
	}

	async waitForSignedInShell(): Promise<void> {
		await expect(this.userMenu).toBeVisible();
	}

	/** No loading placeholder left on screen: every read the page waits on has
	 * answered (placeholders share the `skel` class prefix). */
	async waitForLoaded(): Promise<void> {
		await expect(this.page.locator('[class*="skel"]')).toHaveCount(0);
	}

	/** Settings is the one sign-out surface: reveal, then confirm. */
	async signOut(): Promise<void> {
		await this.page.goto('/settings');
		await this.signOutButton.click();
		await this.logoutButton.click();
	}
}

/** A fresh address per call: runs share one database, and a new user must be
 * new on every run, locally re-run included. */
export const uniqueEmail = (prefix: string): string =>
	`${prefix}.${Date.now().toString(36)}${Math.floor(Math.random() * 1_000)}@${E2E_EMAIL_DOMAIN}`;

/** A handle that cannot collide across runs; stays within the handle rules
 * (lowercase letters and digits, short). */
export const uniqueHandle = (): string =>
	`e2e${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`;
