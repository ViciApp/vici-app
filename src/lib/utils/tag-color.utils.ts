import {
	isMacroId,
	isMicroId,
	macroColor,
	microColor
} from '#lib/constants/market-taxonomy.constants.ts';

// Chip / accent color for a taxonomy category id. Macros carry the brand
// accent; micros inherit their parent macro's hue (the chip's meaning is
// the macro family, not a per-micro colour). These are the *brand* accents
// the UI uses for category chips, tabs, and hover affordances — NOT the
// same as the `hot` highlight inside the generative `flow-art` SVGs
// (`flow-art.utils.ts` PAL), which is palette- and state-dependent and
// intentionally diverges so the chip and the artwork read as two distinct
// moments.
//
// Unknown ids (Layer-3 free tags, legacy strings) fall back to the laurel-
// gold accent so the surface never renders a colourless chip.
const FALLBACK_COLOR = '#E2B842';

export const tagColor = (id: string): string => {
	const value = id.toLowerCase();

	if (isMacroId(value)) {
		return macroColor(value);
	}

	if (isMicroId(value)) {
		return microColor(value);
	}

	return FALLBACK_COLOR;
};
