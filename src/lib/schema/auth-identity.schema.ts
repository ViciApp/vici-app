import { j } from '@junobuild/schema';

/** Args for `getAuthIdentities`: keyset cursor on the `#user` doc KEY
 * (principal text); blank = first page. */
export const GetAuthIdentitiesArgsSchema = j.strictObject({
	afterKey: j.optional(j.string()),
	limit: j.number()
});

/**
 * One exported auth-identity row: the `#user` doc envelope (key = the user's
 * principal text + ns timestamps) plus the sign-in provider and every address
 * the satellite holds for that principal. `openidEmail`/`openidName` come from
 * the persisted OpenID claims (Google: present only when the user consented
 * to share them; Juno does not persist the OIDC `sub`), `profileEmail` from
 * the `profiles` doc (also fed by the passkey/email signup path). Flat; no
 * nested optional object, for the same codegen constraint as the analytics
 * export rows.
 */
export const AuthIdentityExportRowSchema = j.strictObject({
	key: j.string(),
	createdAtNs: j.string(),
	updatedAtNs: j.string(),
	provider: j.optional(j.string()),
	openidEmail: j.optional(j.string()),
	openidName: j.optional(j.string()),
	profileEmail: j.optional(j.string())
});

export const GetAuthIdentitiesResultSchema = j.strictObject({
	rows: j.array(AuthIdentityExportRowSchema),
	hasMore: j.boolean()
});
