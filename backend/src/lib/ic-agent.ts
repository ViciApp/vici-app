// Shared HttpAgent construction for every IC surface (ledger transfers and
// engine calls). Mainnet host by default; the root key is only fetched for a
// local replica host.

import { HttpAgent, type Identity } from '@icp-sdk/core/agent';
import { env } from '../env';

const isLocalHost = (host: string): boolean =>
	host.includes('localhost') || host.includes('127.0.0.1');

export const buildAgent = (identity?: Identity): Promise<HttpAgent> =>
	HttpAgent.create({
		host: env.ic.host,
		identity,
		shouldFetchRootKey: isLocalHost(env.ic.host)
	});
