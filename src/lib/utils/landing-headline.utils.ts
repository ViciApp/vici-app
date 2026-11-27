// Landing headline accent splitter.
//
// The landing display headline carries its quoted idiom as a
// serif-italic gold accent (the "I knew it" / „lo sapevo" fragment).
// This splits a headline string into three parts around the first
// quoted span so the middle part can render in the accent treatment.
// Locale-agnostic: it recognises the common opening/closing quote
// glyphs across the supported languages.

const QUOTE_OPEN = '“„«"‘‚';
const QUOTE_CLOSE = '”»"’';

interface HeadlineParts {
	/** Text before the quoted idiom. */
	readonly before: string;
	/** The quoted idiom (including its quote glyphs), or `''` if none. */
	readonly accent: string;
	/** Text after the quoted idiom. */
	readonly after: string;
}

/**
 * Split `text` around its first quoted fragment. When no balanced quote
 * pair is found the whole string lands in `before` and `accent`/`after`
 * are empty.
 */
export const splitHeadline = (text: string): HeadlineParts => {
	let open = -1;

	for (let i = 0; i < text.length; i++) {
		if (QUOTE_OPEN.includes(text[i])) {
			open = i;

			break;
		}
	}

	if (open < 0) {
		return { before: text, accent: '', after: '' };
	}

	let close = -1;

	for (let i = open + 1; i < text.length; i++) {
		if (QUOTE_CLOSE.includes(text[i])) {
			close = i;

			break;
		}
	}

	if (close <= open) {
		return { before: text, accent: '', after: '' };
	}

	return {
		before: text.slice(0, open),
		accent: text.slice(open, close + 1),
		after: text.slice(close + 1)
	};
};
