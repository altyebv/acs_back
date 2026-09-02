/**
 * The three roles the ACS platform Suppoort.
 *
 * Import ROLES everywhere instead of writing the strings by hand - a typo in a
 * string literal silently disables an authorization check, a typo in an import
 * throws at boot.
 */
export const ROLES = Object.freeze({
  ADMIN: 'admin',
  CONTESTANT: 'contestant',
  JUDGE: 'judge',
});

/** All role values, for enum validation. */
export const ROLE_VALUES = Object.freeze(Object.values(ROLES));

/** Roles an admin is allowed to hand out when creating an account. */
export const ASSIGNABLE_ROLES = Object.freeze([
  ROLES.ADMIN,
  ROLES.CONTESTANT,
  ROLES.JUDGE,
]);

export default ROLES;
