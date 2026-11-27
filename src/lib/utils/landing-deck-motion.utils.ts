import type { LandingDeckSide } from '#lib/types/landing.ts';
import {
	DECK_VERTICAL_FOLLOW,
	deckCardFrame,
	deckDragX,
	isDeckFlip3d,
	resolveDeckRelease,
	type DeckArm,
	type DeckCardFrame,
	type DeckRelease,
	type DeckViewport
} from '#lib/utils/landing-deck.utils.ts';
import {
	pushVelocitySample,
	Spring,
	velocityOf,
	type FrameScheduler,
	type VelocitySample
} from '#lib/utils/spring.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/** Which stamp a card that has left the deck carries with it. */
export type DeckExit = LandingDeckSide | 'pass';

/** The discrete state a card's markup follows (classes, not per-frame styles). */
export interface DeckCardFace {
	/** The visitor asked for the back; the turn may still be in flight. */
	flipped: boolean;
	/** The back is the side facing the visitor right now. */
	back: boolean;
	/** The card turns over in 3D instead of revealing the back in place. */
	flip3d: boolean;
	held: boolean;
	exit: DeckExit | undefined;
}

export type DeckPointerRelease = DeckRelease | { kind: 'tap' };

interface PointerPoint {
	x: number;
	y: number;
	at_ms: number;
}

const DRAG_SPRING = { response: 0.42, damping: 1 };
const FLIP_SPRING = { response: 0.55, damping: 0.86 };
const THROW_SPRING = { response: 0.5, damping: 1 };
const DEFAULT_THROW_VELOCITY = 1600;
// Past the screen edge plus the card's own tilt, so no corner is left in view.
const THROW_OVERSHOOT_PX = 240;
const THROW_DROP_PX = 50;
// A press that travels less than this is a tap, not the start of a drag.
const DRAG_SLOP_PX = 8;
const FLIP_BACK_DEG = 180;

/**
 * Motion of one deck card: three springs (sideways, vertical, turn) and the
 * press / drag / release bookkeeping that feeds them. It owns no element:
 * every frame goes to `onFrame`, every discrete change to `onFace`, so the
 * component only paints and this stays testable without a display.
 *
 * Each card has its own instance, which is why nothing locks input: the next
 * card is live the moment this one is thrown.
 */
export class LandingDeckCardMotion {
	onFrame: ((frame: DeckCardFrame) => void) | undefined;
	onFace: ((face: DeckCardFace) => void) | undefined;
	/** A stamp arms or disarms while the card is held. */
	onArm: ((arm: DeckArm) => void) | undefined;

	readonly #x: Spring;
	readonly #y: Spring;
	readonly #flip: Spring;
	readonly #viewport: () => DeckViewport;
	readonly #reducedMotion: () => boolean;

	#face: DeckCardFace = {
		flipped: false,
		back: false,
		flip3d: false,
		held: false,
		exit: undefined
	};
	#arm: DeckArm;
	#samples: VelocitySample[] = [];
	#grab = { x: 0, y: 0 };
	#rawY = 0;
	#moved = false;

	constructor({
		viewport,
		reducedMotion,
		scheduler
	}: {
		viewport: () => DeckViewport;
		reducedMotion: () => boolean;
		scheduler?: FrameScheduler;
	}) {
		this.#viewport = viewport;
		this.#reducedMotion = reducedMotion;
		this.#x = new Spring({ ...DRAG_SPRING, scheduler });
		this.#y = new Spring({ ...DRAG_SPRING, scheduler });
		this.#flip = new Spring({ ...FLIP_SPRING, scheduler });

		const draw = (): void => this.draw();
		this.#x.onUpdate = draw;
		this.#y.onUpdate = draw;
		this.#flip.onUpdate = draw;
	}

	get face(): DeckCardFace {
		return this.#face;
	}

	get gone(): boolean {
		return nonNullish(this.#face.exit);
	}

	get x(): number {
		return this.#x.value;
	}

	draw(): void {
		const frame = deckCardFrame({
			x: this.#x.value,
			y: this.#y.value,
			flipDeg: this.#flip.value,
			viewport: this.#viewport()
		});

		if (this.#face.flip3d) {
			this.#setFace({ back: this.#flip.value > FLIP_BACK_DEG / 2 });
		}

		// A card that has left keeps the stamp it left with; its travel no
		// longer says anything about a call.
		if (this.gone) {
			this.onFrame?.({ ...frame, ...this.#exitStamps(), arm: undefined, progress: 1 });

			return;
		}

		if (frame.arm !== this.#arm) {
			this.#arm = frame.arm;

			if (this.#face.held) {
				this.onArm?.(frame.arm);
			}
		}

		this.onFrame?.(frame);
	}

	/** Finger down: take the card from wherever its springs have it. */
	press(point: PointerPoint): void {
		if (this.gone) {
			return;
		}

		this.#x.stop();
		this.#y.stop();
		// Grab offset: the card stays under the finger at the point it was
		// caught, instead of jumping its centre to the pointer.
		this.#grab = {
			x: point.x - this.#x.value,
			y: point.y - this.#y.value / DECK_VERTICAL_FOLLOW
		};
		this.#rawY = 0;
		this.#moved = false;
		this.#samples = [{ x: point.x, y: point.y, at_ms: point.at_ms }];
		this.#setFace({ held: true });
	}

	drag(point: PointerPoint): void {
		if (!this.#face.held || this.gone) {
			return;
		}

		const rawX = point.x - this.#grab.x;
		const rawY = point.y - this.#grab.y;

		if (!this.#moved && Math.abs(rawX) + Math.abs(rawY) < DRAG_SLOP_PX) {
			return;
		}

		this.#moved = true;
		this.setFlip(false);
		this.#samples = pushVelocitySample({ samples: this.#samples, sample: point });
		this.#rawY = rawY;
		this.#x.jump(deckDragX({ rawX, width: this.#viewport().width }));
		this.#y.jump(rawY * DECK_VERTICAL_FOLLOW);
	}

	/**
	 * Finger up. Returns what the gesture resolved to, for the deck to act on
	 * (a call and a pass change deck state; this only moves the card), or
	 * `undefined` when there was no press to release.
	 */
	release(): DeckPointerRelease | undefined {
		if (!this.#face.held) {
			return;
		}

		this.#setFace({ held: false });

		if (this.gone) {
			return;
		}

		if (!this.#moved) {
			this.settle();

			return { kind: 'tap' };
		}

		const release = resolveDeckRelease({
			x: this.#x.value,
			rawY: this.#rawY,
			velocity: velocityOf(this.#samples),
			viewport: this.#viewport()
		});

		if (release.kind === 'snap') {
			this.settle(release);
		}

		return release;
	}

	/** Return to rest, carrying the release velocity when there is one. */
	settle(release?: Extract<DeckRelease, { kind: 'snap' }>): void {
		if (this.#reducedMotion()) {
			this.#x.stop().jump(0);
			this.#y.stop().jump(0);

			return;
		}

		const spring = { response: DRAG_SPRING.response, damping: release?.damping ?? 1 };
		this.#x.configure(spring).to({ target: 0, velocity: release?.velocity.x });
		this.#y.configure(spring).to({ target: 0, velocity: release?.velocity.y });
	}

	/** Ease toward an offset: the attract demo and the idle nudge. */
	lean({
		x,
		y,
		response,
		damping = 1
	}: {
		x: number;
		y: number;
		response: number;
		damping?: number;
	}): void {
		if (this.gone || this.#face.held) {
			return;
		}

		this.#x.configure({ response, damping }).to({ target: x });
		this.#y.configure({ response, damping }).to({ target: y });
	}

	setFlip(on: boolean): void {
		if (this.gone || this.#face.flipped === on) {
			return;
		}

		const flip3d =
			this.#face.flip3d ||
			isDeckFlip3d({ width: this.#viewport().width, reducedMotion: this.#reducedMotion() });

		if (flip3d) {
			this.#setFace({ flipped: on, flip3d: true });
			this.#flip.configure(FLIP_SPRING).to({ target: on ? FLIP_BACK_DEG : 0 });

			return;
		}

		this.#setFace({ flipped: on, back: on });
	}

	toggleFlip(): void {
		this.setFlip(!this.#face.flipped);
	}

	/**
	 * The card leaves with its stamp. `fly: false` freezes it where it is, for
	 * a card that is handed over instead of thrown, and under reduced motion,
	 * where it fades in place.
	 */
	exit({ exit, velocity, fly = true }: { exit: DeckExit; velocity?: number; fly?: boolean }): void {
		if (this.gone) {
			return;
		}

		this.setFlip(false);
		this.#setFace({ exit, held: false });

		if (!fly || this.#reducedMotion()) {
			this.stop();
			this.draw();

			return;
		}

		const { width, height } = this.#viewport();

		if (exit === 'pass') {
			this.#y.configure(THROW_SPRING).to({
				target: -(height * 1.1 + THROW_OVERSHOOT_PX),
				velocity: velocity ?? -DEFAULT_THROW_VELOCITY
			});
			this.#x.configure(THROW_SPRING).to({ target: this.#x.value });

			return;
		}

		const direction = exit === 'yes' ? 1 : -1;
		this.#x.configure(THROW_SPRING).to({
			target: direction * (width * 1.2 + THROW_OVERSHOOT_PX),
			velocity: velocity ?? direction * DEFAULT_THROW_VELOCITY
		});
		this.#y.configure(THROW_SPRING).to({ target: this.#y.value + THROW_DROP_PX });
	}

	stop(): void {
		this.#x.stop();
		this.#y.stop();
		this.#flip.stop();
	}

	#exitStamps(): Pick<DeckCardFrame, 'yesOpacity' | 'noOpacity' | 'passOpacity'> {
		const { exit } = this.#face;

		return {
			yesOpacity: exit === 'yes' ? 1 : 0,
			noOpacity: exit === 'no' ? 1 : 0,
			passOpacity: exit === 'pass' ? 1 : 0
		};
	}

	#setFace(patch: Partial<DeckCardFace>): void {
		const next = { ...this.#face, ...patch };
		const keys = Object.keys(patch) as (keyof DeckCardFace)[];

		if (keys.every((key) => next[key] === this.#face[key])) {
			return;
		}

		this.#face = next;

		if (isNullish(this.onFace)) {
			return;
		}

		this.onFace(next);
	}
}
