// Kept free of imports so modules that must load without the app's runtime
// dependencies (the satellite, the backend shared-drift suite) can read it.

export const SECOND_IN_NANOSECONDS = 1_000_000_000n;
export const MILLISECOND_IN_NANOSECONDS = 1_000_000n;

export const MINUTE_IN_MS = 60_000;
export const HOUR_IN_MS = 60 * MINUTE_IN_MS;
export const DAY_IN_MS = 24 * HOUR_IN_MS;

const MINUTE_IN_SECONDS = 60n;
const HOUR_IN_SECONDS = 60n * MINUTE_IN_SECONDS;
const DAY_IN_SECONDS = 24n * HOUR_IN_SECONDS;
export const DAY_IN_NANOSECONDS = DAY_IN_SECONDS * SECOND_IN_NANOSECONDS;
const WEEK_IN_SECONDS = 7n * DAY_IN_SECONDS;
export const WEEK_IN_NANOSECONDS = WEEK_IN_SECONDS * SECOND_IN_NANOSECONDS;
