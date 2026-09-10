import { describe, expect, it } from 'vitest';

import type { StoryboardShot } from './storyboard-model';
import {
	applyNarrationDuration,
	buildStoryboardTimeline,
	reconcileNarrationTiming,
} from './storyboard-timeline-adapter';
import { moveTimelineClip } from './timeline';

function shot(id: string): StoryboardShot {
	return {
		id,
		slideIndex: 0,
		kind: 'static',
		label: id,
		effectLabel: '静态页面',
		durationMs: 5000,
		script: '简短讲稿',
	};
}

function visualStart(
	timeline: ReturnType<typeof buildStoryboardTimeline>,
	sourceId: string,
): number {
	return timeline.tracks
		.find((track) => track.kind === 'visual')!
		.clips.find((clip) => clip.sourceId === sourceId)!.startMs;
}

function clipStart(
	timeline: ReturnType<typeof buildStoryboardTimeline>,
	kind: 'narration' | 'subtitle',
	sourceId: string,
): number {
	return timeline.tracks
		.find((track) => track.kind === kind)!
		.clips.find((clip) => clip.sourceId === sourceId)!.startMs;
}

describe('narration duration ripple', () => {
	it('moves following tracks forward and back without going below the base duration', () => {
		const base = buildStoryboardTimeline([shot('one'), shot('two')]);
		const expanded = applyNarrationDuration(base, 'one', 9000);
		expect(visualStart(expanded, 'two')).toBe(9250);
		const shortened = applyNarrationDuration(expanded, 'one', 2000);
		expect(visualStart(shortened, 'two')).toBe(5000);
	});

	it('makes a moved narration visibly ripple its following shots', () => {
		const base = buildStoryboardTimeline([shot('one'), shot('two')]);
		const moved = moveTimelineClip(base, 'script-one', 7500, { collisionStrategy: 'allow' });
		expect(moved.accepted).toBeTruthy();
		const reconciled = reconcileNarrationTiming(moved.timeline);
		expect(visualStart(reconciled, 'two')).toBe(8889);
		expect(clipStart(reconciled, 'subtitle', 'one')).toBe(7500);
	});

	it('clamps narration before its source shot and keeps subtitles aligned', () => {
		const base = buildStoryboardTimeline([shot('one'), shot('two')]);
		const moved = moveTimelineClip(base, 'script-two', 2000, { collisionStrategy: 'allow' });
		const reconciled = reconcileNarrationTiming(moved.timeline);
		expect(clipStart(reconciled, 'narration', 'two')).toBe(5000);
		expect(clipStart(reconciled, 'subtitle', 'two')).toBe(5000);
	});
});
