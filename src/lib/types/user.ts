/** The signed-in account as the app shell holds it: the session's account id
 * is both its key and the `owner` every owned record carries. */
export interface User {
	key: string;
	owner: string;
}
