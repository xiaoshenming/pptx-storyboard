import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import { describe, expect, it } from 'vitest';

import { buildStoryboardAnimationGroups } from './storyboard-animation-groups';
import type { StoryboardAnimationEvent } from './storyboard-animation-groups';
import {
	animationTargetLabel,
	assignAnimationAnchorLabels,
	presetClassLabel,
	triggerLabel,
} from './storyboard-animation-labels';
import type { StoryboardShot } from './storyboard-model';
import {
	applyNarrationDuration,
	buildStoryboardTimeline,
	reconcileNarrationTiming,
} from './storyboard-timeline-adapter';
import { createTimelineModel, moveTimelineClip } from './timeline';
import type { TimelineClip, TimelineTrack } from './timeline';

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

function textElement(id: string, text: string): PptxElement {
	return { id, type: 'text', text } as PptxElement;
}

function slide(overrides: Partial<PptxSlide> = {}): PptxSlide {
	return {
		id: 'slide-1',
		rId: 'rId1',
		slideNumber: 1,
		elements: [textElement('text-1', '勾股定理')],
		...overrides,
	};
}

function animationEvent(
	id: string,
	overrides: Partial<StoryboardAnimationEvent> = {},
): StoryboardAnimationEvent {
	return {
		id,
		targetId: `target-${id}`,
		startOffsetMs: 0,
		durationMs: 500,
		presetClass: 'entr',
		trigger: 'onClick',
		targetLabel: `目标 ${id}`,
		...overrides,
	};
}

function animationShot(
	id: string,
	events: StoryboardAnimationEvent[],
	overrides: Partial<StoryboardShot> = {},
): StoryboardShot {
	return {
		id,
		slideIndex: 0,
		kind: 'animation',
		label: id,
		effectLabel: '进入动画',
		durationMs: 5000,
		script: '',
		animationEvents: events,
		...overrides,
	};
}

function animationClips(timeline: ReturnType<typeof buildStoryboardTimeline>): TimelineClip[] {
	return timeline.tracks.find((track) => track.kind === 'animation')!.clips;
}

function animationClip(id: string, startMs: number): TimelineClip {
	return {
		id,
		trackId: 'track-animation',
		kind: 'animation',
		startMs,
		durationMs: 100,
		metadata: { eventId: id },
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

describe('animation clip metadata', () => {
	it('exposes the full metadata contract on every animation clip', () => {
		const timeline = buildStoryboardTimeline([
			animationShot(
				'grp',
				[
					animationEvent('ev-1', {
						targetId: 'text-1',
						targetLabel: '标题文字',
						startOffsetMs: 0,
						trigger: 'onClick',
					}),
					animationEvent('ev-2', {
						targetId: 'text-2',
						targetLabel: '图表',
						startOffsetMs: 300,
						presetClass: 'emph',
						trigger: 'withPrevious',
					}),
				],
				{ clickGroupIndex: 0 },
			),
			animationShot('grp2', [
				animationEvent('ev-3', {
					targetId: undefined,
					presetClass: 'path',
					trigger: 'afterPrevious',
				}),
			]),
		]);
		const clips = animationClips(timeline);
		expect(clips.map((clip) => clip.id)).toStrictEqual([
			'animation-ev-1',
			'animation-ev-2',
			'animation-ev-3',
		]);
		expect(clips[0]).toMatchObject({
			id: 'animation-ev-1',
			label: '进入动画',
			sourceId: 'grp',
			metadata: {
				eventId: 'ev-1',
				targetId: 'text-1',
				targetLabel: '标题文字',
				presetClass: 'entr',
				effectLabel: '进入动画',
				trigger: 'onClick',
				groupIndex: 0,
				groupLabel: '动画组 1',
			},
		});
		// A shot without clickGroupIndex falls back to slide-scoped list order.
		expect(clips[2]).toMatchObject({
			metadata: {
				eventId: 'ev-3',
				targetId: undefined,
				targetLabel: '目标 ev-3',
				groupIndex: 1,
				groupLabel: '动画组 2',
				presetClass: 'path',
				trigger: 'afterPrevious',
			},
		});
		expect(clips.map((clip) => clip.metadata?.anchorLabel)).toStrictEqual(['A1', 'A2', 'A3']);
	});

	it('prefers clickGroupIndex over list order for the group ordinal', () => {
		const timeline = buildStoryboardTimeline([
			animationShot('grp', [animationEvent('ev-1', { targetLabel: undefined })], {
				clickGroupIndex: 2,
			}),
		]);
		const clip = animationClips(timeline)[0];
		expect(clip.metadata?.groupIndex).toBe(2);
		expect(clip.metadata?.groupLabel).toBe('动画组 3');
	});

	it('falls back to resolveTargetLabel only when the event has no targetLabel', () => {
		const timeline = buildStoryboardTimeline(
			[
				animationShot('grp', [
					animationEvent('ev-1'),
					animationEvent('ev-2', { targetLabel: undefined }),
				]),
			],
			{ resolveTargetLabel: (targetId) => `解析:${targetId}` },
		);
		const clips = animationClips(timeline);
		expect(clips[0].metadata?.targetLabel).toBe('目标 ev-1');
		expect(clips[1].metadata?.targetLabel).toBe('解析:target-ev-2');
	});

	it('leaves targetLabel undefined without an event label or resolver', () => {
		const timeline = buildStoryboardTimeline([
			animationShot('grp', [animationEvent('ev-1', { targetLabel: undefined })]),
		]);
		expect(animationClips(timeline)[0].metadata?.targetLabel).toBeUndefined();
	});
});

describe('animation anchor labels', () => {
	it('sorts out-of-order clips by time then id and stamps A1, A2, ...', () => {
		const track: TimelineTrack = {
			id: 'track-animation',
			kind: 'animation',
			name: '动画',
			clips: [animationClip('b', 200), animationClip('c', 100), animationClip('a', 100)],
		};
		const input = createTimelineModel([track]);
		const result = assignAnimationAnchorLabels(input);
		const clips = result.tracks.find((candidate) => candidate.kind === 'animation')!.clips;
		expect(clips.map((clip) => clip.id)).toStrictEqual(['a', 'c', 'b']);
		expect(clips.map((clip) => clip.metadata?.anchorLabel)).toStrictEqual(['A1', 'A2', 'A3']);
	});

	it('returns a new model and leaves the input untouched', () => {
		const input = createTimelineModel([
			{
				id: 'track-animation',
				kind: 'animation',
				name: '动画',
				clips: [animationClip('b', 200), animationClip('a', 0)],
			},
		]);
		const result = assignAnimationAnchorLabels(input);
		expect(result).not.toBe(input);
		const inputClips = input.tracks.find((candidate) => candidate.kind === 'animation')!.clips;
		expect(inputClips.map((clip) => clip.metadata?.anchorLabel)).toStrictEqual([
			undefined,
			undefined,
		]);
	});
});

describe('animation labels', () => {
	it('maps preset classes to readable labels', () => {
		expect(presetClassLabel('entr')).toBe('进入');
		expect(presetClassLabel('exit')).toBe('退出');
		expect(presetClassLabel('emph')).toBe('强调');
		expect(presetClassLabel('path')).toBe('路径');
		expect(presetClassLabel(undefined)).toBe('动画');
	});

	it('maps triggers to readable labels', () => {
		expect(triggerLabel('onClick')).toBe('点击触发');
		expect(triggerLabel('withPrevious')).toBe('与上一动画同时');
		expect(triggerLabel('afterPrevious')).toBe('上一动画之后');
		expect(triggerLabel(undefined)).toBe('');
	});

	it('summarizes target element text and falls back to an id digest', () => {
		const longText = '一二三四五六七八九十十一十二十三';
		expect(animationTargetLabel('text-1', [textElement('text-1', longText)])).toBe(
			'一二三四五六七八九十十一…',
		);
		expect(animationTargetLabel('text-1', [textElement('text-1', '勾股定理')])).toBe('勾股定理');
		expect(animationTargetLabel('missing-1', [textElement('text-1', '勾股定理')])).toBe(
			'元素 missing-1',
		);
		expect(animationTargetLabel('a-very-long-target-id', [])).toBe('元素 a-very-long-…');
	});
});

describe('animation event labels at group level', () => {
	it('fills trigger and targetLabel for editor animations', () => {
		const groups = buildStoryboardAnimationGroups(
			slide({
				animations: [
					{ elementId: 'text-1', entrance: 'fadeIn', durationMs: 800, trigger: 'onClick' },
					{ elementId: 'text-1', entrance: 'fadeIn', durationMs: 500, trigger: 'withPrevious' },
					{ elementId: 'text-1', entrance: 'fadeIn', durationMs: 400 },
				],
			}),
			0,
		);
		expect(groups).toHaveLength(2);
		expect(groups[0].events.map((event) => event.trigger)).toStrictEqual([
			'onClick',
			'withPrevious',
		]);
		expect(groups[0].events[0].targetLabel).toBe('勾股定理');
		expect(groups[1].events[0].trigger).toBe('onClick');
	});

	it('treats the first native step as the click and later steps as simultaneous', () => {
		const groups = buildStoryboardAnimationGroups(
			slide({
				nativeAnimations: [
					{
						targetId: 'text-1',
						presetClass: 'entr',
						durationMs: 700,
						parGroupIndex: 4,
						trigger: 'onClick',
					},
					{
						targetId: 'one',
						presetClass: 'emph',
						durationMs: 900,
						parGroupIndex: 4,
						trigger: 'withPrevious',
					},
				],
			}),
			0,
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].events.map((event) => event.trigger)).toStrictEqual([
			'onClick',
			'withPrevious',
		]);
		expect(groups[0].events[0].targetLabel).toBe('勾股定理');
		// A target without a matching element falls back to an id digest.
		expect(groups[0].events[1].targetLabel).toBe('元素 one');
	});
});
