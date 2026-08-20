import { describe, expect, test } from 'bun:test';
import { CLAIM_AUDIENCE, claimMessageText } from '../../src/auth/claim';
import { importRepoModule } from '../helpers/repo-source';

// The claim handoff is a cross-stack wire contract: the legacy app signs the
// message the API verifies. Both sides build it independently, so the
// audience tag and the canonical message layout are pinned here.
describe('shared drift: claim handoff contract', () => {
	test('audience and message layout match the app util', async () => {
		const appUtil = await importRepoModule<{
			CLAIM_AUDIENCE: string;
			claimMessageText: (input: { principal: string; issuedAtMs: number }) => string;
		}>('src/lib/utils/claim-handoff.utils.ts');

		expect(CLAIM_AUDIENCE).toBe(appUtil.CLAIM_AUDIENCE);

		const sample = { principal: 'aaaaa-aa', issuedAtMs: 1734567890123 };

		expect(claimMessageText(sample)).toBe(appUtil.claimMessageText(sample));
	});
});
