import type { PptxSlide } from 'pptx-viewer-core';
import type { NarrationDraft } from 'pptx-viewer-shared';
// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, vi, test } from 'vitest';

import type { StoryboardShot } from './storyboard-model';
import { useAiNarration } from './use-ai-narration';

let root: ReturnType<typeof createRoot> | undefined;
afterEach(() => {
	if (root) {
		act(() => root!.unmount());
	}
	vi.unstubAllGlobals();
});
const slides = [0, 1].map((i) => ({
	id: `p${i}`,
	elements: [{ id: `c${i}`, type: 'text', text: `例题${i}` }],
})) as unknown as PptxSlide[];
const shots = [0, 1].map((i) => ({
	id: `s${i}`,
	slideIndex: i,
	kind: 'static',
	script: '原稿',
})) as StoryboardShot[];
function setup(cache = new Map<string, NarrationDraft>()) {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	let state: ReturnType<typeof useAiNarration>;
	function Probe() {
		state = useAiNarration({
			endpoint: '/test',
			slides,
			shots,
			cache,
			settings: { audience: '学生', detail: 'standard', supplement: '' },
		});
		return null;
	}
	root = createRoot(document.createElement('div'));
	act(() => root!.render(<Probe />));
	return () => state!;
}

test('generates sequentially, caches unchanged pages, and never mutates original scripts', async () => {
	let active = 0;
	let peak = 0;
	const request = vi.fn(async (_url: string, init: RequestInit) => {
		active++;
		peak = Math.max(peak, active);
		await Promise.resolve();
		const { material } = JSON.parse(String(init.body));
		active--;
		return {
			ok: true,
			json: async () => ({
				draft: {
					nodes: material.events.map((e: { id: string }) => ({
						shotId: e.id,
						text: '自然讲解',
						sources: ['c1'],
					})),
				},
			}),
		};
	});
	vi.stubGlobal('fetch', request);
	const state = setup();
	await act(async () => state().run([0, 1]));
	expect(peak).toBe(1);
	expect(request).toHaveBeenCalledTimes(2);
	expect(state().drafts).toHaveLength(2);
	expect(shots[0].script).toBe('原稿');
	await act(async () => state().run([0, 1]));
	expect(request).toHaveBeenCalledTimes(2);
	await act(async () => state().run([0], true));
	expect(request).toHaveBeenCalledTimes(3);
});

test('stops the queue on provider failure without inserting fallback scripts', async () => {
	const request = vi.fn(async () => ({ ok: false, json: async () => ({ error: '无效密钥' }) }));
	vi.stubGlobal('fetch', request);
	const state = setup();
	await act(async () => state().run([0, 1]));
	expect(request).toHaveBeenCalledOnce();
	expect(state().drafts).toHaveLength(0);
	expect(state().errors[0]).toContain('无效密钥');
	expect(shots[0].script).toBe('原稿');
});

test('cancels the active request without starting the next page', async () => {
	const request = vi.fn(
		(_url: string, init: RequestInit) =>
			new Promise((_resolve, reject) => {
				init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
			}),
	);
	vi.stubGlobal('fetch', request);
	const state = setup();
	let pending: Promise<void>;
	act(() => {
		pending = state().run([0, 1]);
	});
	await act(async () => {
		state().cancel();
		await pending;
	});
	expect(request).toHaveBeenCalledOnce();
	expect(state().drafts).toHaveLength(0);
	expect(state().running).toBeFalsy();
});
