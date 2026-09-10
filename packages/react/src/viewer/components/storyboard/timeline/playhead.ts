import { clipEndMs, sortClips } from './model';
import { clampTime, DEFAULT_FRAME_RATE, frameToMilliseconds, quantizeToFrame } from './time';
import type { TimelineClip, TimelineModel } from './types';

export interface PlayheadState {
	playheadMs: number;
	activeClips: TimelineClip[];
	currentClipIdByTrack: Record<string, string | undefined>;
}

function sanitizeDurationMs(durationMs: number): number {
	return Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
}

export function clampPlayhead(timeline: TimelineModel, playheadMs: number): number {
	return clampTime(playheadMs, 0, sanitizeDurationMs(timeline.durationMs));
}

function coversPlayhead(clip: TimelineClip, playheadMs: number): boolean {
	return clip.startMs <= playheadMs && playheadMs < clipEndMs(clip);
}

export function computePlayheadState(timeline: TimelineModel, playheadMs: number): PlayheadState {
	const clampedMs = clampPlayhead(timeline, playheadMs);
	const currentClipIdByTrack: Record<string, string | undefined> = {};
	for (const track of timeline.tracks) {
		currentClipIdByTrack[track.id] = undefined;
	}
	const activeClips: TimelineClip[] = [];
	for (const clip of sortClips(timeline.tracks.flatMap((track) => track.clips))) {
		if (!coversPlayhead(clip, clampedMs)) {
			continue;
		}
		activeClips.push(clip);
		if (currentClipIdByTrack[clip.trackId] === undefined) {
			currentClipIdByTrack[clip.trackId] = clip.id;
		}
	}
	return { playheadMs: clampedMs, activeClips, currentClipIdByTrack };
}

export function stepPlayhead(timeline: TimelineModel, playheadMs: number, deltaMs: number): number {
	return clampPlayhead(timeline, playheadMs + deltaMs);
}

export function stepPlayheadFrames(
	timeline: TimelineModel,
	playheadMs: number,
	frames: number,
	frameRate = DEFAULT_FRAME_RATE,
): number {
	const steppedMs = playheadMs + frameToMilliseconds(frames, frameRate);
	return clampPlayhead(timeline, quantizeToFrame(steppedMs, frameRate));
}

export function findNextBoundaryMs(
	timeline: TimelineModel,
	playheadMs: number,
	direction: 1 | -1,
): number | undefined {
	const durationMs = sanitizeDurationMs(timeline.durationMs);
	let candidate: number | undefined;
	for (const clip of timeline.tracks.flatMap((track) => track.clips)) {
		for (const boundary of [clip.startMs, clipEndMs(clip)]) {
			if (boundary <= 0 || boundary >= durationMs) {
				continue;
			}
			const isAhead = direction === 1 ? boundary > playheadMs : boundary < playheadMs;
			if (!isAhead) {
				continue;
			}
			const isCloser =
				candidate === undefined || (direction === 1 ? boundary < candidate : boundary > candidate);
			if (isCloser) {
				candidate = boundary;
			}
		}
	}
	return candidate;
}
