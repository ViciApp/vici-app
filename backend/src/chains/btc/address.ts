// P2WPKH (native segwit, bech32) address derivation from a secp256k1 key.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32 } from '@scure/base';

export type BtcNetwork = 'mainnet' | 'testnet' | 'regtest';

const HRP: Record<BtcNetwork, string> = {
	mainnet: 'bc',
	testnet: 'tb',
	regtest: 'bcrt'
};

export const hash160 = (bytes: Uint8Array): Uint8Array => ripemd160(sha256(bytes));

/** The bech32 P2WPKH address (witness v0) for a compressed public key. */
export const p2wpkhAddress = ({
	publicKey,
	network
}: {
	publicKey: Uint8Array;
	network: BtcNetwork;
}): string => {
	const program = hash160(publicKey);

	return bech32.encode(HRP[network], [0, ...bech32.toWords(program)]);
};

/** The bech32 P2WPKH address for a secp256k1 private key. */
export const btcAddressFromPrivateKey = ({
	privateKey,
	network
}: {
	privateKey: Uint8Array;
	network: BtcNetwork;
}): string => p2wpkhAddress({ publicKey: secp256k1.getPublicKey(privateKey, true), network });
