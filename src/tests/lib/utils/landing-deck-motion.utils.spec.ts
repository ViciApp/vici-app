import { LandingDeckCardMotion, type DeckCardFace } from '#lib/utils/landing-deck-motion.utils.ts';
import {
	deckStampThreshold,
	type DeckArm,
	type DeckCardFrame
} from '#lib/utils/landing-deck.utils.ts';
import { createFrameScheduler } from '#root/src/tests/utils/frame-scheduler.test-utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const PHONE = { width: 390, height: 760 };
const DESKTOP = { width: 1440, height: 900 };

const setup = ({
	viewport = PHONE,
	reducedMotion = false
}: { viewport?: typeof PHONE; reducedMotion?: boolean } = {}) => {
	const display = createFrameScheduler();
	const motion = new LandingDeckCardMotion({
		viewport: () => viewport,
		reducedMotion: () => reducedMotion,
		scheduler: display.scheduler
	});
	const frames: DeckCardFrame[] = [];
	const faces: DeckCardFace[] = [];
	const arms: DeckArm[] = [];
	motion.onFrame = (frame) => frames.push(frame);
	motion.onFace = (face) => faces.push(face);
	motion.onArm = (arm) => arms.push(arm);

	const last = (): DeckCardFrame => {
		const frame = frames[frames.length - 1];
		assert.ok(frame, 'expected a frame');

		return frame;
	};

	return { motion, frames, faces, arms, last, ...display };
};

/** Press at the centre and drag by (`dx`, `dy`) over `ms`, in 10ms steps. */
const drag = ({
	motion,
	dx,
	dy = 0,
	ms = 200
}: {
	motion: LandingDeckCardMotion;
	dx: number;
	dy?: number;
	ms?: number;
}): void => {
	const steps = Math.max(1, Math.round(ms / 10));
	motion.press({ x: 200, y: 400, at_ms: 0 });

	for (let i = 1; i <= steps; i++) {
		motion.drag({
			x: 200 + (dx * i) / steps,
			y: 400 + (dy * i) / steps,
			at_ms: (ms * i) / steps
		});
	}
};

describe('landing-deck-motion.utils', () => {
	describe('drag', () => {
		it('follows the finger 1:1 sideways and a third of the way vertically', () => {
			const { motion, last } = setup();
			drag({ motion, dx: 60, dy: 30 });

			assert.equal(motion.x, 60);
			assert.equal(last().transform, `translate3d(60px,9px,0) rotate(${(60 / 390) * 14}deg)`);
		});

		it('keeps the grab offset when a moving card is caught', () => {
			const { motion, frame } = setup();
			motion.lean({ x: 200, y: 0, response: 0.4 });

			for (let i = 0; i < 6; i++) {
				frame();
			}

			const caughtAt = motion.x;
			assert.ok(caughtAt > 0 && caughtAt < 200);

			motion.press({ x: 300, y: 400, at_ms: 0 });
			motion.drag({ x: 320, y: 400, at_ms: 10 });

			assert.equal(motion.x, caughtAt + 20);
		});

		it('ignores travel inside the tap slop', () => {
			const { motion, frames } = setup();
			motion.press({ x: 200, y: 400, at_ms: 0 });
			motion.drag({ x: 203, y: 402, at_ms: 10 });

			assert.equal(motion.x, 0);
			assert.equal(frames.length, 0);
		});

		it('reports the arm as a held card crosses the stamp threshold, and back', () => {
			const { motion, arms } = setup();
			const threshold = deckStampThreshold(PHONE.width);

			motion.press({ x: 0, y: 0, at_ms: 0 });
			motion.drag({ x: threshold - 5, y: 0, at_ms: 10 });
			motion.drag({ x: threshold + 5, y: 0, at_ms: 20 });
			motion.drag({ x: threshold - 20, y: 0, at_ms: 30 });
			motion.drag({ x: -threshold - 5, y: 0, at_ms: 40 });

			assert.deepEqual(arms, ['yes', undefined, 'no']);
		});

		it('does nothing without a press', () => {
			const { motion, frames } = setup();
			motion.drag({ x: 300, y: 0, at_ms: 10 });

			assert.equal(frames.length, 0);
			assert.equal(motion.release(), undefined);
		});
	});

	describe('release', () => {
		it('reads a press that did not travel as a tap', () => {
			const { motion } = setup();
			motion.press({ x: 200, y: 400, at_ms: 0 });

			assert.deepEqual(motion.release(), { kind: 'tap' });
			assert.equal(motion.face.held, false);
		});

		it('resolves a drag past the threshold to a call', () => {
			const { motion } = setup();
			drag({ motion, dx: 150, ms: 600 });

			const release = motion.release();

			assert.equal(release?.kind, 'call');
			assert.equal(release?.kind === 'call' && release.side, 'yes');
		});

		it('resolves a short fast flick to a call on its momentum', () => {
			const { motion } = setup();
			drag({ motion, dx: -45, ms: 30 });

			const release = motion.release();

			assert.equal(release?.kind, 'call');
			assert.equal(release?.kind === 'call' && release.side, 'no');
		});

		it('resolves an upward throw to a pass', () => {
			const { motion } = setup();
			drag({ motion, dx: 0, dy: -300, ms: 200 });

			assert.equal(motion.release()?.kind, 'pass');
		});

		it('springs a short drag back to rest', () => {
			const { motion, run, last } = setup();
			drag({ motion, dx: 40, ms: 600 });

			assert.equal(motion.release()?.kind, 'snap');

			run();

			assert.equal(motion.x, 0);
			assert.equal(last().transform, 'translate3d(0px,0px,0) rotate(0deg)');
		});

		it('returns to rest at once under reduced motion', () => {
			const { motion, pendingCount } = setup({ reducedMotion: true });
			drag({ motion, dx: 40, ms: 600 });
			motion.release();

			assert.equal(motion.x, 0);
			assert.equal(pendingCount(), 0);
		});
	});

	describe('flip', () => {
		it('turns over in 3D on a phone, showing the back past the half turn', () => {
			const { motion, faces, frame, run, last } = setup();
			motion.setFlip(true);

			assert.equal(motion.face.flipped, true);
			assert.equal(motion.face.flip3d, true);
			assert.equal(motion.face.back, false);

			let turnedAt = -1;

			for (let i = 0; i < 400 && turnedAt < 0; i++) {
				frame();

				if (motion.face.back) {
					turnedAt = Number(/rotateY\(([\d.]+)deg\)/.exec(last().transform)?.[1]);
				}
			}

			assert.ok(turnedAt > 90);

			run();

			assert.ok(last().transform.endsWith('rotateY(180deg)'));
			assert.ok(faces.length >= 2);
		});

		it('reveals the back in place on a wide screen', () => {
			const { motion, pendingCount } = setup({ viewport: DESKTOP });
			motion.setFlip(true);

			assert.deepEqual(
				[motion.face.flipped, motion.face.back, motion.face.flip3d],
				[true, true, false]
			);
			assert.equal(pendingCount(), 0);
		});

		it('never turns in 3D under reduced motion', () => {
			const { motion } = setup({ reducedMotion: true });
			motion.setFlip(true);

			assert.deepEqual([motion.face.back, motion.face.flip3d], [true, false]);
		});

		it('flips back as soon as the card is dragged', () => {
			const { motion } = setup({ viewport: DESKTOP });
			motion.setFlip(true);
			drag({ motion, dx: 30 });

			assert.equal(motion.face.flipped, false);
			assert.equal(motion.face.back, false);
		});

		it('toggles', () => {
			const { motion } = setup({ viewport: DESKTOP });
			motion.toggleFlip();
			assert.equal(motion.face.flipped, true);
			motion.toggleFlip();
			assert.equal(motion.face.flipped, false);
		});
	});

	describe('exit', () => {
		it('throws a called card off its side with its stamp on', () => {
			const { motion, run, last } = setup();
			motion.exit({ exit: 'yes' });

			assert.equal(motion.gone, true);
			assert.equal(motion.face.exit, 'yes');

			run();

			assert.equal(motion.x, PHONE.width * 1.2 + 240);
			assert.deepEqual(
				[last().yesOpacity, last().noOpacity, last().passOpacity, last().arm],
				[1, 0, 0, undefined]
			);
		});

		it('throws No to the left and a pass upward', () => {
			const no = setup();
			no.motion.exit({ exit: 'no', velocity: -2000 });
			no.run();
			assert.equal(no.motion.x, -(PHONE.width * 1.2 + 240));

			const pass = setup();
			pass.motion.exit({ exit: 'pass' });
			pass.run();
			assert.equal(pass.motion.x, 0);
			assert.ok(pass.last().transform.includes(`,${-(PHONE.height * 1.1 + 240)}px,`));
			assert.equal(pass.last().passOpacity, 1);
		});

		it('holds in place when it is handed over instead of thrown', () => {
			const { motion, pendingCount, last } = setup();
			drag({ motion, dx: 120, ms: 600 });
			motion.release();
			motion.exit({ exit: 'yes', fly: false });

			assert.equal(pendingCount(), 0);
			assert.equal(motion.x, 120);
			assert.equal(last().yesOpacity, 1);
		});

		it('does not fly under reduced motion', () => {
			const { motion, pendingCount } = setup({ reducedMotion: true });
			motion.exit({ exit: 'no' });

			assert.equal(motion.gone, true);
			assert.equal(pendingCount(), 0);
			assert.equal(motion.x, 0);
		});

		it('takes no more input once gone', () => {
			const { motion } = setup();
			motion.exit({ exit: 'yes' });
			const { x } = motion;

			motion.press({ x: 0, y: 0, at_ms: 0 });
			motion.drag({ x: -300, y: 0, at_ms: 10 });
			motion.setFlip(true);
			motion.lean({ x: 0, y: 0, response: 0.4 });
			motion.exit({ exit: 'no' });

			assert.equal(motion.x, x);
			assert.equal(motion.face.exit, 'yes');
			assert.equal(motion.face.flipped, false);
			assert.equal(motion.face.held, false);
		});

		it('flips a turned card back before it leaves', () => {
			const { motion } = setup({ viewport: DESKTOP });
			motion.setFlip(true);
			motion.exit({ exit: 'yes' });

			assert.equal(motion.face.back, false);
		});
	});

	describe('lean', () => {
		it('eases to an offset and back, never arming a call it does not make', () => {
			const { motion, arms, run } = setup();
			motion.lean({ x: 120, y: 16, response: 0.85 });
			run();

			assert.equal(motion.x, 120);
			assert.deepEqual(arms, [], 'an unheld card arms silently');

			motion.lean({ x: 0, y: 0, response: 0.8 });
			run();

			assert.equal(motion.x, 0);
		});

		it('leaves a held card to the finger', () => {
			const { motion, pendingCount } = setup();
			motion.press({ x: 0, y: 0, at_ms: 0 });
			motion.lean({ x: 120, y: 0, response: 0.85 });

			assert.equal(pendingCount(), 0);
		});
	});

	describe('face', () => {
		it('reports a change once, and only when something changed', () => {
			const { motion, faces } = setup({ viewport: DESKTOP });
			motion.setFlip(true);
			motion.setFlip(true);

			assert.equal(faces.length, 1);
		});
	});
});
