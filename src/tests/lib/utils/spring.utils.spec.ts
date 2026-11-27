import {
	isSpringAtRest,
	projectMomentum,
	pushVelocitySample,
	rubberBand,
	Spring,
	springCoefficients,
	stepSpring,
	velocityOf,
	type SpringState
} from '#lib/utils/spring.utils.ts';
import {
	createFrameScheduler,
	TEST_FRAME_MS
} from '#root/src/tests/utils/frame-scheduler.test-utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const FRAME_MS = TEST_FRAME_MS;
const createScheduler = createFrameScheduler;

const simulate = ({
	damping,
	seconds,
	onStep
}: {
	damping: number;
	seconds: number;
	onStep?: (state: SpringState) => void;
}): SpringState => {
	const coefficients = springCoefficients({ response: 0.4, damping });
	let state: SpringState = { value: 0, velocity: 0 };

	for (let t = 0; t < seconds; t += FRAME_MS / 1000) {
		state = stepSpring({ state, target: 100, coefficients, dt_s: FRAME_MS / 1000 });
		onStep?.(state);
	}

	return state;
};

describe('spring.utils', () => {
	describe('springCoefficients', () => {
		it('derives stiffness and friction from response and damping', () => {
			const omega = (2 * Math.PI) / 0.5;

			assert.deepEqual(springCoefficients({ response: 0.5, damping: 0.8 }), {
				stiffness: omega * omega,
				friction: 2 * 0.8 * omega
			});
		});

		it('gets stiffer as the response shortens', () => {
			const fast = springCoefficients({ response: 0.2, damping: 1 });
			const slow = springCoefficients({ response: 0.8, damping: 1 });

			assert.ok(fast.stiffness > slow.stiffness);
		});
	});

	describe('stepSpring', () => {
		it('reaches the target without overshoot when critically damped', () => {
			let peak = 0;
			const end = simulate({
				damping: 1,
				seconds: 2,
				onStep: ({ value }) => (peak = Math.max(peak, value))
			});

			assert.ok(Math.abs(end.value - 100) < 0.01);
			assert.ok(peak <= 100.001, `overshot to ${peak}`);
		});

		it('overshoots when underdamped, then still settles', () => {
			let peak = 0;
			const end = simulate({
				damping: 0.5,
				seconds: 4,
				onStep: ({ value }) => (peak = Math.max(peak, value))
			});

			assert.ok(peak > 105, `expected a bounce, peaked at ${peak}`);
			assert.ok(Math.abs(end.value - 100) < 0.05);
		});

		it('stays stable across a long frame on a stiff spring', () => {
			const coefficients = springCoefficients({ response: 0.1, damping: 1 });
			let state: SpringState = { value: 0, velocity: 0 };

			for (let i = 0; i < 60; i++) {
				state = stepSpring({ state, target: 100, coefficients, dt_s: 0.032 });
				assert.ok(Number.isFinite(state.value) && Math.abs(state.value) < 1000);
			}

			assert.ok(Math.abs(state.value - 100) < 0.01);
		});

		it('carries an initial velocity', () => {
			const coefficients = springCoefficients({ response: 0.4, damping: 1 });
			const pushed = stepSpring({
				state: { value: 0, velocity: 2000 },
				target: 0,
				coefficients,
				dt_s: 0.016
			});

			assert.ok(pushed.value > 0);
		});
	});

	describe('isSpringAtRest', () => {
		it('needs both the value and the velocity to be near rest', () => {
			assert.equal(isSpringAtRest({ state: { value: 10.01, velocity: 0.1 }, target: 10 }), true);
			assert.equal(isSpringAtRest({ state: { value: 10.01, velocity: 5 }, target: 10 }), false);
			assert.equal(isSpringAtRest({ state: { value: 11, velocity: 0 }, target: 10 }), false);
		});
	});

	describe('projectMomentum', () => {
		it('projects further for a faster release, in the direction of travel', () => {
			const slow = projectMomentum({ velocity: 300 });
			const fast = projectMomentum({ velocity: 1500 });

			assert.ok(fast > slow && slow > 0);
			assert.equal(projectMomentum({ velocity: -1500 }), -fast);
			assert.equal(projectMomentum({ velocity: 0 }), 0);
		});

		it('matches the closed form of exponential decay', () => {
			assert.ok(Math.abs(projectMomentum({ velocity: 1000 }) - 499) < 1e-9);
			assert.ok(Math.abs(projectMomentum({ velocity: 1000, deceleration: 0.99 }) - 99) < 1e-9);
		});
	});

	describe('rubberBand', () => {
		it('moves less than the overshoot and never past the dimension', () => {
			const near = rubberBand({ over: 50, dimension: 400 });
			const far = rubberBand({ over: 5000, dimension: 400 });

			assert.ok(near > 0 && near < 50);
			assert.ok(far > near && far < 400);
		});

		it('is zero at the limit', () => {
			assert.equal(rubberBand({ over: 0, dimension: 400 }), 0);
		});
	});

	describe('velocity tracking', () => {
		it('reads zero from fewer than two samples', () => {
			assert.deepEqual(velocityOf([]), { x: 0, y: 0 });
			assert.deepEqual(velocityOf([{ x: 5, y: 5, at_ms: 0 }]), { x: 0, y: 0 });
		});

		it('measures px per second across the window', () => {
			const samples = [
				{ x: 0, y: 0, at_ms: 0 },
				{ x: 30, y: -15, at_ms: 30 }
			];

			assert.deepEqual(velocityOf(samples), { x: 1000, y: -500 });
		});

		it('drops samples older than the window, keeping at least one', () => {
			let samples = pushVelocitySample({ samples: [], sample: { x: 0, y: 0, at_ms: 0 } });
			samples = pushVelocitySample({ samples, sample: { x: 10, y: 0, at_ms: 40 } });
			samples = pushVelocitySample({ samples, sample: { x: 20, y: 0, at_ms: 120 } });

			assert.deepEqual(
				samples.map(({ at_ms }) => at_ms),
				[40, 120]
			);

			samples = pushVelocitySample({ samples, sample: { x: 30, y: 0, at_ms: 1000 } });

			assert.deepEqual(
				samples.map(({ at_ms }) => at_ms),
				[1000]
			);
		});

		it('does not mutate the samples it is given', () => {
			const samples = [{ x: 0, y: 0, at_ms: 0 }];
			pushVelocitySample({ samples, sample: { x: 1, y: 1, at_ms: 500 } });

			assert.equal(samples.length, 1);
		});
	});

	describe('Spring', () => {
		it('animates to its target, reporting every frame and stopping at rest', () => {
			const { scheduler, run, pendingCount } = createScheduler();
			const spring = new Spring({ scheduler });
			const seen: number[] = [];
			spring.onUpdate = (value) => seen.push(value);

			spring.to({ target: 100 });
			assert.equal(spring.running, true);

			const frames = run();

			assert.ok(frames > 5 && frames < 2000);
			assert.equal(spring.value, 100);
			assert.equal(spring.velocity, 0);
			assert.equal(spring.running, false);
			assert.equal(pendingCount(), 0);
			assert.equal(seen[seen.length - 1], 100);
			assert.ok(seen.every((value, i) => i === 0 || value >= seen[i - 1] - 1e-9));
		});

		it('schedules a single frame loop however often it is retargeted', () => {
			const { scheduler, pendingCount } = createScheduler();
			const spring = new Spring({ scheduler });

			spring.to({ target: 100 });
			spring.to({ target: 50 });
			spring.to({ target: -20 });

			assert.equal(pendingCount(), 1);
			assert.equal(spring.target, -20);
		});

		it('keeps its velocity across a retarget mid-flight', () => {
			const { scheduler, frame } = createScheduler();
			const spring = new Spring({ scheduler });

			spring.to({ target: 100 });
			frame();
			frame();
			frame();

			const { velocity } = spring;
			assert.ok(velocity > 0);

			spring.to({ target: 0 });
			assert.equal(spring.velocity, velocity);
		});

		it('seeds the release velocity when given one', () => {
			const { scheduler, frame } = createScheduler();
			const spring = new Spring({ scheduler });

			spring.to({ target: 0, velocity: 3000 });
			frame();

			assert.ok(spring.value > 0, 'the value follows the seeded velocity first');
		});

		it('jumps instantly and reports it', () => {
			const { scheduler } = createScheduler();
			const spring = new Spring({ scheduler });
			let reported: number | undefined;
			spring.onUpdate = (value) => (reported = value);

			spring.jump(42);

			assert.equal(spring.value, 42);
			assert.equal(spring.target, 42);
			assert.equal(spring.velocity, 0);
			assert.equal(reported, 42);
		});

		it('freezes in place on stop', () => {
			const { scheduler, frame, pendingCount } = createScheduler();
			const spring = new Spring({ scheduler });

			spring.to({ target: 100 });
			frame();
			frame();
			spring.stop();

			assert.equal(pendingCount(), 0);
			assert.equal(spring.running, false);
			assert.equal(spring.target, spring.value);
			assert.equal(spring.velocity, 0);
			assert.ok(spring.value > 0 && spring.value < 100);
		});

		it('bounces past the target when underdamped', () => {
			const { scheduler, run } = createScheduler();
			const spring = new Spring({ scheduler, response: 0.42, damping: 0.5 });
			let peak = 0;
			spring.onUpdate = (value) => (peak = Math.max(peak, value));

			spring.to({ target: 100 });
			run();

			assert.ok(peak > 105);
			assert.equal(spring.value, 100);
		});

		it('takes new parameters from configure', () => {
			const settleFrames = (response: number): number => {
				const { scheduler, run } = createScheduler();
				const spring = new Spring({ scheduler });
				spring.configure({ response, damping: 1 }).to({ target: 100 });

				return run();
			};

			assert.ok(settleFrames(0.2) < settleFrames(0.9));
		});
	});
});
