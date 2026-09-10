import { useEffect, useRef, useState } from 'react';

import { activeShotIdAt, visualClipStartMs } from './playback-model';
import { clampPlayhead, findTimelineClip, stepPlayhead, stepPlayheadFrames } from './timeline';
import type { TimelineModel } from './timeline';

/** Roughly one 30fps frame: smooth playback without hammering the main thread. */
const TICK_INTERVAL_MS = 33;

export interface StoryboardPlaybackController {
	playheadMs: number;
	isPlaying: boolean;
	seek: (playheadMs: number) => void;
	togglePlay: () => void;
	stop: () => void;
}

export interface StoryboardPlaybackOptions {
	timeline: TimelineModel;
	onActiveShotChange: (shotId: string) => void;
	onEnd?: () => void;
}

/** Absolute-time playhead engine: the studio's single owner of time. */
export function useStoryboardPlayback(
	options: StoryboardPlaybackOptions,
): StoryboardPlaybackController {
	const { timeline, onActiveShotChange, onEnd } = options;
	const [playheadMs, setPlayheadMs] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const playheadRef = useRef(0);
	const callbacksRef = useRef({ onActiveShotChange, onEnd });
	callbacksRef.current = { onActiveShotChange, onEnd };

	const applyPlayheadMs = (valueMs: number) => {
		playheadRef.current = valueMs;
		setPlayheadMs(valueMs);
	};

	const seek = (valueMs: number) => {
		applyPlayheadMs(clampPlayhead(timeline, valueMs));
	};

	const togglePlay = () => {
		if (isPlaying) {
			setIsPlaying(false);
			return;
		}
		if (timeline.durationMs <= 0) {
			return;
		}
		// Restart from the top instead of stalling at the end.
		if (playheadRef.current >= timeline.durationMs) {
			applyPlayheadMs(0);
		}
		setIsPlaying(true);
	};

	const stop = () => {
		setIsPlaying(false);
	};

	// Advance on wall-clock deltas so speed stays independent of timer jitter.
	useEffect(() => {
		if (!isPlaying) {
			return;
		}
		let lastTickMs = performance.now();
		const handle = window.setInterval(() => {
			const nowMs = performance.now();
			const elapsedMs = nowMs - lastTickMs;
			lastTickMs = nowMs;
			const previousMs = playheadRef.current;
			const nextMs = stepPlayhead(timeline, previousMs, elapsedMs);
			playheadRef.current = nextMs;
			setPlayheadMs(nextMs);
			const durationMs = timeline.durationMs;
			if (durationMs > 0 && previousMs < durationMs && nextMs >= durationMs) {
				setIsPlaying(false);
				callbacksRef.current.onEnd?.();
			}
		}, TICK_INTERVAL_MS);
		return () => window.clearInterval(handle);
	}, [isPlaying, timeline]);

	// A timeline edit can shrink the model under the playhead: pull it back in.
	useEffect(() => {
		playheadRef.current = clampPlayhead(timeline, playheadRef.current);
		setPlayheadMs(playheadRef.current);
	}, [timeline]);

	// Report the shot under the playhead; gaps keep the current selection.
	const activeShotRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		const shotId = activeShotIdAt(timeline, playheadMs);
		if (shotId === undefined || shotId === activeShotRef.current) {
			return;
		}
		activeShotRef.current = shotId;
		callbacksRef.current.onActiveShotChange(shotId);
	}, [timeline, playheadMs]);

	return { playheadMs, isPlaying, seek, togglePlay, stop };
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target.tagName === 'INPUT' ||
		target.tagName === 'TEXTAREA' ||
		target.tagName === 'SELECT' ||
		target.isContentEditable
	);
}

function isButtonTarget(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && target.tagName === 'BUTTON';
}

/**
 * Window-level playback shortcuts: Space toggles (scroll suppressed), arrows
 * step one frame (Shift: ten), Home/End jump to the ends. Inputs, textareas
 * and selects keep their keystrokes, and a focused button keeps Space for its
 * own activation instead of toggling the playhead.
 */
export function useStoryboardPlaybackKeys(
	controller: StoryboardPlaybackController,
	timeline: TimelineModel,
): void {
	const stateRef = useRef({ controller, timeline });
	stateRef.current = { controller, timeline };
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (isTypingTarget(event.target)) {
				return;
			}
			const playback = stateRef.current.controller;
			const model = stateRef.current.timeline;
			switch (event.key) {
				case ' ':
					// 按钮聚焦时保留空格激活语义，不劫持也不滚动。
					if (isButtonTarget(event.target)) {
						break;
					}
					event.preventDefault();
					playback.togglePlay();
					break;
				case 'ArrowLeft':
					event.preventDefault();
					playback.seek(stepPlayheadFrames(model, playback.playheadMs, event.shiftKey ? -10 : -1));
					break;
				case 'ArrowRight':
					event.preventDefault();
					playback.seek(stepPlayheadFrames(model, playback.playheadMs, event.shiftKey ? 10 : 1));
					break;
				case 'Home':
					event.preventDefault();
					playback.seek(0);
					break;
				case 'End':
					event.preventDefault();
					playback.seek(model.durationMs);
					break;
				default:
					break;
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);
}

export interface StoryboardPlaybackSelection {
	/** Select a shot and seek to the start of its visual clip. */
	selectShot: (shotId: string) => void;
	/** Select a clip; animation clips also seek the playhead to their start. */
	selectClip: (clipId: string | undefined) => void;
	/** Restart global playback from the first shot. */
	playAll: (firstShotId: string) => void;
}

/**
 * Direct selections keep time and selection consistent: each one seeks the
 * playhead to the picked clip's start. (The automatic direction, playhead to
 * selection, lives in useStoryboardPlayback and never seeks.)
 */
export function useStoryboardPlaybackSelection(options: {
	timeline: TimelineModel;
	controller: StoryboardPlaybackController;
	onShotSelected: (shotId: string) => void;
	onClipSelected: (clipId: string | undefined) => void;
}): StoryboardPlaybackSelection {
	const selectShot = (shotId: string) => {
		options.onShotSelected(shotId);
		options.onClipSelected(undefined);
		const startMs = visualClipStartMs(options.timeline, shotId);
		if (startMs !== undefined) {
			options.controller.seek(startMs);
		}
	};
	return {
		selectShot,
		selectClip: (clipId) => {
			options.onClipSelected(clipId);
			if (clipId === undefined) {
				return;
			}
			const found = findTimelineClip(options.timeline, clipId);
			if (found && found.track.kind === 'animation') {
				options.controller.seek(found.clip.startMs);
			}
		},
		playAll: (firstShotId) => {
			selectShot(firstShotId);
			if (!options.controller.isPlaying) {
				options.controller.togglePlay();
			}
		},
	};
}
