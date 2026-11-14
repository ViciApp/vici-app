import type { AppLocale } from '#lib/constants/locale.constants.ts';
import {
	isMacroId,
	isMicroId,
	macroLabelKey,
	microLabelKey
} from '#lib/constants/market-taxonomy.constants.ts';
import { t } from '#lib/utils/i18n.utils.ts';

/**
 * Frontend-only rendering helpers for market categories.
 *
 * Kept apart from `market-taxonomy.constants.ts` on purpose: that module is
 * bundled into the satellite wasm (via the classification helpers), and `t`
 * is a runtime value whose module statically imports every locale catalog:
 * a value import of it from the constants module would ship all catalogs
 * inside the satellite and make every copy-only release count as a satellite
 * change for the deploy pipeline's upgrade check.
 */

/**
 * Variant of a category rendering:
 *
 * - `short` → the bare uppercased category id (`crypto` → `CRYPTO`,
 *   `bitcoin` → `BITCOIN`). Used on compact preview chips (market-list
 *   cards / rows) where space is tight and the accent colour carries most
 *   of the meaning.
 * - `full` → the localized category label via the taxonomy label keys
 *   (`crypto` → "Crypto", `bitcoin` → "Bitcoin"). Used on detail / full
 *   surfaces (FlowCard back, market-detail header). Any uppercasing there
 *   is left to CSS so the localized casing is preserved where the design
 *   doesn't shout.
 */
export type CategoryLabelVariant = 'short' | 'full';

/**
 * Single source of truth for rendering a market category label. `category`
 * may be a macro id OR a micro id: the localized `full` form picks the
 * matching taxonomy label key (`macroLabelKey` / `microLabelKey`), so a
 * caller can pass either a top-level bucket or a subcategory chip.
 *
 * `locale` is only consulted for the `full` variant (the `short` form is
 * locale-independent), but it's required so call sites pass the active
 * `$localeStore` uniformly regardless of variant.
 */
export const categoryLabel = ({
	category,
	variant,
	locale
}: {
	category: string;
	variant: CategoryLabelVariant;
	locale: AppLocale;
}): string => {
	if (variant === 'short') {
		return category.toUpperCase();
	}

	if (isMacroId(category)) {
		return t({ locale, key: macroLabelKey(category) });
	}

	if (isMicroId(category)) {
		return t({ locale, key: microLabelKey(category) });
	}

	return category.toUpperCase();
};
