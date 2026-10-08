import type { PptxSlide } from 'pptx-viewer-core';
import { afterEach, expect, vi, test } from 'vitest';

import { polishStoryboardForVideo } from './auto-polish-narration';
import type { StoryboardShot } from './storyboard-model';

afterEach(() => {
	vi.unstubAllGlobals();
});

test('polishes pages with a bounded three-request pool and keeps page order', async () => {
	const slides = Array.from(
		{ length: 6 },
		(_, index) =>
			({
				id: `slide-${index}`,
				elements: [{ id: `text-${index}`, type: 'text', text: `第 ${index + 1} 页内容` }],
			}) as unknown as PptxSlide,
	);
	const shots: StoryboardShot[] = slides.map((_, index) => ({
		id: `shot-${index}`,
		slideIndex: index,
		kind: 'static',
		label: `第 ${index + 1} 页`,
		effectLabel: '静态页面',
		durationMs: 5000,
		script: '',
	}));
	let active = 0;
	let maxActive = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init?: RequestInit) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => {
				globalThis.setTimeout(resolve, 10);
			});
			active -= 1;
			const body = JSON.parse(String(init?.body)) as {
				material: { events: Array<{ id: string; targets: string[] }> };
			};
			return new Response(
				JSON.stringify({
					draft: {
						nodes: body.material.events.map((event) => ({
							shotId: event.id,
							text: `讲解 ${event.id}`,
							sources: event.targets.slice(0, 1),
						})),
					},
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		}),
	);
	const progress: number[] = [];
	const patches = await polishStoryboardForVideo({
		endpoint: '/api/storyboard/narration',
		slides,
		shots,
		generated: shots,
		onProgress: (done) => progress.push(done),
	});

	expect(maxActive).toBe(3);
	expect(progress).toStrictEqual([1, 2, 3, 4, 5, 6]);
	expect(patches.map((patch) => patch.id)).toStrictEqual(shots.map((shot) => shot.id));
});
