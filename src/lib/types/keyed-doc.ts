/** A record with the key the stores and lists index it by. */
export interface KeyedDoc<T> {
	key: string;
	data: T;
}
