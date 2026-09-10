import { placeClipOnTrack } from './collision';
import { findTimelineClip, updateTimelineTracks } from './model';
import { collectClipSnapPoints, snapClipStart, snapTime } from './snap';
import type {
	TimelineClip,
	TimelineCollisionStrategy,
	TimelineEditResult,
	TimelineModel,
	TimelineSnapOptions,
} from './types';

export interface MoveClipOptions {
	snap?: TimelineSnapOptions;
	collisionStrategy?: TimelineCollisionStrategy;
	moveParallelGroup?: boolean;
}

function replaceTrack(
	timeline: TimelineModel,
	trackId: string,
	replacement: TimelineModel['tracks'][number],
) {
	return updateTimelineTracks(
		timeline,
		timeline.tracks.map((track) => (track.id === trackId ? replacement : track)),
	);
}

export function moveTimelineClip(
	timeline: TimelineModel,
	clipId: string,
	proposedStartMs: number,
	options: MoveClipOptions = {},
): TimelineEditResult {
	const found = findTimelineClip(timeline, clipId);
	if (!found || found.track.locked) {
		return { timeline, accepted: false, clipIds: [], collisionIds: [] };
	}
	const group =
		options.moveParallelGroup !== false && found.clip.parallelGroupId
			? found.track.clips.filter((clip) => clip.parallelGroupId === found.clip.parallelGroupId)
			: [found.clip];
	const excludedIds = new Set(group.map(({ id }) => id));
	const snapOptions = options.snap
		? {
				...options.snap,
				points: [
					...collectClipSnapPoints(timeline.tracks, excludedIds),
					...(options.snap.points ?? []),
				],
			}
		: undefined;
	const snap = snapOptions
		? snapClipStart(found.clip, proposedStartMs, snapOptions)
		: { timeMs: Math.max(0, proposedStartMs), deltaMs: 0 };
	const deltaMs = snap.timeMs - found.clip.startMs;
	const earliest = Math.min(...group.map(({ startMs }) => startMs));
	const boundedDelta = Math.max(deltaMs, -earliest);
	const moved = group.map((clip) => ({ ...clip, startMs: clip.startMs + boundedDelta }));
	let nextTrack = {
		...found.track,
		clips: found.track.clips.filter((clip) => !excludedIds.has(clip.id)),
	};
	const collisionIds = new Set<string>();
	for (const clip of moved) {
		const resolution = placeClipOnTrack(
			nextTrack,
			clip,
			options.collisionStrategy ?? found.track.collisionStrategy,
		);
		resolution.collisionIds.forEach((id) => collisionIds.add(id));
		if (!resolution.accepted) {
			return {
				timeline,
				accepted: false,
				clipIds: group.map(({ id }) => id),
				collisionIds: [...collisionIds],
				snap,
			};
		}
		nextTrack = resolution.track;
	}
	return {
		timeline: replaceTrack(timeline, found.track.id, nextTrack),
		accepted: true,
		clipIds: moved.map(({ id }) => id),
		collisionIds: [...collisionIds],
		snap,
	};
}

export interface ResizeClipOptions {
	minimumDurationMs?: number;
	snap?: TimelineSnapOptions;
	collisionStrategy?: TimelineCollisionStrategy;
}

export function resizeTimelineClip(
	timeline: TimelineModel,
	clipId: string,
	edge: 'start' | 'end',
	proposedTimeMs: number,
	options: ResizeClipOptions = {},
): TimelineEditResult {
	const found = findTimelineClip(timeline, clipId);
	if (!found || found.track.locked) {
		return { timeline, accepted: false, clipIds: [], collisionIds: [] };
	}
	const minimum = Math.max(1, options.minimumDurationMs ?? 100);
	const points = collectClipSnapPoints(timeline.tracks, new Set([clipId]));
	const snap = options.snap
		? snapTime(proposedTimeMs, {
				...options.snap,
				points: [...points, ...(options.snap.points ?? [])],
			})
		: { timeMs: Math.max(0, proposedTimeMs), deltaMs: 0 };
	const oldEnd = found.clip.startMs + found.clip.durationMs;
	const resized: TimelineClip =
		edge === 'start'
			? {
					...found.clip,
					startMs: Math.min(Math.max(0, snap.timeMs), oldEnd - minimum),
					durationMs: oldEnd - Math.min(Math.max(0, snap.timeMs), oldEnd - minimum),
				}
			: {
					...found.clip,
					durationMs: Math.max(minimum, snap.timeMs - found.clip.startMs),
				};
	const resolution = placeClipOnTrack(
		found.track,
		resized,
		options.collisionStrategy ?? found.track.collisionStrategy,
	);
	return {
		timeline: resolution.accepted
			? replaceTrack(timeline, found.track.id, resolution.track)
			: timeline,
		accepted: resolution.accepted,
		clipIds: [clipId],
		collisionIds: resolution.collisionIds,
		snap,
	};
}
