// Minimal EVM primitives: RLP, EIP-55 addresses, ERC-20 calldata and
// EIP-1559 (type 2) transaction signing. Hand-rolled on @noble/curves +
// @noble/hashes instead of pulling a full SDK: the custody service only ever
// builds one transaction shape, and the primitives are small enough to test
// against known vectors directly.

import { isNullish } from '@dfinity/utils';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { ZERO } from '../../lib/constants';

export type RlpInput = Uint8Array | RlpInput[];

const concatBytes = (...arrays: Uint8Array[]): Uint8Array => {
	const total = arrays.reduce((sum, a) => sum + a.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;

	for (const a of arrays) {
		out.set(a, offset);
		offset += a.length;
	}

	return out;
};

const encodeLength = (length: number, offset: number): Uint8Array => {
	if (length < 56) {
		return Uint8Array.of(offset + length);
	}

	let hex = length.toString(16);

	if (hex.length % 2 === 1) {
		hex = `0${hex}`;
	}

	const lengthBytes = hexToBytes(hex);

	return concatBytes(Uint8Array.of(offset + 55 + lengthBytes.length), lengthBytes);
};

export const rlpEncode = (input: RlpInput): Uint8Array => {
	if (input instanceof Uint8Array) {
		if (input.length === 1 && (input[0] ?? 0) < 0x80) {
			return input;
		}

		return concatBytes(encodeLength(input.length, 0x80), input);
	}

	const encodedItems = concatBytes(...input.map(rlpEncode));

	return concatBytes(encodeLength(encodedItems.length, 0xc0), encodedItems);
};

/** Minimal big-endian byte encoding of an unsigned integer (empty for zero),
 * the RLP integer convention. */
export const bigintToMinimalBytes = (value: bigint): Uint8Array => {
	if (value < ZERO) {
		throw new Error('cannot RLP-encode a negative integer');
	}

	if (value === ZERO) {
		return new Uint8Array(0);
	}

	let hex = value.toString(16);

	if (hex.length % 2 === 1) {
		hex = `0${hex}`;
	}

	return hexToBytes(hex);
};

const strip0x = (hex: string): string => (hex.startsWith('0x') ? hex.slice(2) : hex);

/** EIP-55 mixed-case checksum encoding of a 20-byte address. */
export const toChecksumAddress = (address: string): string => {
	const lower = strip0x(address).toLowerCase();
	const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
	let out = '0x';

	for (let i = 0; i < lower.length; i++) {
		const nibble = parseInt(hash[i] ?? '0', 16);

		out += nibble >= 8 ? (lower[i] ?? '').toUpperCase() : (lower[i] ?? '');
	}

	return out;
};

/** The EIP-55 address for a secp256k1 private key. */
export const evmAddressFromPrivateKey = (privateKey: Uint8Array): string => {
	const publicKey = secp256k1.getPublicKey(privateKey, false);
	const hash = keccak_256(publicKey.slice(1));

	return toChecksumAddress(bytesToHex(hash.slice(12)));
};

/** ERC-20 `transfer(address,uint256)` calldata. */
export const encodeErc20Transfer = ({ to, amount }: { to: string; amount: bigint }): string => {
	const selector = 'a9059cbb';
	const paddedTo = strip0x(to).toLowerCase().padStart(64, '0');
	const paddedAmount = amount.toString(16).padStart(64, '0');

	return `0x${selector}${paddedTo}${paddedAmount}`;
};

export interface Eip1559Tx {
	chainId: bigint;
	nonce: bigint;
	maxPriorityFeePerGas: bigint;
	maxFeePerGas: bigint;
	gasLimit: bigint;
	to: string;
	value: bigint;
	data: string;
}

const txPayload = (unsignedTx: Eip1559Tx): RlpInput[] => [
	bigintToMinimalBytes(unsignedTx.chainId),
	bigintToMinimalBytes(unsignedTx.nonce),
	bigintToMinimalBytes(unsignedTx.maxPriorityFeePerGas),
	bigintToMinimalBytes(unsignedTx.maxFeePerGas),
	bigintToMinimalBytes(unsignedTx.gasLimit),
	hexToBytes(strip0x(unsignedTx.to)),
	bigintToMinimalBytes(unsignedTx.value),
	hexToBytes(strip0x(unsignedTx.data === '' ? '' : unsignedTx.data)),
	// Access list: always empty for the simple transfer shapes built here.
	[]
];

/** Sign an EIP-1559 transaction; the raw `0x02...` hex ready for
 * eth_sendRawTransaction. */
export const signEip1559Tx = ({
	tx,
	privateKey
}: {
	tx: Eip1559Tx;
	privateKey: Uint8Array;
}): string => {
	const payload = txPayload(tx);
	const sighash = keccak_256(concatBytes(Uint8Array.of(0x02), rlpEncode(payload)));
	// The sighash is already keccak'd, so noble must not hash it again with sha256.
	const { r, s, recovery } = secp256k1.Signature.fromBytes(
		secp256k1.sign(sighash, privateKey, { prehash: false, format: 'recovered' }),
		'recovered'
	);

	if (isNullish(recovery)) {
		throw new Error('secp256k1 signature is missing its recovery id');
	}

	const signed: RlpInput[] = [
		...payload,
		bigintToMinimalBytes(BigInt(recovery)),
		bigintToMinimalBytes(r),
		bigintToMinimalBytes(s)
	];

	return `0x02${bytesToHex(rlpEncode(signed))}`;
};
