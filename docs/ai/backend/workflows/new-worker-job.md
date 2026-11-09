# Workflow: add a background job

Paths are under `backend/`.

1. **Write the tick in its domain**, exported, e.g. `tournamentDrawTick` in `src/tournaments/tournaments.ts` or `tickDepositWatchers` in `src/chains/watchers.ts`. It must be idempotent: a crash halfway and the next tick re-running it must not double-apply anything. Dedupe through the schema (a unique key, a write-once column, a status transition guarded in the `where` clause), never through in-memory state: the worker restarts and the app may run more than one instance.
2. **Register it** as a `WorkerJob { name, run, everyNthTick? }` entry in `src/worker.ts` (`jobs`, line 38), with a one-line comment saying why re-runs are no-ops. Use `everyNthTick: HOURLY_TICKS` for sweeps that can wait; omit it for money paths that must run every tick. The name is stable: logs and alerts key on it.
3. **Log only when something happened** (`if (count > 0) logger.info(...)`): a quiet tick logs nothing (#1424).
4. **Test the tick function directly** in `tests/<topic>.test.ts`: one run does the work, a second run does nothing, a failing dependency leaves state retryable. `tick()` already isolates a throwing job; you do not need to test that again.
5. **If it moves funds**, read [`../custody.md`](../custody.md) first: refund only on a definite rejection, never regenerate dedup fields.
