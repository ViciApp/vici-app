/** Shared bigint zero (the `0n` literal is lint-restricted repo-wide). */
export const ZERO = BigInt(0);

/** Canonical UUID text in any case. No `g` flag: `test` stays stateless
 * across the callers that share this instance. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The largest value a Postgres `int` column holds; a sum that could pass it
 * is clamped here instead of failing the write that carries it. */
export const PG_INT_MAX = 2_147_483_647;
