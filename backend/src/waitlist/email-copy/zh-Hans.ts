import { isNullish } from '@dfinity/utils';
import type { WaitlistEmailCopy } from './en';

export const zhHans: WaitlistEmailCopy = {
	code: {
		subject: '你的 VICI 候补名单验证码',
		intro: (handle) => `这是你在 VICI 候补名单上保留 @${handle} 的验证码：`,
		expiry: (minutes) => `验证码 ${minutes} 分钟内有效，在此期间该用户名会为你保留。`,
		ignore: '如果这不是你本人的请求，请忽略这封邮件：我们不会保存任何信息。'
	},
	receipt: {
		subject: (handle) => `@${handle} 归你了，你已加入候补名单`,
		held: (handle) => `@${handle} 已在 VICI 候补名单上为你保留，其他人无法再使用。`,
		next: '我们会分批邀请候补名单上的用户。轮到你时我们会发邮件通知你，届时用这个邮箱创建账户即可保留该用户名。',
		hold: (months) => `保留期为 ${months} 个月；到期前我们会请你确认是否继续保留。`
	},
	removed: {
		subject: '你已退出 VICI 候补名单',
		body: (handle) =>
			isNullish(handle)
				? '你在候补名单上的保留已删除，我们为此保存的所有信息也一并删除。'
				: `@${handle} 已释放，你在候补名单上的保留已删除，我们为此保存的所有信息也一并删除。`
	},
	footer: {
		remove: '将我从候补名单中移除'
	}
};
