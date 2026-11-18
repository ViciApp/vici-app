// Adapter registry: the single lookup surface for chain adapters. Adapters
// self-report enabled/disabled from env at construction; callers either check
// `enabled` or catch ChainDisabledError and answer 503.

import type { Chain } from '../lib/keys';
import { btcAdapter } from './btc/adapter';
import { evmAdapter } from './evm/adapter';
import { icAdapter } from './ic/adapter';
import { solAdapter } from './sol/adapter';
import type { ChainAdapter } from './types';

const ADAPTERS: Record<Chain, ChainAdapter> = {
	ic: icAdapter,
	evm: evmAdapter,
	sol: solAdapter,
	btc: btcAdapter
};

export const getAdapter = (chain: Chain): ChainAdapter => ADAPTERS[chain];

export const listAdapters = (): ChainAdapter[] => Object.values(ADAPTERS);

export const enabledAdapters = (): ChainAdapter[] =>
	listAdapters().filter((adapter) => adapter.enabled);

export const isChain = (value: string): value is Chain =>
	value === 'ic' || value === 'evm' || value === 'sol' || value === 'btc';
