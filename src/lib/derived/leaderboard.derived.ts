import { cachedListOrEmpty, cachedNotInitialized } from '#lib/derived/cached.derived.ts';
import { leaderboardStore } from '#lib/stores/leaderboard.store.ts';
import { userStore } from '#lib/stores/user.store.ts';
import type { UserProfile } from '#lib/types/profile.ts';
import { derived, type Readable } from 'svelte/store';

/**
 * Cached leaderboard with the current user's row overlaid by their
 * locally-known profile. The leaderboard store is populated via
 * `listDocs` against the public profiles collection, so it reflects
 * whatever was last persisted — which may lag behind changes made in
 * this session, or still be the bootstrap shortened-principal fallback
 * if the user never edited their nickname. For the viewer's own row we
 * always have the freshest data in `userStore.profile`, so we splice
 * the live identity (nickname/avatar) and the live display-only
 * performance fields (daily streak/accuracy) in here — the row, podium tile,
 * and mini-profile sheet all read from this single merged source so the
 * viewer sees their own up-to-the-second numbers rather than a stale
 * snapshot.
 *
 * `points` is intentionally NOT overlaid: it is the sort key that
 * defines leaderboard order, and the array's ordering reflects the
 * server snapshot. Overlaying a live `points` value would leave the
 * viewer's row at a stale position while showing a higher/lower VXP
 * number, making `rankOf` report an incorrect index and the podium
 * tile show a rank that disagrees with the displayed score.
 */
interface SelfOverlay {
	owner: string | undefined;
	nickname: UserProfile['nickname'];
	avatar: UserProfile['avatar'];
	avatarParts: UserProfile['avatarParts'];
	/**
	 * Days-based activity streak (the Flame engine) — every surface that
	 * renders a leaderboard row's streak shows "{n}d", so the days counter
	 * is the one to keep fresh, not the consecutive-wins `streak`.
	 */
	dailyStreak: UserProfile['dailyStreak'];
	accuracy: UserProfile['accuracy'];
}

/**
 * Narrows `userStore` to just the identity / performance fields the
 * leaderboard splices in. Paired with the single-row splice below (only the
 * viewer's own entry is copied, every other row keeps its reference) this keeps
 * an unrelated `userStore` tick (`authBusy` toggle, balance change, …) from
 * re-allocating the whole array the way the previous `.map()` did.
 */
const selfOverlay: Readable<SelfOverlay | undefined> = derived(userStore, ({ user, profile }) =>
	user && profile
		? {
				owner: user.owner,
				nickname: profile.nickname,
				avatar: profile.avatar,
				avatarParts: profile.avatarParts,
				dailyStreak: profile.dailyStreak,
				accuracy: profile.accuracy
			}
		: undefined
);

export const leaderboard: Readable<UserProfile[]> = derived(
	[cachedListOrEmpty(leaderboardStore), selfOverlay],
	([$leaderboard, $self]) => {
		if (!$self) {
			return $leaderboard;
		}

		const idx = $leaderboard.findIndex((entry) => entry.owner === $self.owner);

		if (idx < 0) {
			return $leaderboard;
		}

		const next = [...$leaderboard];
		next[idx] = {
			...next[idx],
			nickname: $self.nickname,
			avatar: $self.avatar,
			avatarParts: $self.avatarParts,
			dailyStreak: $self.dailyStreak,
			accuracy: $self.accuracy
		};

		return next;
	}
);

export const leaderboardNotInitialized: Readable<boolean> = cachedNotInitialized(leaderboardStore);
