import { expect, test } from 'vitest';

import type { StoryboardShot } from './storyboard-model';
import { buildStoryboardTimeline } from './storyboard-timeline-adapter';
import { hasInvalidStoryboardTiming, rebuildStoryboardTiming } from './storyboard-timing-recovery';

test('rebuilds corrupt timings without changing saved narration or animation event identities', () => {
	const shots = [
		{
			id: 's',
			slideIndex: 0,
			kind: 'animation',
			label: '页',
			script: '保留我的讲稿',
			scriptLocked: true,
			durationMs: 2500,
			animationEvents: [{ id: 'e', startOffsetMs: 0, durationMs: 500 }],
		},
	] as StoryboardShot[];
	const model = buildStoryboardTimeline(shots);
	model.tracks[0].clips[0].durationMs = Infinity;
	expect(hasInvalidStoryboardTiming(model)).toBeTruthy();
	const recovered = rebuildStoryboardTiming(model, shots, shots);
	expect(hasInvalidStoryboardTiming(recovered)).toBeFalsy();
	expect(recovered.tracks.find((t) => t.kind === 'narration')!.clips[0].script?.text).toBe(
		'保留我的讲稿',
	);
	expect(recovered.tracks.find((t) => t.kind === 'animation')!.clips[0].id).toBe('animation-e');
	expect(model.tracks[0].clips[0].durationMs).toBe(Infinity);
});

test('backs up corrupt saved timing before restoration and keeps the first backup', async () => {
	const { vi } = await import('vitest');
	const { restoreStoryboardTimeline } = await import('./storyboard-timing-recovery');
	const values = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => values.get(k) ?? null,
		setItem: (k: string, v: string) => values.set(k, v),
	});
	try {
		const shots = [
			{
				id: 's',
				slideIndex: 0,
				kind: 'static',
				label: 's',
				script: '手改讲稿',
				scriptLocked: true,
				durationMs: 2500,
			},
		] as StoryboardShot[];
		const timeline = buildStoryboardTimeline(shots);
		timeline.tracks[0].clips[0].durationMs = null as unknown as number;
		const saved = {
			schemaVersion: 2 as const,
			projectId: 'test',
			fileName: 'test',
			updatedAt: '',
			shots,
			timeline,
			bindingRevision: 0,
			bindingHistory: [],
		};
		const result = restoreStoryboardTimeline(saved, shots);
		expect(hasInvalidStoryboardTiming(result)).toBeFalsy();
		expect(values.size).toBe(1);
		const backup = values.values().next().value;
		restoreStoryboardTimeline(saved, shots);
		expect(values.values().next().value).toBe(backup);
		expect(shots[0].scriptLocked).toBeTruthy();
	} finally {
		vi.unstubAllGlobals();
	}
});
