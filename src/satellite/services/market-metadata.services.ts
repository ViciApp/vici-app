import { Collection } from '#lib/constants/collections.constants.ts';
import { normalizeStoredTags } from '#lib/constants/market-taxonomy.constants.ts';
import type { MarketMetadata, MarketMetadataInput } from '#lib/types/market-metadata.ts';
import { isAdmin, isCreatorOrAdmin } from '#satellite/services/_authz.ts';
import { updateMarketTagIndex } from '#satellite/services/market-tag-index.services.ts';
import { isNullish } from '@dfinity/utils';
import { msgCaller, time } from '@junobuild/functions/ic-cdk';
import { decodeDocData, encodeDocData, getDocStore, setDocStore } from '@junobuild/functions/sdk';

const callerText = (): string => msgCaller().toText();

const assertCanWriteMarketMetadata = async ({ seriesId }: { seriesId: string }): Promise<void> => {
	if (!(await isCreatorOrAdmin({ caller: msgCaller(), seriesId }))) {
		throw new Error('Only the market creator or an admin can edit market metadata.');
	}
};

export const getMarketMetadata = ({
	seriesId
}: {
	seriesId: string;
}): MarketMetadata | undefined => {
	const doc = getDocStore({
		collection: Collection.MARKET_METADATA,
		key: seriesId,
		caller: msgCaller()
	});

	return isNullish(doc) ? undefined : decodeDocData<MarketMetadata>(doc.data);
};

export const upsertMarketMetadata = async ({
	seriesId,
	data
}: {
	seriesId: string;
	data: MarketMetadataInput;
}): Promise<MarketMetadata> => {
	if ((data.events ?? []).length > 2) {
		throw new Error('Market metadata supports at most two events.');
	}

	await assertCanWriteMarketMetadata({ seriesId });

	const caller = msgCaller();
	const callerIsAdmin = isAdmin({ caller });
	const current = getDocStore({
		collection: Collection.MARKET_METADATA,
		key: seriesId,
		caller
	});

	const currentData = isNullish(current) ? undefined : decodeDocData<MarketMetadata>(current.data);

	// `suggested` is admin-only: creators can edit whyNow/events but can't
	// flip the suggested flag. Non-admin writers always keep the stored value.
	const suggested = callerIsAdmin ? (data.suggested ?? false) : (currentData?.suggested ?? false);

	const metadata: MarketMetadata = {
		seriesId,
		whyNow: data.whyNow,
		events: data.events ?? [],
		tags: normalizeStoredTags(data.tags ?? []),
		suggested,
		subtitle: data.subtitle,
		updatedAt: Number(time() / 1_000_000n),
		updatedBy: callerText()
	};

	setDocStore({
		collection: Collection.MARKET_METADATA,
		key: seriesId,
		doc: {
			version: current?.version,
			data: encodeDocData(metadata)
		},
		caller
	});

	// Keep the reverse index in sync inline — Juno hooks don't fire on
	// serverless `setDocStore`, so this is the only place a metadata write can
	// update it. The index maintains a bucket per micro AND per derived macro;
	// it re-derives those bucket keys from each tag set itself.
	updateMarketTagIndex({
		seriesId,
		oldTags: currentData?.tags ?? [],
		newTags: metadata.tags
	});

	return metadata;
};
