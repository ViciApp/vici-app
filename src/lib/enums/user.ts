/**
 * Juno-side role assigned in the `roles` collection. The absence of a role doc is the
 * canonical "regular user" state: there is deliberately no `USER` variant here. If a
 * capability is shared by all authenticated users, encode it as "role doc missing" at the
 * call site.
 *
 * `CONTROLLER` is listed for completeness but is never grantable from the admin UI: it
 * refers to canister controllers, which are managed at the IC level.
 */
export enum UserRole {
	CONTROLLER = 'controller',
	ADMIN = 'admin',
	SOLVER = 'solver',
	CREATOR = 'creator'
}
