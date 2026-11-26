/**
 * Japanese: landing copy only.
 *
 * Partial `soon` catalog: only a subset of the landing `welcome.*` keys ship
 * here, the ones with an established Japanese voice. Every other key, and the
 * rest of the app, resolves through the fallback chain (`ja` → `en`). Proper
 * nouns (VICI, VXP, Flow, FIFA, ワールドカップ) stay as-is.
 */
export const jaMessages = {
	'landing.claim.check_failed': '確認できませんでした。もう一度どうぞ。',
	'landing.claim.checking': '@{handle} を確認中…',
	'landing.claim.code_expired':
		'コードの有効期限が切れました。戻って新しいコードを受け取ってください。',
	'landing.claim.code_placeholder': '{digits}桁のコード',
	'landing.claim.code_prompt': '{email} に送った{digits}桁のコードを入力してください。',
	'landing.claim.code_wrong': 'コードが違います。もう一度どうぞ。',
	'landing.claim.confirm_failed': 'コードを確認できませんでした。もう一度どうぞ。',
	'landing.claim.confirming': 'コードを確認中…',
	'landing.claim.consent': 'メールはウェイトリストの順番を確保するために使います。',
	'landing.claim.cta.claim': '確保する',
	'landing.claim.dialog': 'ハンドルを確保',
	'landing.claim.done': 'ハンドルを確保しました。ウェイトリストに登録済みです。',
	'landing.claim.email_invalid': 'メールアドレスの形式が正しくないようです。',
	'landing.claim.email_prompt': '@{handle} は空いています。メールを入力すれば確保しておきます。',
	'landing.claim.free': '@{handle} は空いています。',
	'landing.claim.handle_label': 'ハンドル',
	'landing.claim.handle_placeholder': 'yourname',
	'landing.claim.intro': 'ハンドルを確保して、ウェイトリストに登録しよう。',
	'landing.claim.invalid': '使えるのは文字、数字、ピリオド、ハイフン、アンダースコアのみです。',
	'landing.claim.privacy': 'プライバシーポリシー',
	'landing.claim.rate_limited': '試行回数が多すぎます。1分ほど待ってください。',
	'landing.claim.send_failed': 'コードを送信できませんでした。もう一度どうぞ。',
	'landing.claim.sending': 'コードを送信中…',
	'landing.claim.taken': '@{handle} は使用済みです。別の名前をどうぞ。',
	'landing.claim.taken_meanwhile': '@{handle} はたった今使われました。別の名前をどうぞ。',
	'landing.claim.too_long': 'もう少し短く：{max}文字まで。',
	'landing.claim.too_short': 'もう少し長く：{min}文字以上。',
	'landing.nav.cards': 'カード',
	'landing.nav.claim': '@handle を確保',
	'landing.nav.claim_short': '@handle を確保',
	'landing.nav.handle': '@{handle}',
	'landing.nav.markets': 'マーケット',
	'landing.nav.switch': '表示を切り替え',
	'welcome.close.cta': '予測を始める（無料）',
	'welcome.hero.cta': '最初の予測をする',
	'welcome.hero.hint': 'カードをスワイプ：左でNO、右でYES',
	'welcome.hero.kicker': '無料の予想ゲーム · ライブ配信中',
	'welcome.hero.payoff_cta': '今すぐ参加',
	'welcome.how.s1': '本物の予測をスワイプ',
	'welcome.how.s2': '公開データで決着する',
	'welcome.how.s3': 'リーダーボードを駆け上がる',
	'welcome.trust.band': '胴元なし。優位なし。すべてのマーケットは公開データで決着します。'
} as const;
