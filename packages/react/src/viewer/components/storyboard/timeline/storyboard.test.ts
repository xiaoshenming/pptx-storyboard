import { describe, expect, it } from 'vitest';

import {
	buildTimelineFromStoryboard,
	collectParallelAnimationGroups,
	createTimelineModel,
	createTimelineTrack,
	estimateScriptDuration,
	placeScriptFragments,
	validateTimeline,
} from './index';

describe('storyboard timeline model', () => {
	it('builds four aligned tracks from storyboard segments', () => {
		const timeline = buildTimelineFromStoryboard([
			{ id: 'shot-1', durationMs: 2000, label: '封面', script: '欢迎观看。' },
			{
				id: 'shot-2',
				durationMs: 3000,
				label: '重点',
				script: '现在看重点。',
				animationId: 'fade-1',
				parallelGroupId: 'parallel-1',
			},
		]);
		expect(timeline.tracks.map(({ kind }) => kind)).toStrictEqual([
			'visual',
			'animation',
			'narration',
			'subtitle',
		]);
		expect(timeline.durationMs).toBe(5000);
		expect(timeline.tracks[0].clips.map(({ startMs }) => startMs)).toStrictEqual([0, 2000]);
		expect(timeline.tracks[2].clips[1]).toMatchObject({ startMs: 2000, durationMs: 3000 });
		expect(validateTimeline(timeline)).toStrictEqual([]);
	});

	it('derives the span and members of parallel animation groups', () => {
		const timeline = buildTimelineFromStoryboard([
			{
				id: 'one',
				durationMs: 1000,
				animationId: 'a',
				parallelGroupId: 'g',
			},
			{
				id: 'two',
				durationMs: 1500,
				animationId: 'b',
				parallelGroupId: 'g',
			},
		]);
		expect(collectParallelAnimationGroups(timeline)).toStrictEqual([
			{ id: 'g', clipIds: ['animation-a', 'animation-b'], startMs: 0, durationMs: 2500 },
		]);
	});
});

describe('script placement', () => {
	it('estimates readable duration and places unanchored fragments sequentially', () => {
		expect(estimateScriptDuration('一二三四五', 5, 500)).toBe(1000);
		const track = placeScriptFragments(
			createTimelineTrack('subtitle'),
			[
				{ id: 's1', text: '第一句', durationMs: 1000 },
				{ id: 's2', text: '第二句', durationMs: 800 },
			],
			{ startMs: 500, gapMs: 100 },
		);
		expect(track.clips.map(({ startMs }) => startMs)).toStrictEqual([500, 1600]);
		expect(validateTimeline(createTimelineModel([track]))).toStrictEqual([]);
		expect(
			placeScriptFragments(track, [{ id: 's1', text: '更新后', durationMs: 600 }]).clips,
		).toHaveLength(2);
	});

	it('uses a visual clip as the script timing anchor', () => {
		const anchor = {
			id: 'visual-1',
			trackId: 'track-visual',
			kind: 'visual' as const,
			startMs: 2400,
			durationMs: 1600,
		};
		const track = placeScriptFragments(
			createTimelineTrack('narration'),
			[{ id: 'n1', text: '跟随画面', anchorClipId: 'visual-1' }],
			{ anchorClips: [anchor] },
		);
		expect(track.clips[0]).toMatchObject({ startMs: 2400, durationMs: 1600 });
	});
});
