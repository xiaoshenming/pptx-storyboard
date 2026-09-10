// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { narrationClipForShot, visualClipStartMs } from './playback-model';
import type { StoryboardShot } from './storyboard-model';
import { buildStoryboardTimeline } from './storyboard-timeline-adapter';
import {
	createTimelineBinding,
	createTimelineModel,
	createTimelineTrack,
	detachTimelineBinding,
	moveTimelineClip,
	rebindTimelineClip,
	resolveBindingStartMs,
} from './timeline';
import type { TimelineClip, TimelineModel, TimelineTrack } from './timeline';
import { useStoryboardPlayback, useStoryboardPlaybackKeys } from './use-storyboard-playback';
import type { StoryboardPlaybackController } from './use-storyboard-playback';
import { useStoryboardTimelineEdits } from './use-storyboard-timeline-edits';
import type { StoryboardTimelineEdits } from './use-storyboard-timeline-edits';

function clip(
	kind: 'visual' | 'animation' | 'narration',
	id: string,
	sourceId: string,
	startMs: number,
	durationMs: number,
): TimelineClip {
	return {
		id,
		trackId: `track-${kind}`,
		kind,
		startMs,
		durationMs,
		sourceId,
		...(kind === 'visual' ? { metadata: { baseDurationMs: durationMs } } : {}),
	};
}

/** Two 1s+2s shots; shot-b owns the only animation anchor. */
function playbackTimeline(): TimelineModel {
	const visual: TimelineTrack = {
		...createTimelineTrack('visual', [
			clip('visual', 'visual-a', 'shot-a', 0, 1000),
			clip('visual', 'visual-b', 'shot-b', 1000, 2000),
		]),
		locked: true,
	};
	const animation: TimelineTrack = {
		...createTimelineTrack('animation', [clip('animation', 'animation-ev-b', 'shot-b', 1000, 500)]),
		locked: true,
	};
	const narration = createTimelineTrack('narration', [
		clip('narration', 'narr-a', 'shot-a', 0, 1000),
		clip('narration', 'narr-b', 'shot-b', 1000, 2000),
	]);
	return createTimelineModel([visual, animation, narration]);
}

describe('useStoryboardPlayback', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.useFakeTimers({
			toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
		});
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.useRealTimers();
		globalThis.IS_REACT_ACT_ENVIRONMENT = false;
	});

	function renderPlayback(
		options: { onEnd?: () => void; onActiveShotChange?: (shotId: string) => void } = {},
	): { controller: () => StoryboardPlaybackController } {
		const controllerRef: { current: StoryboardPlaybackController | null } = { current: null };
		function Probe(): null {
			controllerRef.current = useStoryboardPlayback({
				timeline: playbackTimeline(),
				onActiveShotChange: options.onActiveShotChange ?? vi.fn(),
				onEnd: options.onEnd,
			});
			return null;
		}
		act(() => {
			root.render(createElement(Probe));
		});
		return { controller: () => controllerRef.current! };
	}

	it('advances playheadMs while playing (fake timers, 30fps ticks)', () => {
		const handle = renderPlayback();
		act(() => {
			handle.controller().togglePlay();
		});
		expect(handle.controller().isPlaying).toBeTruthy();
		act(() => {
			vi.advanceTimersByTime(330);
		});
		expect(handle.controller().playheadMs).toBe(330);
	});

	it('stops automatically at durationMs and fires onEnd exactly once', () => {
		const onEnd = vi.fn();
		const handle = renderPlayback({ onEnd });
		act(() => {
			handle.controller().togglePlay();
		});
		act(() => {
			vi.advanceTimersByTime(4000);
		});
		expect(handle.controller().isPlaying).toBeFalsy();
		expect(handle.controller().playheadMs).toBe(3000);
		expect(onEnd).toHaveBeenCalledOnce();
	});

	it('clears the tick interval on unmount', () => {
		const handle = renderPlayback();
		act(() => {
			handle.controller().togglePlay();
		});
		expect(vi.getTimerCount()).toBe(1);
		act(() => root.unmount());
		expect(vi.getTimerCount()).toBe(0);
	});

	it('reports the shot under the playhead via onActiveShotChange', () => {
		const onActiveShotChange = vi.fn();
		const handle = renderPlayback({ onActiveShotChange });
		expect(onActiveShotChange).toHaveBeenCalledWith('shot-a');
		act(() => {
			handle.controller().seek(1500);
		});
		expect(onActiveShotChange).toHaveBeenLastCalledWith('shot-b');
	});
});

describe('useStoryboardPlaybackKeys', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.useRealTimers();
		globalThis.IS_REACT_ACT_ENVIRONMENT = false;
	});

	function pressKey(target: Element, key: string): KeyboardEvent {
		let event: KeyboardEvent | null = null;
		act(() => {
			event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
			target.dispatchEvent(event);
		});
		return event!;
	}

	function renderKeys(): { controller: () => StoryboardPlaybackController } {
		const controllerRef: { current: StoryboardPlaybackController | null } = { current: null };
		function Probe(): null {
			const timeline = playbackTimeline();
			const controller = useStoryboardPlayback({
				timeline,
				onActiveShotChange: vi.fn(),
			});
			useStoryboardPlaybackKeys(controller, timeline);
			controllerRef.current = controller;
			return null;
		}
		act(() => {
			root.render(createElement(Probe));
		});
		return { controller: () => controllerRef.current! };
	}

	it('space toggles playback outside interactive controls', () => {
		const handle = renderKeys();
		const event = pressKey(document.body, ' ');
		expect(event.defaultPrevented).toBeTruthy();
		expect(handle.controller().isPlaying).toBeTruthy();
	});

	it('space on a button target keeps button activation (no preventDefault)', () => {
		const handle = renderKeys();
		const button = document.createElement('button');
		document.body.appendChild(button);
		const event = pressKey(button, ' ');
		expect(event.defaultPrevented).toBeFalsy();
		expect(handle.controller().isPlaying).toBeFalsy();
		button.remove();
	});

	it('select targets keep their keystrokes', () => {
		const handle = renderKeys();
		const select = document.createElement('select');
		document.body.appendChild(select);
		const event = pressKey(select, 'ArrowRight');
		expect(event.defaultPrevented).toBeFalsy();
		expect(handle.controller().playheadMs).toBe(0);
		select.remove();
	});

	it('arrows step one frame and End jumps to the end', () => {
		const handle = renderKeys();
		pressKey(document.body, 'ArrowRight');
		expect(handle.controller().playheadMs).toBe(1000 / 30);
		pressKey(document.body, 'End');
		expect(handle.controller().playheadMs).toBe(3000);
	});
});

/**
 * Ripple fixture: shot A is an animation shot whose anchor (ev-a) sits at
 * 500ms inside A's own visual segment; shot B's narration is bound to that
 * anchor with +1.6s, so it resolves to 2100ms, i.e. past A's visual end.
 */
const RIPPLE_SHOTS: StoryboardShot[] = [
	{
		id: 'shot-a',
		slideIndex: 0,
		kind: 'animation',
		label: '第 1 页 · 动画组 1',
		effectLabel: '飞入',
		durationMs: 2000,
		script: '甲',
		animationEvents: [
			{ id: 'ev-a', targetId: 't-a', startOffsetMs: 500, durationMs: 300, presetClass: 'entr' },
		],
	},
	{
		id: 'shot-b',
		slideIndex: 1,
		kind: 'animation',
		label: '第 2 页 · 动画组 1',
		effectLabel: '浮入',
		durationMs: 2000,
		script: '乙',
		animationEvents: [
			{ id: 'ev-b', targetId: 't-b', startOffsetMs: 0, durationMs: 500, presetClass: 'entr' },
		],
	},
];

function boundRippleTimeline(): TimelineModel {
	const base = buildStoryboardTimeline(RIPPLE_SHOTS);
	const result = rebindTimelineClip(
		base,
		'script-shot-b',
		createTimelineBinding('animation-ev-a', 'with-animation', 1600, false),
	);
	expect(result.accepted).toBeTruthy();
	return result.timeline;
}

describe('useStoryboardTimelineEdits', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		globalThis.IS_REACT_ACT_ENVIRONMENT = false;
	});

	function renderEdits(options: { selectedShotId?: string }): {
		edits: () => StoryboardTimelineEdits;
		timeline: () => TimelineModel;
		shots: () => StoryboardShot[];
	} {
		const captured: {
			edits: StoryboardTimelineEdits | null;
			timeline: TimelineModel | null;
			shots: StoryboardShot[] | null;
		} = { edits: null, timeline: null, shots: null };
		function Probe(): null {
			const [timeline, setTimeline] = useState<TimelineModel>(boundRippleTimeline);
			const [shots, setShots] = useState<StoryboardShot[]>(RIPPLE_SHOTS);
			captured.edits = useStoryboardTimelineEdits({
				timeline,
				selectedShotId: options.selectedShotId ?? 'shot-a',
				generatedShots: RIPPLE_SHOTS,
				setTimeline,
				setShots,
			});
			captured.timeline = timeline;
			captured.shots = shots;
			return null;
		}
		act(() => {
			root.render(createElement(Probe));
		});
		return {
			edits: () => captured.edits!,
			timeline: () => captured.timeline!,
			shots: () => captured.shots!,
		};
	}

	it('script ripple re-applies cross-shot bindings instead of drifting', () => {
		const handle = renderEdits({});
		const before = handle.timeline();
		expect(narrationClipForShot(before, 'shot-b')?.startMs).toBe(2100);
		act(() => {
			handle.edits().updateShot('shot-a', { script: '重写的甲分镜讲稿，比原来长很多' });
		});
		const next = handle.timeline();
		const bNarration = narrationClipForShot(next, 'shot-b');
		expect(bNarration).toBeDefined();
		// ripple 确实发生：B 的画面被推后到 A 之外。
		expect(visualClipStartMs(next, 'shot-b')).toBeGreaterThan(2000);
		// 绑定是事实来源：B 旁白回到锚点解析位置，而不是 ripple 后的漂移值。
		expect(bNarration?.startMs).toBe(resolveBindingStartMs(next, bNarration!));
		expect(bNarration?.startMs).toBe(2100);
	});

	it('applyNarrationPreview runs the unified commit chain', () => {
		const handle = renderEdits({});
		act(() => {
			handle.edits().applyNarrationPreview('shot-a', 3500);
		});
		const next = handle.timeline();
		const aNarration = narrationClipForShot(next, 'shot-a');
		const bNarration = narrationClipForShot(next, 'shot-b');
		expect(aNarration?.durationMs).toBe(3500);
		// 与拖拽编辑一致：视觉轨时长镜像回 shots。
		expect(handle.shots().find((shot) => shot.id === 'shot-a')?.durationMs).toBeGreaterThan(3500);
		// 试听时长同样重放绑定：B 旁白仍等于锚点解析值。
		expect(bNarration?.startMs).toBe(resolveBindingStartMs(next, bNarration!));
	});

	it('two same-frame previews both land without an interleaved render', () => {
		const handle = renderEdits({});
		act(() => {
			handle.edits().applyNarrationPreview('shot-a', 3000);
			handle.edits().applyNarrationPreview('shot-b', 2500);
		});
		const next = handle.timeline();
		// 读渲染闭包 timeline 的旧实现会让第二次试听覆盖掉第一次。
		expect(narrationClipForShot(next, 'shot-a')?.durationMs).toBe(3000);
		expect(narrationClipForShot(next, 'shot-b')?.durationMs).toBe(2500);
		// 提交链不变：B 旁白仍解析到锚点位置。
		const bNarration = narrationClipForShot(next, 'shot-b');
		expect(bNarration?.startMs).toBe(resolveBindingStartMs(next, bNarration!));
	});

	it('applyTimelineEdit keeps a mid-drag unbound narration where it was dropped', () => {
		const handle = renderEdits({});
		// 拖拽中间态：B 旁白已脱离绑定并被拖到 2500ms（锚点解析位是 2100ms）。
		const detached = detachTimelineBinding(handle.timeline(), 'script-shot-b');
		expect(detached.accepted).toBeTruthy();
		const midDrag = moveTimelineClip(detached.timeline, 'script-shot-b', 2500, {
			collisionStrategy: 'allow',
		});
		expect(midDrag.accepted).toBeTruthy();
		act(() => {
			handle.edits().applyTimelineEdit(midDrag.timeline);
		});
		const bNarration = narrationClipForShot(handle.timeline(), 'shot-b');
		// 提交链不把无绑定的被拖 clip 拉回锚点，也不丢掉它。
		expect(bNarration?.binding).toBeUndefined();
		expect(bNarration?.startMs).toBe(2500);
	});
});
