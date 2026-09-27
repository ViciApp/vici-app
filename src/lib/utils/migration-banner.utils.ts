/**
 * Local dismissal flag for the informational "VICI is moving" notice on the
 * legacy app. Separate from the claim banner's flag so dismissing the notice
 * never hides the claim banner that replaces it at cutover.
 */
export const MOVE_NOTICE_DISMISSED_KEY = 'vici:web2-move-notice-dismissed';

export interface MigrationBannerGate {
	web2Backend: boolean;
	claimHandoffEnabled: boolean;
}

export type MigrationBanner = 'claim' | 'move_notice';

/**
 * Which migration banner the legacy `(app)` shell may show. Exactly one on the
 * legacy build and none on the web2 build: the notice covers the wait before
 * cutover and the claim banner takes over once the cutover switch is on, so
 * the two can never stack.
 */
export const activeMigrationBanner = ({
	web2Backend,
	claimHandoffEnabled
}: MigrationBannerGate): MigrationBanner | undefined => {
	if (web2Backend) {
		return;
	}

	return claimHandoffEnabled ? 'claim' : 'move_notice';
};

export const isMoveNoticeVisible = ({
	dismissed,
	...gate
}: MigrationBannerGate & { dismissed: boolean }): boolean =>
	!dismissed && activeMigrationBanner(gate) === 'move_notice';
