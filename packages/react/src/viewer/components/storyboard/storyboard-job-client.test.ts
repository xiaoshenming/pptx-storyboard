import { describe, expect, it } from 'vitest';

import { buildStoryboardManifest } from './storyboard-job-client';
import type { StoryboardShot } from './storyboard-model';
import { createTimelineBinding, createTimelineModel, createTimelineTrack } from './timeline';
import type { TimelineClip, TimelineModel } from './timeline';

function shot(id: string, overrides: Partial<StoryboardShot> = {}): StoryboardShot {
	return {
		id,
		slideIndex: 0,
		kind: 'initial',
		label: id,
		effectLabel: '',
		durationMs: 2000,
		script: `script-${id}`,
		...overrides,
	};
}

function visualClip(
	id: string,
	sourceId: string,
	startMs: number,
	durationMs: number,
): TimelineClip {
	return { id, trackId: 'track-visual', kind: 'visual', startMs, durationMs, sourceId };
}

function narrationClip(
	id: string,
	startMs: number,
	durationMs: number,
	text: string,
	binding?: TimelineClip['binding'],
): TimelineClip {
	return {
		id,
		trackId: 'track-narration',
		kind: 'narration',
		startMs,
		durationMs,
		sourceId: id,
		script: { id: `${id}-script`, text },
		binding,
	};
}

function buildTimeline(visual: TimelineClip[], narration: TimelineClip[]): TimelineModel {
	return createTimelineModel([
		createTimelineTrack('visual', visual),
		createTimelineTrack('narration', narration),
	]);
}

function buildInput(timeline: TimelineModel, overrides: Record<string, unknown> = {}) {
	return {
		fileName: 'demo.pptx',
		width: 1920,
		height: 1080,
		voiceType: 3,
		speed: 1,
		shots: [
			shot('shot-1'),
			shot('shot-2', {
				kind: 'animation' as const,
				animationEvents: [
					{ id: 'event-1', startOffsetMs: 0, durationMs: 800 },
					{ id: 'event-2', startOffsetMs: 900, durationMs: 2000 },
				],
			}),
		],
		timeline,
		...overrides,
	};
}

describe('buildStoryboardManifest', () => {
	const timeline = buildTimeline(
		[visualClip('v1', 'shot-1', 0, 2500), visualClip('v2', 'shot-2', 2500, 3000)],
		[
			narrationClip(
				'n1',
				2700,
				400,
				'第一段旁白',
				createTimelineBinding('anchor-1', 'after-animation', 200, true),
			),
			narrationClip('n2', 0, 300, '第二段旁白'),
		],
	);

	it('records the binding receipt on bound narration clips', () => {
		const manifest = buildStoryboardManifest(buildInput(timeline));
		const bound = manifest.narrationClips.find((clip) => clip.id === 'n1');
		expect(bound?.binding).toStrictEqual({
			anchorType: 'animation-event',
			anchorId: 'anchor-1',
			mode: 'after-animation',
			offsetMs: 200,
			locked: true,
		});
		expect(bound?.resolvedStartMs).toBe(bound?.startMs);
		expect(bound?.resolvedStartMs).toBe(2700);
	});

	it('keeps unbound narration clips keyless after serialization', () => {
		const manifest = buildStoryboardManifest(buildInput(timeline));
		const unbound = manifest.narrationClips.find((clip) => clip.id === 'n2');
		expect(unbound?.binding).toBeUndefined();
		expect(unbound?.resolvedStartMs).toBe(0);
		const serialized = JSON.parse(JSON.stringify(unbound)) as Record<string, unknown>;
		expect(serialized).not.toHaveProperty('binding');
	});

	it('passes bindingRevision through and drops the key when absent', () => {
		const withRevision = buildStoryboardManifest(buildInput(timeline, { bindingRevision: 7 }));
		expect(withRevision.bindingRevision).toBe(7);
		const withoutRevision = buildStoryboardManifest(buildInput(timeline));
		expect(withoutRevision.bindingRevision).toBeUndefined();
		const serialized = JSON.parse(JSON.stringify(withoutRevision)) as Record<string, unknown>;
		expect(serialized).not.toHaveProperty('bindingRevision');
	});

	it('keeps the version 1 manifest contract fields intact', () => {
		const manifest = buildStoryboardManifest(buildInput(timeline, { bindingRevision: 7 }));
		expect(manifest.version).toBe(1);
		expect(manifest).toMatchObject({
			fileName: 'demo.pptx',
			width: 1920,
			height: 1080,
			fps: 30,
			voiceType: 3,
			speed: 1,
		});
	});

	it('keeps every existing shot field', () => {
		const manifest = buildStoryboardManifest(buildInput(timeline));
		expect(manifest.shots[0]).toStrictEqual({
			id: 'shot-1',
			frameFile: 'frames/00000.png',
			previousFrameFile: undefined,
			transitionMs: undefined,
			startMs: 0,
			durationMs: 2500,
			startFrame: 0,
			frameCount: 75,
			script: 'script-shot-1',
			subtitlesEnabled: true,
		});
		expect(manifest.shots[1]).toStrictEqual({
			id: 'shot-2',
			frameFile: 'frames/00001.png',
			previousFrameFile: 'frames/00000.png',
			transitionMs: 1200,
			startMs: 2500,
			durationMs: 3000,
			startFrame: 75,
			frameCount: 90,
			script: 'script-shot-2',
			subtitlesEnabled: true,
		});
	});

	it('keeps every existing narration field and filters empty scripts', () => {
		const withEmpty = buildTimeline(
			[visualClip('v1', 'shot-1', 0, 2500)],
			[narrationClip('n1', 500, 400, '  '), narrationClip('n2', 900, 300, '有效旁白')],
		);
		const manifest = buildStoryboardManifest(buildInput(withEmpty));
		expect(manifest.narrationClips).toHaveLength(1);
		expect(manifest.narrationClips[0]).toStrictEqual({
			id: 'n2',
			sourceShotId: 'n2',
			startMs: 900,
			startSample: 43_200,
			durationMs: 300,
			script: '有效旁白',
			binding: undefined,
			resolvedStartMs: 900,
		});
	});
});
