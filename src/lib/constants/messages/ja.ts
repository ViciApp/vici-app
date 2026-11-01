/**
 * Japanese — landing copy only.
 *
 * Partial `soon` catalog: only a subset of the landing `welcome.*` keys ship
 * here, the ones with an established Japanese voice. Every other key — and the
 * rest of the app — resolves through the fallback chain (`ja` → `en`). Proper
 * nouns (VICI, VXP, Flow, FIFA, ワールドカップ) stay as-is.
 */
export const jaMessages = {
	'welcome.close.cta': '予測を始める — 無料',
	'welcome.hero.cta': '最初の予測をする',
	'welcome.hero.hint': 'カードをスワイプ — 左でNO、右でYES',
	'welcome.hero.kicker': '無料の予想ゲーム · ライブ配信中',
	'welcome.hero.payoff_cta': '今すぐ参加',
	'welcome.how.s1': '本物の予測をスワイプ',
	'welcome.how.s2': '公開データで決着する',
	'welcome.how.s3': 'リーダーボードを駆け上がる',
	'welcome.trust.band': '胴元なし。優位なし。すべてのマーケットは公開データで決着します。'
} as const;
