// Validated environment. In production DATABASE_URL and SESSION_SECRET are
// required and the process refuses to boot without them; everything else is
// optional. In dev every var carries a local default so `bun dev` works with
// just the docker-compose Postgres.
//
// Optional integrations added by later phases (email, object storage, chain
// adapters) follow a two-mode degrade: when unconfigured they log or stub
// (email prints to the console, storage falls back to local disk in dev)
// instead of crashing, each exposed via an `enabled` getter on its own group.
// See backend/README.md for the full table.

export type EnvSource = Record<string, string | undefined>;

export interface GoogleEnv {
	enabled: boolean;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}

export interface AppleEnv {
	enabled: boolean;
	clientId: string;
	teamId: string;
	keyId: string;
	privateKey: string;
	redirectUri: string;
}

export interface EmailEnv {
	resendApiKey: string;
	from: string;
}

export interface IcEnv {
	host: string;
	clearingCanisterId: string;
	registryCanisterId: string;
	/** The VXP ledger's index: the transfer history payout recovery reads. */
	vxpIndexCanisterId: string;
}

export interface EvmEnv {
	enabled: boolean;
	rpcUrl: string;
	chainId: number;
	confirmations: number;
}

export interface SolEnv {
	enabled: boolean;
	rpcUrl: string;
	commitment: string;
}

export interface BtcEnv {
	enabled: boolean;
	esploraUrl: string;
	network: 'mainnet' | 'testnet' | 'regtest';
	confirmations: number;
}

export interface S3Env {
	enabled: boolean;
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
}

export interface Env {
	isProd: boolean;
	port: number;
	databaseUrl: string;
	publicAppUrl: string;
	apiBaseUrl: string;
	sessionSecret: string;
	sessionTtlHours: number;
	cookieDomain: string;
	logLevel: string;
	workerPollIntervalMs: number;
	google: GoogleEnv;
	apple: AppleEnv;
	email: EmailEnv;
	rootSecret: string;
	treasuryPem: string;
	adminPem: string;
	/** Record-only mode for the VXP economy: awards are recorded but no
	 * ledger transfer fires (parallel-run safety before cutover). */
	vxpTreasuryDisabled: boolean;
	/** Comma-separated `symbol` or `chain:symbol` allowlist; null means the
	 * default (every ic asset enabled, other chains disabled). */
	custodyEnabledAssets: string[] | null;
	ic: IcEnv;
	evm: EvmEnv;
	sol: SolEnv;
	btc: BtcEnv;
	s3: S3Env;
}

/** Build a validated env object from a raw source. Exported separately from
 * the singleton so tests can exercise the validation rules directly. */
export const loadEnv = (source: EnvSource): Env => {
	const isProd = source.NODE_ENV === 'production';

	const optional = (name: string, fallback: string): string => {
		const value = source[name] ?? '';

		return value === '' ? fallback : value;
	};

	/** Required in production (fail fast at boot); dev falls back. */
	const requiredInProd = (name: string, devFallback: string): string => {
		const value = source[name] ?? '';

		if (value !== '') {
			return value;
		}

		if (isProd) {
			throw new Error(`Missing required env var: ${name}`);
		}

		return devFallback;
	};

	const positiveInt = (name: string, fallback: string): number => {
		const value = Number(optional(name, fallback));

		if (!Number.isInteger(value) || value <= 0) {
			throw new Error(`Invalid env var ${name}: expected a positive integer`);
		}

		return value;
	};

	const port = positiveInt('PORT', '8787');

	return {
		isProd,
		port,
		databaseUrl: requiredInProd('DATABASE_URL', 'postgres://vici:vici@localhost:5432/vici'),
		// The public origin of the SPA: drives the credentialed CORS allowlist
		// (and, in later phases, OAuth redirects). Defaults to the Vite dev server.
		publicAppUrl: optional('PUBLIC_APP_URL', 'http://localhost:5173'),
		// Where THIS server is reachable, for building absolute callback URLs.
		apiBaseUrl: optional('API_BASE_URL', `http://localhost:${port}`),
		sessionSecret: requiredInProd('SESSION_SECRET', 'dev-secret-do-not-use-in-prod'),
		sessionTtlHours: positiveInt('SESSION_TTL_HOURS', '720'),
		// Empty means host-only cookies (dev). In prod set the registrable domain
		// so the session rides between the app and api hostnames.
		cookieDomain: optional('COOKIE_DOMAIN', ''),
		logLevel: optional('LOG_LEVEL', 'info'),
		workerPollIntervalMs: positiveInt('WORKER_POLL_INTERVAL_MS', '60000'),
		google: (() => {
			const clientId = optional('GOOGLE_CLIENT_ID', '');
			const clientSecret = optional('GOOGLE_CLIENT_SECRET', '');

			return {
				enabled: clientId !== '' && clientSecret !== '',
				clientId,
				clientSecret,
				redirectUri: optional('GOOGLE_REDIRECT_URI', '')
			};
		})(),
		apple: (() => {
			const clientId = optional('APPLE_CLIENT_ID', '');
			const teamId = optional('APPLE_TEAM_ID', '');
			const keyId = optional('APPLE_KEY_ID', '');
			// The .p8 PKCS#8 private key, PEM text with literal or \n-escaped newlines.
			const privateKey = optional('APPLE_PRIVATE_KEY', '').replace(/\\n/g, '\n');

			return {
				enabled: clientId !== '' && teamId !== '' && keyId !== '' && privateKey !== '',
				clientId,
				teamId,
				keyId,
				privateKey,
				redirectUri: optional('APPLE_REDIRECT_URI', '')
			};
		})(),
		email: {
			resendApiKey: optional('RESEND_API_KEY', ''),
			from: optional('EMAIL_FROM', 'VICI <no-reply@vici.app>')
		},
		// Root of the per-user per-chain key derivation (see src/lib/keys.ts).
		// Rotating it rotates EVERY custodial address, so treat it like a ledger
		// key, not like a session pepper.
		rootSecret: requiredInProd('ROOT_SECRET', 'dev-root-secret-do-not-use-in-prod'),
		// Optional PEM overrides for the service identities; unset falls back to
		// the svc-scoped derivation from ROOT_SECRET.
		treasuryPem: optional('TREASURY_PEM', '').replace(/\\n/g, '\n'),
		adminPem: optional('ADMIN_PEM', '').replace(/\\n/g, '\n'),
		vxpTreasuryDisabled: optional('VXP_TREASURY_DISABLED', '') === '1',
		custodyEnabledAssets: (() => {
			const raw = optional('CUSTODY_ENABLED_ASSETS', '');

			if (raw === '') {
				return null;
			}

			return raw
				.split(',')
				.map((entry) => entry.trim())
				.filter((entry) => entry !== '');
		})(),
		ic: {
			host: optional('IC_HOST', 'https://icp-api.io'),
			clearingCanisterId: optional('CLEARING_CANISTER_ID', 'g2or7-caaaa-aaaaj-qqhoa-cai'),
			registryCanisterId: optional('REGISTRY_CANISTER_ID', 'g5pxl-pyaaa-aaaaj-qqhoq-cai'),
			vxpIndexCanisterId: optional('VXP_INDEX_CANISTER_ID', 'swx4a-oqaaa-aaaam-qidgq-cai')
		},
		evm: (() => {
			const rpcUrl = optional('EVM_RPC_URL', '');

			return {
				enabled: rpcUrl !== '',
				rpcUrl,
				chainId: positiveInt('EVM_CHAIN_ID', '1'),
				confirmations: positiveInt('EVM_CONFIRMATIONS', '12')
			};
		})(),
		sol: (() => {
			const rpcUrl = optional('SOL_RPC_URL', '');

			return {
				enabled: rpcUrl !== '',
				rpcUrl,
				commitment: optional('SOL_COMMITMENT', 'finalized')
			};
		})(),
		// Object storage for uploaded league images: an S3-compatible bucket
		// (Tigris) when configured, local disk under backend/uploads/ otherwise
		// (dev fallback). The S3_* names win over the AWS_* aliases the Tigris
		// Fly integration injects.
		s3: (() => {
			const endpoint = optional('S3_ENDPOINT', optional('AWS_ENDPOINT_URL_S3', ''));
			const bucket = optional('S3_BUCKET', optional('BUCKET_NAME', ''));
			const accessKeyId = optional('S3_ACCESS_KEY_ID', optional('AWS_ACCESS_KEY_ID', ''));
			const secretAccessKey = optional(
				'S3_SECRET_ACCESS_KEY',
				optional('AWS_SECRET_ACCESS_KEY', '')
			);

			return {
				enabled: endpoint !== '' && bucket !== '' && accessKeyId !== '' && secretAccessKey !== '',
				endpoint,
				bucket,
				accessKeyId,
				secretAccessKey
			};
		})(),
		btc: (() => {
			const esploraUrl = optional('BTC_ESPLORA_URL', '');
			const network = optional('BTC_NETWORK', 'mainnet');

			if (network !== 'mainnet' && network !== 'testnet' && network !== 'regtest') {
				throw new Error('Invalid env var BTC_NETWORK: expected mainnet, testnet or regtest');
			}

			return {
				enabled: esploraUrl !== '',
				esploraUrl,
				network,
				confirmations: positiveInt('BTC_CONFIRMATIONS', '2')
			};
		})()
	};
};

export const env = loadEnv(process.env);
