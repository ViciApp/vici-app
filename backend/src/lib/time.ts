// Nanosecond timestamps: the unit of IC protocol fields and of the dedup
// stamps the custody, award and analytics tables keep.

const NS_PER_MS = BigInt(1_000_000);

export const msToNs = (ms: number): bigint => BigInt(ms) * NS_PER_MS;

export const nowNs = (): bigint => msToNs(Date.now());
