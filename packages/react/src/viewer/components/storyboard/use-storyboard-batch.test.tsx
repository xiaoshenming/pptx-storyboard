// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';

import type { StoryboardShot } from './storyboard-model';
import { buildStoryboardTimeline } from './storyboard-timeline-adapter';
import { useStoryboardTimelineEdits } from './use-storyboard-timeline-edits';

test('commits multiple scripts using one shot and one timeline state update', () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	let shots = Array.from({ length: 20 }, (_, i) => ({
		id: `s${i}`,
		slideIndex: 0,
		kind: 'static',
		script: '原稿',
		label: `s${i}`,
		durationMs: 2500,
	})) as StoryboardShot[];
	let timeline = buildStoryboardTimeline(shots);
	let shotCalls = 0;
	let timelineCalls = 0;
	let edits: ReturnType<typeof useStoryboardTimelineEdits>;
	function Probe() {
		edits = useStoryboardTimelineEdits({
			timeline,
			selectedShotId: 's0',
			generatedShots: shots,
			setShots: (update) => {
				shotCalls++;
				shots = typeof update === 'function' ? update(shots) : update;
			},
			setTimeline: (update) => {
				timelineCalls++;
				timeline = typeof update === 'function' ? update(timeline) : update;
			},
		});
		return null;
	}
	const root = createRoot(document.createElement('div'));
	act(() => root.render(<Probe />));
	act(() =>
		edits!.updateShots(
			shots.map((s) => ({ id: s.id, patch: { script: '讲解新稿', scriptLocked: true } })),
		),
	);
	expect(shotCalls).toBe(1);
	expect(timelineCalls).toBe(1);
	expect(shots.every((s) => s.script === '讲解新稿' && s.scriptLocked)).toBeTruthy();
	expect(
		timeline.tracks.find((t) => t.kind === 'narration')!.clips.every((c) => c.label === '讲解新稿'),
	).toBeTruthy();
	act(() => root.unmount());
});
