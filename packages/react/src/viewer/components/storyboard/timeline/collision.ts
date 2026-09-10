import { clipEndMs, sortClips } from './model';
import type { TimelineClip, TimelineCollisionStrategy, TimelineTrack } from './types';

export function clipsOverlap(
	left: Pick<TimelineClip, 'startMs' | 'durationMs'>,
	right: Pick<TimelineClip, 'startMs' | 'durationMs'>,
): boolean {
	return left.startMs < clipEndMs(right) && right.startMs < clipEndMs(left);
}

function parallelAnimations(left: TimelineClip, right: TimelineClip): boolean {
	return Boolean(
		left.kind === 'animation' &&
		left.parallelGroupId &&
		left.parallelGroupId === right.parallelGroupId,
	);
}

export function findClipCollisions(
	track: TimelineTrack,
	clip: TimelineClip,
	excludedClipIds: ReadonlySet<string> = new Set([clip.id]),
): TimelineClip[] {
	return track.clips.filter(
		(candidate) =>
			!excludedClipIds.has(candidate.id) &&
			clipsOverlap(candidate, clip) &&
			!parallelAnimations(candidate, clip),
	);
}

function overwriteClip(existing: TimelineClip, placed: TimelineClip): TimelineClip[] {
	const existingEnd = clipEndMs(existing);
	const placedEnd = clipEndMs(placed);
	if (!clipsOverlap(existing, placed)) {
		return [existing];
	}
	const beforeDuration = placed.startMs - existing.startMs;
	const afterDuration = existingEnd - placedEnd;
	const fragments: TimelineClip[] = [];
	if (beforeDuration > 0) {
		fragments.push({ ...existing, durationMs: beforeDuration });
	}
	if (afterDuration > 0) {
		fragments.push({
			...existing,
			id: `${existing.id}__after_${placed.id}`,
			startMs: placedEnd,
			durationMs: afterDuration,
		});
	}
	return fragments;
}

function rippleClips(clips: TimelineClip[], placed: TimelineClip): TimelineClip[] {
	const ordered = sortClips(clips);
	const firstAffected = ordered.find((clip) => clipEndMs(clip) > placed.startMs);
	if (!firstAffected || firstAffected.startMs >= clipEndMs(placed)) {
		return ordered;
	}
	const deltaMs = clipEndMs(placed) - firstAffected.startMs;
	return ordered.map((clip) =>
		clipEndMs(clip) <= placed.startMs ? clip : { ...clip, startMs: clip.startMs + deltaMs },
	);
}

export interface CollisionResolution {
	track: TimelineTrack;
	accepted: boolean;
	collisionIds: string[];
}

export function placeClipOnTrack(
	track: TimelineTrack,
	clip: TimelineClip,
	strategy: TimelineCollisionStrategy = track.collisionStrategy ?? 'reject',
): CollisionResolution {
	const withoutPlaced = track.clips.filter((candidate) => candidate.id !== clip.id);
	const collisions = findClipCollisions({ ...track, clips: withoutPlaced }, clip);
	if (collisions.length > 0 && strategy === 'reject') {
		return { track, accepted: false, collisionIds: collisions.map(({ id }) => id) };
	}
	let clips = withoutPlaced;
	if (strategy === 'overwrite') {
		clips = clips.flatMap((existing) => overwriteClip(existing, clip));
	}
	if (strategy === 'ripple') {
		clips = rippleClips(clips, clip);
	}
	return {
		track: { ...track, clips: sortClips([...clips, clip]) },
		accepted: true,
		collisionIds: collisions.map(({ id }) => id),
	};
}
