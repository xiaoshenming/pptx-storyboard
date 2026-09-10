import type { PptxElement } from 'pptx-viewer-core';
import { describe, expect, it } from 'vitest';

import {
	activeShotIdAt,
	animationClipsOf,
	changeShotNarrationBinding,
	createTargetLabelResolver,
	narrationClipForShot,
	visualClipStartMs,
	visualDurationsByShot,
} from './playback-model';
import { createTimelineBinding, createTimelineModel, createTimelineTrack } from './timeline';
import type { TimelineClip, TimelineModel, TimelineTrackKind } from './timeline';

function clip(
	kind: TimelineTrackKind,
	id: string,
	startMs: number,
	durationMs: number,
	sourceId?: string,
): TimelineClip {
	return { id, trackId: `track-${kind}`, kind, startMs, durationMs, sourceId };
}

function buildTimeline(): TimelineModel {
	return createTimelineModel([
		createTimelineTrack('visual', [
			clip('visual', 'v1', 0, 1000, 'shot-1'),
			clip('visual', 'v2', 1000, 500, 'shot-2'),
		]),
		createTimelineTrack('animation', [clip('animation', 'animation-a1', 1200, 400, 'shot-2')]),
		createTimelineTrack('narration', [clip('narration', 'n1', 0, 1000, 'shot-1')]),
		createTimelineTrack('subtitle'),
	]);
}

function textElement(id: string, text: string): PptxElement {
	return { id, type: 'text', text } as PptxElement;
}

describe('activeShotIdAt', () => {
	it('returns the sourceId of the visual clip covering the playhead', () => {
		const timeline = buildTimeline();
		expect(activeShotIdAt(timeline, 0)).toBe('shot-1');
		expect(activeShotIdAt(timeline, 999)).toBe('shot-1');
		expect(activeShotIdAt(timeline, 1000)).toBe('shot-2');
	});

	it('treats a clip end as a gap (start inclusive, end exclusive)', () => {
		const timeline = buildTimeline();
		expect(activeShotIdAt(timeline, 1500)).toBeUndefined();
		expect(activeShotIdAt(timeline, 1501)).toBeUndefined();
	});

	it('returns undefined for negative times, empty tracks, or missing visual tracks', () => {
		expect(activeShotIdAt(buildTimeline(), -1)).toBeUndefined();
		expect(activeShotIdAt(createTimelineModel([createTimelineTrack('visual')]), 0)).toBeUndefined();
		expect(
			activeShotIdAt(createTimelineModel([createTimelineTrack('narration')]), 0),
		).toBeUndefined();
	});
});

describe('clip lookups', () => {
	const timeline = buildTimeline();

	it('visualClipStartMs returns the visual clip start of a shot', () => {
		expect(visualClipStartMs(timeline, 'shot-1')).toBe(0);
		expect(visualClipStartMs(timeline, 'shot-2')).toBe(1000);
		expect(visualClipStartMs(timeline, 'missing')).toBeUndefined();
	});

	it('narrationClipForShot returns the narration clip of a shot', () => {
		expect(narrationClipForShot(timeline, 'shot-1')?.id).toBe('n1');
		expect(narrationClipForShot(timeline, 'shot-2')).toBeUndefined();
	});

	it('animationClipsOf lists the animation track clips', () => {
		expect(animationClipsOf(timeline).map(({ id }) => id)).toStrictEqual(['animation-a1']);
		expect(animationClipsOf(createTimelineModel([createTimelineTrack('visual')]))).toStrictEqual(
			[],
		);
	});

	it('visualDurationsByShot maps shot id to visual clip duration', () => {
		expect(visualDurationsByShot(timeline)).toStrictEqual(
			new Map([
				['shot-1', 1000],
				['shot-2', 500],
			]),
		);
	});
});

describe('changeShotNarrationBinding', () => {
	const binding = createTimelineBinding('animation-a1', 'with-animation', 250);

	it('rebinds a shot narration clip and resolves its start against the anchor', () => {
		const result = changeShotNarrationBinding(buildTimeline(), 'shot-1', binding);
		expect(result?.accepted).toBeTruthy();
		const rebound = result?.timeline.tracks
			.find((track) => track.kind === 'narration')
			?.clips.find(({ sourceId }) => sourceId === 'shot-1');
		expect(rebound?.binding).toStrictEqual(binding);
		expect(rebound?.startMs).toBe(1450);
	});

	it('detaches a binding when undefined is passed', () => {
		const bound = changeShotNarrationBinding(buildTimeline(), 'shot-1', binding);
		expect(bound?.accepted).toBeTruthy();
		const detached = changeShotNarrationBinding(bound!.timeline, 'shot-1', undefined);
		expect(detached?.accepted).toBeTruthy();
		const detachedClip = detached?.timeline.tracks
			.find((track) => track.kind === 'narration')
			?.clips.find(({ sourceId }) => sourceId === 'shot-1');
		expect(detachedClip?.binding).toBeUndefined();
	});

	it('rejects bindings to a missing animation anchor', () => {
		const result = changeShotNarrationBinding(
			buildTimeline(),
			'shot-1',
			createTimelineBinding('missing-anchor', 'with-animation'),
		);
		expect(result?.accepted).toBeFalsy();
	});

	it('returns undefined when the shot has no narration clip', () => {
		expect(changeShotNarrationBinding(buildTimeline(), 'shot-2', binding)).toBeUndefined();
	});
});

describe('createTargetLabelResolver', () => {
	it('labels targets from element text, capped at 12 characters', () => {
		const long = '勾股定理证明的完整推导过程示例';
		const resolve = createTargetLabelResolver([[textElement('e1', long)]]);
		expect(resolve('e1')).toBe(`${long.slice(0, 12)}…`);
	});

	it('falls back to typed or digest labels for textless or missing elements', () => {
		const resolve = createTargetLabelResolver([[textElement('e2', '   ')]]);
		expect(resolve('e2')).toBe('对象 e2');
		expect(resolve('missing')).toBe('对象 missing');
	});

	it('labels textless template elements by kind and unknown targets by readable tail', () => {
		const resolve = createTargetLabelResolver([
			[{ id: 'ppt/slides/slide1.xml-shape-1', type: 'shape' } as PptxElement],
		]);
		expect(resolve('ppt/slides/slide1.xml-shape-1')).toBe('形状 shape-1');
		expect(resolve('ppt/slides/slide3.xml-shape-9')).toBe('对象 shape-9');
	});

	it('prefers the first group on element id clashes across slides', () => {
		const resolve = createTargetLabelResolver([
			[textElement('shared', '第一页文本')],
			[textElement('shared', '第二页文本')],
		]);
		expect(resolve('shared')).toBe('第一页文本');
	});
});
