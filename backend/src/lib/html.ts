// Text interpolated into HTML the server writes: an email body, a head
// fragment another server includes in a page.

/** `value` safe inside element text and inside a double- or single-quoted
 * attribute. */
export const escapeHtml = (value: string): string =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
