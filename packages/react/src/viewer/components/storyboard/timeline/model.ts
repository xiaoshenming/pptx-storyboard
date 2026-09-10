import { DEFAULT_FRAME_RATE } from './time';
import type { TimelineClip, TimelineModel, TimelineTrack, TimelineTrackKind } from './types';

export const DEFAULT_TRACK_IDS: Readonly<Record<TimelineTrackKind, string>> = {
	visual: 'track-visual',
	animation: 'track-animation',
	narration: 'track-narration',
	subtitle: 'track-subtitle',
};

const TRACK_NAMES: Readonly<Record<TimelineTrackKind, string>> = {
	visual: '画面',
	animation: '动画',
	narration: '旁白',
	subtitle: '字幕',
};

export function clipEndMs(clip: Pick<TimelineClip, 'startMs' | 'durationMs'>): number {
	return clip.startMs + clip.durationMs;
}

export function sortClips(clips: TimelineClip[]): TimelineClip[] {
	return [...clips].sort(
		(left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id),
	);
}

export function createTimelineTrack(
	kind: TimelineTrackKind,
	clips: TimelineClip[] = [],
): TimelineTrack {
	return {
		id: DEFAULT_TRACK_IDS[kind],
		kind,
		name: TRACK_NAMES[kind],
		clips: sortClips(clips),
		collisionStrategy: kind === 'animation' ? 'allow' : 'reject',
	};
}

export function timelineDuration(tracks: TimelineTrack[]): number {
	return tracks.reduce(
		(maximum, track) => Math.max(maximum, ...track.clips.map((clip) => clipEndMs(clip)), 0),
		0,
	);
}

export function createTimelineModel(
	tracks: TimelineTrack[] = [
		createTimelineTrack('visual'),
		createTimelineTrack('animation'),
		createTimelineTrack('narration'),
		createTimelineTrack('subtitle'),
	],
	frameRate = DEFAULT_FRAME_RATE,
): TimelineModel {
	return { tracks, frameRate, durationMs: timelineDuration(tracks) };
}

export function updateTimelineTracks(
	timeline: TimelineModel,
	tracks: TimelineTrack[],
): TimelineModel {
	return { ...timeline, tracks, durationMs: timelineDuration(tracks) };
}

export function findTimelineClip(
	timeline: TimelineModel,
	clipId: string,
): { track: TimelineTrack; clip: TimelineClip } | undefined {
	for (const track of timeline.tracks) {
		const clip = track.clips.find((candidate) => candidate.id === clipId);
		if (clip) {
			return { track, clip };
		}
	}
	return undefined;
}

export function validateTimeline(timeline: TimelineModel): string[] {
	const errors: string[] = [];
	const trackIds = new Set<string>();
	const clipIds = new Set<string>();
	for (const track of timeline.tracks) {
		if (trackIds.has(track.id)) {
			errors.push(`Duplicate track id: ${track.id}`);
		}
		trackIds.add(track.id);
		for (const clip of track.clips) {
			if (clipIds.has(clip.id)) {
				errors.push(`Duplicate clip id: ${clip.id}`);
			}
			clipIds.add(clip.id);
			if (clip.trackId !== track.id) {
				errors.push(`Clip ${clip.id} has a mismatched trackId`);
			}
			if (clip.kind !== track.kind) {
				errors.push(`Clip ${clip.id} has a mismatched kind`);
			}
			if (!Number.isFinite(clip.startMs) || clip.startMs < 0) {
				errors.push(`Clip ${clip.id} has an invalid startMs`);
			}
			if (!Number.isFinite(clip.durationMs) || clip.durationMs <= 0) {
				errors.push(`Clip ${clip.id} has an invalid durationMs`);
			}
		}
	}
	return errors;
}
