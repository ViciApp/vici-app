#!/usr/bin/env node
/**
 * Prove that `juno functions upgrade` really swapped the satellite wasm.
 *
 * The upgrade step cannot be trusted on its own: on a juno-action image
 * without the Rust toolchain, `functions build` emits no wasm and
 * `functions upgrade` prints "Loading Wasm..." and exits 0 without touching
 * the canister, so a green deploy can leave the old module running. The
 * canister's certified module hash is the only evidence that counts: it must
 * equal the sha256 of the gzipped wasm this run built.
 *
 * Usage: node scripts/verify-satellite-upgrade.mjs --satellite <canister-id>
 */
import { isNullish } from '@dfinity/utils';
import { CanisterStatus, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const WASM_PATH = 'target/deploy/satellite.wasm.gz';
const IC_HOST = 'https://icp-api.io';

const {
	values: { satellite }
} = parseArgs({ options: { satellite: { type: 'string' } } });

if (isNullish(satellite)) {
	console.error('Missing --satellite <canister-id>.');
	process.exit(1);
}

if (!existsSync(WASM_PATH)) {
	console.error(
		`${WASM_PATH} does not exist: "functions build" produced no wasm. Check that the juno-action pin resolves to a -full image.`
	);
	process.exit(1);
}

const built = createHash('sha256').update(readFileSync(WASM_PATH)).digest('hex');

const agent = await HttpAgent.create({ host: IC_HOST });
const status = await CanisterStatus.request({
	canisterId: Principal.fromText(satellite),
	agent,
	paths: ['module_hash']
});
const deployed = status.get('module_hash');

if (deployed !== built) {
	console.error(`Satellite ${satellite} was not upgraded: on chain ${deployed}, built ${built}.`);
	process.exit(1);
}

console.log(`Satellite ${satellite} runs the wasm built by this run (${built}).`);
