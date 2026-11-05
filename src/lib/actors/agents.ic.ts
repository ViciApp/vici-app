import { REPLICA_HOST } from '#lib/constants/app.constants.ts';
import { isDev } from '#lib/env/app.env.ts';
import { AgentManager } from '@dfinity/utils';

const agents = AgentManager.create({ fetchRootKey: isDev(), host: REPLICA_HOST });

export const { getAgent } = agents;
