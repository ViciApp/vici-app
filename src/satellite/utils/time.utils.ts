import { MILLISECOND_IN_NANOSECONDS } from '#lib/constants/app.constants.ts';
import { time } from '@junobuild/functions/ic-cdk';

/** The IC message time (`time()`, in nanoseconds) in milliseconds, the unit of every `*Ms` field. */
export const timeMs = (): number => Number(time() / MILLISECOND_IN_NANOSECONDS);
