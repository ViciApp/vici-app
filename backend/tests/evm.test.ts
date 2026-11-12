// EVM primitive vectors: address derivation for the canonical private key 1,
// EIP-55 checksum vectors from the spec, ERC-20 transfer calldata, and a
// signed EIP-1559 transaction verified by RLP round-trip + public key
// recovery (the recovered signer must equal the from-address).

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'bun:test';
import {
	bigintToMinimalBytes,
	encodeErc20Transfer,
	evmAddressFromPrivateKey,
	rlpEncode,
	signEip1559Tx,
	toChecksumAddress,
	type RlpInput
} from '../src/chains/evm/tx';

const PRIVATE_KEY_ONE = hexToBytes(
	'0000000000000000000000000000000000000000000000000000000000000001'
);

describe('evmAddressFromPrivateKey', () => {
	test('derives the canonical address of private key 1', () => {
		expect(evmAddressFromPrivateKey(PRIVATE_KEY_ONE)).toBe(
			'0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'
		);
	});
});

describe('toChecksumAddress', () => {
	// Vectors straight from the EIP-55 specification.
	const vectors = [
		'0x52908400098527886E0F7030069857D2E4169EE7',
		'0x8617E340B3D01FA5F11F306F4090FD50E238070D',
		'0xde709f2102306220921060314715629080e2fb77',
		'0x27b1fdb04752bbc536007a920d24acb045561c26',
		'0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
		'0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
		'0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
		'0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb'
	];

	test.each(vectors)('%s round-trips through the checksum', (address) => {
		expect(toChecksumAddress(address.toLowerCase())).toBe(address);
	});
});

describe('rlpEncode', () => {
	test('encodes canonical primitives', () => {
		// Vectors from the RLP specification.
		expect(bytesToHex(rlpEncode(new TextEncoder().encode('dog')))).toBe('83646f67');
		expect(bytesToHex(rlpEncode(new Uint8Array(0)))).toBe('80');
		expect(bytesToHex(rlpEncode(Uint8Array.of(0x0f)))).toBe('0f');
		expect(bytesToHex(rlpEncode([]))).toBe('c0');
		expect(
			bytesToHex(rlpEncode([new TextEncoder().encode('cat'), new TextEncoder().encode('dog')]))
		).toBe('c88363617483646f67');
	});

	test('bigintToMinimalBytes strips leading zeros and maps 0 to empty', () => {
		expect(bigintToMinimalBytes(BigInt(0))).toHaveLength(0);
		expect(bytesToHex(bigintToMinimalBytes(BigInt(1024)))).toBe('0400');
	});
});

describe('encodeErc20Transfer', () => {
	test('builds transfer(address,uint256) calldata', () => {
		expect(
			encodeErc20Transfer({
				to: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
				amount: BigInt(1_000_000)
			})
		).toBe(
			'0xa9059cbb0000000000000000000000007e5f4552091a69125d5dfcb7b8c2659029395bdf00000000000000000000000000000000000000000000000000000000000f4240'
		);
	});
});

// A minimal RLP decoder, enough to round-trip the signed transaction.
const rlpDecode = (bytes: Uint8Array): { value: RlpInput; rest: Uint8Array } => {
	const prefix = bytes[0] ?? 0;

	if (prefix < 0x80) {
		return { value: bytes.slice(0, 1), rest: bytes.slice(1) };
	}

	if (prefix < 0xb8) {
		const length = prefix - 0x80;

		return { value: bytes.slice(1, 1 + length), rest: bytes.slice(1 + length) };
	}

	if (prefix < 0xc0) {
		const lengthOfLength = prefix - 0xb7;
		const length = Number(BigInt(`0x${bytesToHex(bytes.slice(1, 1 + lengthOfLength))}`));

		return {
			value: bytes.slice(1 + lengthOfLength, 1 + lengthOfLength + length),
			rest: bytes.slice(1 + lengthOfLength + length)
		};
	}

	const listLength =
		prefix < 0xf8
			? prefix - 0xc0
			: Number(BigInt(`0x${bytesToHex(bytes.slice(1, 1 + prefix - 0xf7))}`));
	const headerSize = prefix < 0xf8 ? 1 : 1 + prefix - 0xf7;
	let payload: Uint8Array = bytes.slice(headerSize, headerSize + listLength);
	const items: RlpInput[] = [];

	while (payload.length > 0) {
		const { value, rest } = rlpDecode(payload);

		items.push(value);
		payload = rest;
	}

	return { value: items, rest: bytes.slice(headerSize + listLength) };
};

describe('signEip1559Tx', () => {
	const tx = {
		chainId: BigInt(1),
		nonce: BigInt(7),
		maxPriorityFeePerGas: BigInt(1_000_000_000),
		maxFeePerGas: BigInt(30_000_000_000),
		gasLimit: BigInt(21_000),
		to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
		value: BigInt(123_456_789),
		data: ''
	};

	test('produces a type-2 envelope whose signature recovers the signer', () => {
		const raw = signEip1559Tx({ tx, privateKey: PRIVATE_KEY_ONE });

		expect(raw.startsWith('0x02')).toBe(true);

		const decoded = rlpDecode(hexToBytes(raw.slice(4))).value;

		if (!Array.isArray(decoded)) {
			throw new Error('signed tx did not decode to a list');
		}

		expect(decoded).toHaveLength(12);

		const [chainId, nonce, , , gasLimit, to, value, data, accessList, yParity, r, s] = decoded as [
			Uint8Array,
			Uint8Array,
			Uint8Array,
			Uint8Array,
			Uint8Array,
			Uint8Array,
			Uint8Array,
			Uint8Array,
			RlpInput[],
			Uint8Array,
			Uint8Array,
			Uint8Array
		];

		expect(bytesToHex(chainId)).toBe('01');
		expect(bytesToHex(nonce)).toBe('07');
		expect(bytesToHex(gasLimit)).toBe('5208');
		expect(bytesToHex(to)).toBe('27b1fdb04752bbc536007a920d24acb045561c26');
		expect(BigInt(`0x${bytesToHex(value)}`)).toBe(BigInt(123_456_789));
		expect(data).toHaveLength(0);
		expect(accessList).toHaveLength(0);

		// Rebuild the sighash from the decoded unsigned fields and recover.
		const unsigned = decoded.slice(0, 9);
		const sighash = keccak_256(Uint8Array.from([0x02, ...rlpEncode(unsigned)]));
		const recovery = yParity.length === 0 ? 0 : (yParity[0] ?? 0);
		const signature = new secp256k1.Signature(
			BigInt(`0x${bytesToHex(r)}`),
			BigInt(`0x${bytesToHex(s)}`)
		).addRecoveryBit(recovery);
		const recovered = signature.recoverPublicKey(sighash).toBytes(false);
		const recoveredAddress = `0x${bytesToHex(keccak_256(recovered.slice(1)).slice(12))}`;

		expect(recoveredAddress.toLowerCase()).toBe(
			evmAddressFromPrivateKey(PRIVATE_KEY_ONE).toLowerCase()
		);
	});

	// RFC 6979 signing is deterministic, so the exact envelope pins every
	// encoding step: any drift in RLP or sighash bytes changes this string.
	test('pins the signed envelope bytes', () => {
		expect(signEip1559Tx({ tx, privateKey: PRIVATE_KEY_ONE })).toBe(
			'0x02f86f0107843b9aca008506fc23ac008252089427b1fdb04752bbc536007a920d24acb045561c2684075bcd1580c080a0ea245284efa0c4cf3be3893fa8ea718b480f4ba2f7aa3cf883496c649deee7c1a049ab5cbda17bb44eb7cb56df39968691f44522bd24e10d990c8b01750a056ab2'
		);
	});
});
