/**
 * Most events one `trackEvents` call stores. The client flushes its buffer once it holds this
 * many, so a real batch never exceeds it.
 */
export const ANALYTICS_MAX_EVENTS_PER_BATCH = 20;

// Length caps on a client event's strings. The capture takes anonymous callers, so these bound
// what one call can make the satellite store; real values sit far below them (a UUID session id,
// an app route, short ids and labels). The web2 API's ingest applies the same caps.
export const ANALYTICS_MAX_SESSION_ID_LENGTH = 128;
export const ANALYTICS_MAX_PATH_LENGTH = 2048;
export const ANALYTICS_MAX_PROP_STRING_LENGTH = 256;
