import {
	LANDING_FLOAT_EASING,
	LANDING_FLOAT_LAND_FADE_MS,
	LANDING_FLOAT_MISS_FADE_MS,
	LANDING_FLOAT_MS,
	LANDING_FLOAT_TEXT_FADE_MS,
	LANDING_FLOAT_VEIL_FADE_MS
} from '#lib/constants/landing-page.constants.ts';
import { landingFloatLanding } from '#lib/utils/landing-page.utils.ts';
import { isNullish } from '@dfinity/utils';

/**
 * The deck card that floats into Markets: the page copies the card the deck
 * holds, the copy travels over both views and shrinks onto the lead's
 * artwork, then removes itself.
 */

const PICTURE_SELECTOR = 'picture, video, canvas, [data-landing-deck-art]';
const VEIL_SELECTOR = '[data-landing-deck-veil]';

const coverFrame = ({ video, canvas }: { video: HTMLVideoElement; canvas: HTMLCanvasElement }) => {
	const { clientWidth: width, clientHeight: height, videoWidth, videoHeight } = video;
	const scale = Math.max(width / videoWidth, height / videoHeight);
	const [focusX = 50, focusY = 50] = getComputedStyle(video)
		.objectPosition.split(' ')
		.map((value) => Number.parseFloat(value));

	canvas.width = width;
	canvas.height = height;
	canvas
		.getContext('2d')
		?.drawImage(
			video,
			((width - videoWidth * scale) * focusX) / 100,
			((height - videoHeight * scale) * focusY) / 100,
			videoWidth * scale,
			videoHeight * scale
		);
};

// A copied `<video>` starts over with no frame. A clip that was showing is
// replaced by the frame it was on; one that was not gives way to the still.
const freezeClips = ({ source, copy }: { source: HTMLElement; copy: HTMLElement }): void => {
	const playing = [...source.querySelectorAll('video')];

	[...copy.querySelectorAll('video')].forEach((clip, index) => {
		const video = playing[index];

		if (isNullish(video) || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
			clip.remove();

			return;
		}

		const canvas = document.createElement('canvas');

		canvas.className = clip.className;
		canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
		coverFrame({ video, canvas });
		clip.replaceWith(canvas);
	});
};

/**
 * Copy a deck card where it stands and put the copy in `layer`, over the
 * page's views and under its top bar. Call it while the deck still holds the
 * card; hand the result to `landLandingCard`.
 */
export const liftLandingCard = ({
	source,
	layer
}: {
	source: HTMLElement;
	layer: HTMLElement;
}): HTMLElement => {
	const copy = source.cloneNode(true) as HTMLElement;
	const { transform } = getComputedStyle(source);

	freezeClips({ source, copy });

	copy.removeAttribute('data-landing-deck-card');
	copy.setAttribute('aria-hidden', 'true');
	copy.inert = true;
	copy.style.position = 'fixed';
	copy.style.zIndex = '25';
	copy.style.pointerEvents = 'none';
	copy.style.transform = transform === 'none' ? 'translate3d(0, 0, 0)' : transform;

	layer.append(copy);

	return copy;
};

const fadeOut = ({ element, duration }: { element: Element; duration: number }): void => {
	element.animate([{ opacity: getComputedStyle(element).opacity }, { opacity: 0 }], {
		duration,
		easing: 'ease-out',
		fill: 'forwards'
	});
};

/**
 * Carry a lifted card onto `target` (the Markets lead's artwork) and remove
 * it. Without a target the card has nowhere to land: it fades where it is.
 */
export const landLandingCard = ({
	card,
	target
}: {
	card: HTMLElement;
	target: Element | null | undefined;
}): void => {
	if (isNullish(target)) {
		const fade = card.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: LANDING_FLOAT_MISS_FADE_MS,
			fill: 'forwards'
		});

		fade.onfinish = fade.oncancel = () => card.remove();

		return;
	}

	const viewport = { width: window.innerWidth, height: window.innerHeight };
	const { dx, dy, scale, insetY, insetX, radius } = landingFloatLanding({
		viewport,
		target: target.getBoundingClientRect()
	});

	// Only the picture travels: the card's own text leaves first, then the
	// shade that kept it readable.
	[...card.children]
		.filter((layer) => !layer.matches(PICTURE_SELECTOR))
		.forEach((element) =>
			fadeOut({
				element,
				duration: element.matches(VEIL_SELECTOR)
					? LANDING_FLOAT_VEIL_FADE_MS
					: LANDING_FLOAT_TEXT_FADE_MS
			})
		);

	// The last stretch cross-fades into the lead's own artwork, which hides
	// any difference in framing.
	const landAt = 1 - LANDING_FLOAT_LAND_FADE_MS / LANDING_FLOAT_MS;

	target.animate([{ opacity: 0 }, { opacity: 0, offset: landAt }, { opacity: 1 }], {
		duration: LANDING_FLOAT_MS
	});
	card.animate([{ opacity: 1 }, { opacity: 0 }], {
		duration: LANDING_FLOAT_LAND_FADE_MS,
		delay: LANDING_FLOAT_MS - LANDING_FLOAT_LAND_FADE_MS,
		easing: 'ease-in',
		fill: 'forwards'
	});

	const flight = card.animate(
		[
			{ transform: card.style.transform, clipPath: 'inset(0px 0px round 0px)' },
			{
				transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`,
				clipPath: `inset(${insetY}px ${insetX}px round ${radius}px)`
			}
		],
		{ duration: LANDING_FLOAT_MS, easing: LANDING_FLOAT_EASING, fill: 'forwards' }
	);

	flight.onfinish = flight.oncancel = () => card.remove();
};
