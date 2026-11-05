import type { AppLocale } from '#lib/constants/locale.constants.ts';
import { isMacroId, macroLabelKey } from '#lib/constants/market-taxonomy.constants.ts';
import { BATTLE_SCOPE_DEFAULT, type BattleScope } from '#lib/types/battle.ts';
import { t } from '#lib/utils/i18n.utils.ts';

/**
 * Single source of truth for a battle's scope label. `all` (and legacy
 * rows with no scope) read "All calls"; a market-tag scope reuses the
 * canonical category catalog so the label stays identical on every
 * surface that renders a battle (the Battles inbox card and the battle
 * detail page) and can't drift between them.
 */
export const battleScopeLabel = ({
	scope,
	locale
}: {
	scope: BattleScope | undefined;
	locale: AppLocale;
}): string => {
	const resolved = scope ?? BATTLE_SCOPE_DEFAULT;

	return resolved !== 'all' && isMacroId(resolved)
		? t({ locale, key: macroLabelKey(resolved) })
		: t({ locale, key: 'battle.detail.scope_all' });
};
