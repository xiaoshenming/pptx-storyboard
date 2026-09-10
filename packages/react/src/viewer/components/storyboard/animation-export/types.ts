import type { ElementAnimationState, TimelineClickGroup } from 'pptx-viewer-shared';

export interface AnimationExportClockSpec {
	readonly originMs: number;
	readonly framesPerSecond: number;
	readonly frameDurationMs: number;
}

export interface AnimationFrameSample {
	readonly frameIndex: number;
	readonly atMs: number;
	readonly elapsedMs: number;
	readonly boundary: 'start' | 'frame' | 'settle';
}

export interface CompiledAnimationClickGroup {
	readonly index: number;
	readonly group: TimelineClickGroup;
	readonly startAtMs: number;
	readonly settleAtMs: number;
	readonly sampleTimesMs: readonly number[];
	readonly samples: readonly AnimationFrameSample[];
	readonly stateBefore: ReadonlyMap<string, ElementAnimationState>;
	readonly activeState: ReadonlyMap<string, ElementAnimationState>;
	readonly settledState: ReadonlyMap<string, ElementAnimationState>;
}

export interface CompiledSlideAnimationExport {
	readonly slideId: string;
	readonly initialState: ReadonlyMap<string, ElementAnimationState>;
	readonly clickGroups: readonly CompiledAnimationClickGroup[];
	readonly keyframesCss: string;
	readonly clock: AnimationExportClockSpec;
	readonly frameSampleTimesMs: readonly number[];
	readonly durationMs: number;
}

export interface CompileSlideAnimationOptions {
	readonly framesPerSecond?: number;
	readonly originMs?: number;
}
