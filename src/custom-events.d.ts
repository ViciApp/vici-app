declare module 'svelte/elements' {
	// Declaration merging needs Svelte's own type parameter, used or not.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	export interface HTMLAttributes<T> {
		onjunoSignOutAuthTimer?: (event: CustomEvent<undefined>) => void;

		onviciRefreshBalances?: (event: CustomEvent<undefined>) => void;
		onviciRefreshCollaterals?: (event: CustomEvent<undefined>) => void;
		onviciRefreshMarkets?: (event: CustomEvent<undefined>) => void;
		onviciRefreshOrders?: (event: CustomEvent<undefined>) => void;
		onviciRefreshPositions?: (event: CustomEvent<undefined>) => void;
	}
}

export {};
