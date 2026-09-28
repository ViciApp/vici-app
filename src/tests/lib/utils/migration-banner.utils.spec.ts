import { activeMigrationBanner, isMoveNoticeVisible } from '$lib/utils/migration-banner.utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('activeMigrationBanner', () => {
	it('shows no migration banner on the web2 build, whatever the switch', () => {
		assert.equal(
			activeMigrationBanner({ web2Backend: true, claimHandoffEnabled: false }),
			undefined
		);
		assert.equal(
			activeMigrationBanner({ web2Backend: true, claimHandoffEnabled: true }),
			undefined
		);
	});

	it('shows the move notice on the legacy build before cutover', () => {
		assert.equal(
			activeMigrationBanner({ web2Backend: false, claimHandoffEnabled: false }),
			'move_notice'
		);
	});

	it('hands the slot to the claim banner once the cutover switch is on', () => {
		assert.equal(activeMigrationBanner({ web2Backend: false, claimHandoffEnabled: true }), 'claim');
	});
});

describe('isMoveNoticeVisible', () => {
	it('is visible on the legacy build before cutover when not dismissed', () => {
		assert.equal(
			isMoveNoticeVisible({ web2Backend: false, claimHandoffEnabled: false, dismissed: false }),
			true
		);
	});

	it('stays hidden once dismissed', () => {
		assert.equal(
			isMoveNoticeVisible({ web2Backend: false, claimHandoffEnabled: false, dismissed: true }),
			false
		);
	});

	it('never shows on the web2 build', () => {
		assert.equal(
			isMoveNoticeVisible({ web2Backend: true, claimHandoffEnabled: false, dismissed: false }),
			false
		);
	});

	it('stops showing when the claim switch is on, so it never stacks on the claim banner', () => {
		assert.equal(
			isMoveNoticeVisible({ web2Backend: false, claimHandoffEnabled: true, dismissed: false }),
			false
		);
	});
});
