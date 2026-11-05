import { ROLE_PERMISSIONS } from '#lib/constants/authz.constants.ts';
import { SATELLITE_CONTROLLERS } from '#lib/constants/controllers.constants.ts';
import type { Permission } from '#lib/enums/permission.ts';
import { UserRole } from '#lib/enums/user.ts';
import { userStore } from '#lib/stores/user.store.ts';
import { nonNullish } from '@dfinity/utils';
import type { PrincipalText } from '@junobuild/schema';
import { derived, type Readable } from 'svelte/store';

export const userSignedIn: Readable<boolean> = derived(userStore, ({ user }) => nonNullish(user));

export const userNotSignedIn: Readable<boolean> = derived(userSignedIn, (signedIn) => !signedIn);

export const authBusy: Readable<boolean> = derived(userStore, ({ authBusy }) => authBusy);

/**
 * True only once we know for sure the user is signed out. See
 * {@link userStore} `authBusy` for the rationale (avoid flashing the wrong UI).
 */
export const userSignedOutResolved: Readable<boolean> = derived(
	userStore,
	({ user, authBusy }) => !authBusy && !nonNullish(user)
);

export const authPrincipal: Readable<PrincipalText | undefined> = derived(
	userStore,
	({ user }) => user?.owner
);

const userIsController: Readable<boolean> = derived(
	[authPrincipal],
	([$authPrincipal]) => nonNullish($authPrincipal) && SATELLITE_CONTROLLERS.includes($authPrincipal)
);

export const userRole: Readable<UserRole | undefined> = derived(
	[userIsController, userStore],
	([$userIsController, { profile }]) => ($userIsController ? UserRole.CONTROLLER : profile?.role)
);

export const userPermissions: Readable<Permission[]> = derived(userRole, ($role) =>
	$role ? ROLE_PERMISSIONS[$role] : []
);

export const userIsAdmin: Readable<boolean> = derived(
	[userIsController, userRole],
	([$userIsController, $userRole]) => $userIsController || $userRole === UserRole.ADMIN
);

export const userIsAdminOrSolver: Readable<boolean> = derived(
	[userIsAdmin, userRole],
	([$userIsAdmin, $userRole]) => $userIsAdmin || $userRole === UserRole.SOLVER
);
