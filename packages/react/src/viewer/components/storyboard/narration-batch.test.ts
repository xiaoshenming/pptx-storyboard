import { expect, test } from 'vitest';

import { applyNarrationBatch } from './narration-batch';
import type { StoryboardShot } from './storyboard-model';
import {
	buildStoryboardTimeline,
	applyNarrationDuration,
	reconcileNarrationTiming,
	updateTimelineScript,
} from './storyboard-timeline-adapter';
import { applyNarrationBindings } from './timeline';

test('commits a large page in one batch without losing scripts', () => {
	const shots = Array.from({ length: 240 }, (_, i) => ({
		id: `s${i}`,
		slideIndex: Math.floor(i / 20),
		kind: 'static',
		label: `s${i}`,
		script: '原始讲稿',
		durationMs: 2500,
	})) as StoryboardShot[];
	const base = buildStoryboardTimeline(shots);
	const updates = shots.slice(0, 40).map((s) => ({
		id: s.id,
		script: '本页先观察已知条件，再分步骤说明推导过程。'.repeat(10),
		durationMs: 30000,
	}));
	let old = base;
	const start = performance.now();
	for (const u of updates) {
		old = applyNarrationBindings(
			reconcileNarrationTiming(
				applyNarrationDuration(updateTimelineScript(old, u.id, u.script), u.id, u.durationMs),
			),
		);
	}
	const oldMs = performance.now() - start;
	const nextStart = performance.now();
	const next = applyNarrationBatch(base, updates);
	const newMs = performance.now() - nextStart;
	process.stdout.write(`${JSON.stringify({ oldMs, newMs, durationMs: next.durationMs })}\n`);
	expect(next.tracks).toStrictEqual(old.tracks);
	expect(base.tracks.find((t) => t.kind === 'narration')!.clips[0].label).toBe('原始讲稿');
});

test('preserves cross-shot animation bindings and resolves them against final anchors', () => {
	const shots = Array.from({ length: 4 }, (_, i) => ({
		id: `s${i}`,
		slideIndex: 0,
		kind: 'static',
		label: `s${i}`,
		script: '原稿',
		durationMs: 2500,
	})) as StoryboardShot[];
	const base = buildStoryboardTimeline(shots);
	const animation = base.tracks.find((t) => t.kind === 'animation')!;
	animation.clips.push({
		id: 'anchor',
		trackId: animation.id,
		kind: 'animation',
		sourceId: 's2',
		startMs: 6000,
		durationMs: 500,
	});
	const narration = base.tracks.find((t) => t.kind === 'narration')!;
	narration.clips[3].binding = {
		anchorType: 'animation-event',
		anchorId: 'anchor',
		mode: 'after-animation',
		offsetMs: 100,
		locked: true,
	};
	const next = applyNarrationBatch(base, [
		{ id: 's0', script: '较长讲稿', durationMs: 9000 },
		{ id: 's3', script: '绑定讲稿', durationMs: 4000 },
	]);
	const result = next.tracks
		.find((t) => t.kind === 'narration')!
		.clips.find((c) => c.sourceId === 's3')!;
	const anchor = next.tracks.find((t) => t.kind === 'animation')!.clips[0];
	expect(result.binding).toStrictEqual(narration.clips[3].binding);
	expect(result.startMs).toBe(anchor.startMs + anchor.durationMs + 100);
	expect(result.label).toBe('绑定讲稿');
});

test('creates narration and subtitle clips when applying to a previously silent shot', () => {
	const shots = [
		{
			id: 'silent',
			slideIndex: 0,
			kind: 'static',
			label: '空白讲稿',
			script: '',
			durationMs: 2500,
		},
	] as StoryboardShot[];
	const base = buildStoryboardTimeline(shots);
	const next = applyNarrationBatch(base, [{ id: 'silent', script: '新增讲稿', durationMs: 5000 }]);
	for (const kind of ['narration', 'subtitle']) {
		const clip = next.tracks.find((t) => t.kind === kind)!.clips[0];
		expect(clip?.script?.text).toBe('新增讲稿');
		expect(clip?.durationMs).toBe(5000);
	}
	expect(next.tracks.find((t) => t.kind === 'visual')!.clips[0].durationMs).toBeGreaterThanOrEqual(
		5000,
	);
});
