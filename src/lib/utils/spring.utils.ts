import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Spring motion for anything a finger can grab. Parameterised by `response`
 * (seconds one undamped oscillation would take) and `damping` (1 = critically
 * damped, below 1 overshoots), which read as "how fast" and "how bouncy"
 * instead of raw stiffness / friction. A spring is per-axis, interruptible at
 * any frame and carries its velocity across a retarget, so a release can hand
 * the gesture's own speed to the animation.
 */

export interface SpringParams {
	response: number;
	damping: number;
}

export interface SpringCoefficients {
	stiffness: number;
	friction: number;
}

export interface SpringState {
	value: number;
	velocity: number;
}

export interface Velocity2d {
	x: number;
	y: number;
}

export interface VelocitySample {
	x: number;
	y: number;
	at_ms: number;
}

/** What drives a spring's frames; injectable so specs run without a display. */
export interface FrameScheduler {
	now: () => number;
	request: (callback: (now_ms: number) => void) => number;
	cancel: (handle: number) => void;
}

export const SPRING_DEFAULT_RESPONSE = 0.4;
export const SPRING_DEFAULT_DAMPING = 1;

// Integration is semi-implicit Euler in sub-steps this small: one step per
// frame goes unstable on the stiff, fast springs a thrown card uses.
const MAX_SUBSTEP_S = 0.004;
// A background tab or a long frame must not teleport the value.
const MAX_FRAME_S = 0.032;
const FALLBACK_FRAME_S = 0.016;
const REST_DISTANCE = 0.05;
const REST_VELOCITY = 0.5;

const DEFAULT_DECELERATION = 0.998;
const DEFAULT_RUBBER_COEFFICIENT = 0.55;
const VELOCITY_WINDOW_MS = 90;

export const springCoefficients = ({ response, damping }: SpringParams): SpringCoefficients => {
	const omega = (2 * Math.PI) / response;

	return { stiffness: omega * omega, friction: 2 * damping * omega };
};

/** Advance a spring by `dt_s` seconds toward `target`. */
export const stepSpring = ({
	state,
	target,
	coefficients: { stiffness, friction },
	dt_s
}: {
	state: SpringState;
	target: number;
	coefficients: SpringCoefficients;
	dt_s: number;
}): SpringState => {
	const steps = Math.max(1, Math.ceil(dt_s / MAX_SUBSTEP_S));
	const h = dt_s / steps;
	let { value, velocity } = state;

	for (let i = 0; i < steps; i++) {
		const acceleration = -stiffness * (value - target) - friction * velocity;
		velocity += acceleration * h;
		value += velocity * h;
	}

	return { value, velocity };
};

export const isSpringAtRest = ({
	state,
	target
}: {
	state: SpringState;
	target: number;
}): boolean =>
	Math.abs(state.value - target) < REST_DISTANCE && Math.abs(state.velocity) < REST_VELOCITY;

/**
 * Where a release at `velocity` (px/s) would coast to under exponential
 * decay: the distance still to travel. Deciding a throw on this projected
 * point, rather than on where the finger lifted, is what lets a short fast
 * flick commit.
 */
export const projectMomentum = ({
	velocity,
	deceleration = DEFAULT_DECELERATION
}: {
	velocity: number;
	deceleration?: number;
}): number => ((velocity / 1000) * deceleration) / (1 - deceleration);

/** Resistance past a limit: the further past, the less each pixel moves. */
export const rubberBand = ({
	over,
	dimension,
	coefficient = DEFAULT_RUBBER_COEFFICIENT
}: {
	over: number;
	dimension: number;
	coefficient?: number;
}): number => (over * dimension * coefficient) / (dimension + coefficient * Math.abs(over));

/** Append a pointer sample, keeping only the recent window velocity is read over. */
export const pushVelocitySample = ({
	samples,
	sample
}: {
	samples: readonly VelocitySample[];
	sample: VelocitySample;
}): VelocitySample[] => {
	const next = [...samples, sample];

	while (next.length > 1 && sample.at_ms - next[0].at_ms > VELOCITY_WINDOW_MS) {
		next.shift();
	}

	return next;
};

/** Pointer velocity in px/s across the sampled window. */
export const velocityOf = (samples: readonly VelocitySample[]): Velocity2d => {
	if (samples.length < 2) {
		return { x: 0, y: 0 };
	}

	const [first] = samples;
	const last = samples[samples.length - 1];
	const dt_ms = Math.max(1, last.at_ms - first.at_ms);

	return { x: ((last.x - first.x) / dt_ms) * 1000, y: ((last.y - first.y) / dt_ms) * 1000 };
};

const browserScheduler = (): FrameScheduler => ({
	now: () => performance.now(),
	request: (callback) => requestAnimationFrame(callback),
	cancel: (handle) => cancelAnimationFrame(handle)
});

/**
 * A running spring. `to` retargets (optionally seeding a velocity) and keeps
 * animating from wherever the value is; `jump` places it instantly, for 1:1
 * drag; `stop` freezes it in place. `onUpdate` fires on every frame and once
 * more on settle.
 */
export class Spring {
	value: number;
	velocity = 0;
	target: number;
	onUpdate: ((value: number) => void) | undefined;

	#coefficients: SpringCoefficients;
	#scheduler: FrameScheduler | undefined;
	#frame: number | undefined;
	#last_ms = 0;

	constructor({
		value = 0,
		response = SPRING_DEFAULT_RESPONSE,
		damping = SPRING_DEFAULT_DAMPING,
		scheduler
	}: Partial<SpringParams> & { value?: number; scheduler?: FrameScheduler } = {}) {
		this.value = value;
		this.target = value;
		this.#coefficients = springCoefficients({ response, damping });
		this.#scheduler = scheduler;
	}

	get running(): boolean {
		return nonNullish(this.#frame);
	}

	configure(params: SpringParams): this {
		this.#coefficients = springCoefficients(params);

		return this;
	}

	to({ target, velocity }: { target: number; velocity?: number }): this {
		this.target = target;

		if (nonNullish(velocity)) {
			this.velocity = velocity;
		}

		if (isNullish(this.#frame)) {
			const scheduler = this.#resolveScheduler();
			this.#last_ms = scheduler.now();
			this.#frame = scheduler.request(this.#step);
		}

		return this;
	}

	jump(value: number): this {
		this.value = value;
		this.target = value;
		this.velocity = 0;
		this.onUpdate?.(value);

		return this;
	}

	stop(): this {
		if (nonNullish(this.#frame)) {
			this.#resolveScheduler().cancel(this.#frame);
		}

		this.#frame = undefined;
		this.target = this.value;
		this.velocity = 0;

		return this;
	}

	// Resolved on first use so a spring can be constructed where no display
	// exists yet (module scope, server render).
	#resolveScheduler(): FrameScheduler {
		this.#scheduler ??= browserScheduler();

		return this.#scheduler;
	}

	#step = (now_ms: number): void => {
		const dt_s = Math.min(MAX_FRAME_S, (now_ms - this.#last_ms) / 1000) || FALLBACK_FRAME_S;
		this.#last_ms = now_ms;

		const next = stepSpring({
			state: { value: this.value, velocity: this.velocity },
			target: this.target,
			coefficients: this.#coefficients,
			dt_s
		});

		if (isSpringAtRest({ state: next, target: this.target })) {
			this.value = this.target;
			this.velocity = 0;
			this.#frame = undefined;
			this.onUpdate?.(this.value);

			return;
		}

		this.value = next.value;
		this.velocity = next.velocity;
		this.onUpdate?.(this.value);
		this.#frame = this.#resolveScheduler().request(this.#step);
	};
}
