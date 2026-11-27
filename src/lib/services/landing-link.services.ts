import { listSeriesCatalog } from '#lib/services/market.services.ts';
import { parseLandingMarketParam } from '#lib/utils/landing-share.utils.ts';
import { uniqueSeriesIdWithPrefix } from '#lib/utils/market-slug.utils.ts';
import { isNullish } from '@dfinity/utils';
import { AnonymousIdentity } from '@icp-sdk/core/agent';

/**
 * The series a landing link (`/?m=<param>`) names, read against the public
 * catalog, or `undefined` when the link names none, a market that is gone,
 * or the catalog cannot be read: the landing then opens as it does without
 * a link. An uncertified read: the id only picks which card comes first,
 * and the deck reads that market itself.
 */
export const resolveLandingLinkSeriesId = async (search: string): Promise<string | undefined> => {
	const link = parseLandingMarketParam(search);

	if (isNullish(link)) {
		return;
	}

	try {
		const series = await listSeriesCatalog({
			identity: new AnonymousIdentity(),
			certified: false
		});

		return uniqueSeriesIdWithPrefix({
			seriesIds: series.map(({ series_id }) => series_id),
			prefix: link.idPrefix
		});
	} catch (_err: unknown) {
		// Expected when the registry is unreachable: no lead, never a dead page.
	}
};
