import type { AnimationExportClockSpec, AnimationFrameSample } from './types';

export const DEFAULT_ANIMATION_EXPORT_FPS = 30;

function finiteNonNegative(value: number, label: string): number {
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${label} must be a finite non-negative number`);
	}
	return value;
}

export class FixedLogicalClock {
	public readonly spec: AnimationExportClockSpec;
	private frame = 0;

	public constructor(framesPerSecond = DEFAULT_ANIMATION_EXPORT_FPS, originMs = 0) {
		if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) {
			throw new RangeError('framesPerSecond must be a positive finite number');
		}
		this.spec = Object.freeze({
			originMs: finiteNonNegative(originMs, 'originMs'),
			framesPerSecond,
			frameDurationMs: 1000 / framesPerSecond,
		});
	}

	public get frameIndex(): number {
		return this.frame;
	}

	public get nowMs(): number {
		return this.timeAtFrame(this.frame);
	}

	public timeAtFrame(frameIndex: number): number {
		if (!Number.isInteger(frameIndex) || frameIndex < 0) {
			throw new RangeError('frameIndex must be a non-negative integer');
		}
		return this.spec.originMs + (frameIndex * 1000) / this.spec.framesPerSecond;
	}

	public seekFrame(frameIndex: number): number {
		const atMs = this.timeAtFrame(frameIndex);
		this.frame = frameIndex;
		return atMs;
	}

	public tick(frameCount = 1): number {
		if (!Number.isInteger(frameCount) || frameCount < 0) {
			throw new RangeError('frameCount must be a non-negative integer');
		}
		this.frame += frameCount;
		return this.nowMs;
	}
}

export function sampleAnimationWindow(
	clock: AnimationExportClockSpec,
	startAtMs: number,
	settleAtMs: number,
): AnimationFrameSample[] {
	finiteNonNegative(startAtMs, 'startAtMs');
	finiteNonNegative(settleAtMs, 'settleAtMs');
	if (settleAtMs < startAtMs) {
		throw new RangeError('settleAtMs must not precede startAtMs');
	}

	const epsilon = 1e-7;
	const firstFrame = Math.ceil(
		((startAtMs - clock.originMs) * clock.framesPerSecond) / 1000 - epsilon,
	);
	const lastFrame = Math.floor(
		((settleAtMs - clock.originMs) * clock.framesPerSecond) / 1000 + epsilon,
	);
	const byTime = new Map<number, AnimationFrameSample>();
	const add = (atMs: number, frameIndex: number, boundary: AnimationFrameSample['boundary']) => {
		byTime.set(atMs, { frameIndex, atMs, elapsedMs: atMs - startAtMs, boundary });
	};

	add(startAtMs, Math.max(0, firstFrame), 'start');
	for (let index = Math.max(0, firstFrame); index <= lastFrame; index++) {
		const atMs = clock.originMs + (index * 1000) / clock.framesPerSecond;
		if (atMs > startAtMs + epsilon && atMs < settleAtMs - epsilon) {
			add(atMs, index, 'frame');
		}
	}
	if (settleAtMs > startAtMs) {
		add(settleAtMs, Math.max(0, lastFrame), 'settle');
	}
	return [...byTime.values()].sort((left, right) => left.atMs - right.atMs);
}
