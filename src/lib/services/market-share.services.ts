import { listSeriesCatalog } from '#lib/services/market.services.ts';
import { marketShareIdPrefix, uniqueSeriesIdWithPrefix } from '#lib/utils/market-slug.utils.ts';
import { isNullish } from '@dfinity/utils';
import { AnonymousIdentity } from '@icp-sdk/core/agent';

/**
 * The series a share param (`slug~id8`, or a bare id) names, read against
 * the public catalog, or `undefined` when the param is malformed, names a
 * market that is gone, or the catalog cannot be read: the caller then lands
 * on the markets, never on a dead page. Shared by the `/m/[id]` share link
 * and the landing's `/?m=` alias. An uncertified read: the id only picks
 * where to go, and the page there reads the market itself.
 */
export const resolveMarketShareSeriesId = async (param: string): Promise<string | undefined> => {
	const prefix = marketShareIdPrefix(param);

	if (isNullish(prefix)) {
		return;
	}

	try {
		const series = await listSeriesCatalog({
			identity: new AnonymousIdentity(),
			certified: false
		});

		return uniqueSeriesIdWithPrefix({
			seriesIds: series.map(({ series_id }) => series_id),
			prefix
		});
	} catch (_err: unknown) {
		// Expected when the registry is unreachable: no market, never a dead page.
	}
};
