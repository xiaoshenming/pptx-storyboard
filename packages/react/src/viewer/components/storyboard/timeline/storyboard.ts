import { createTimelineModel, createTimelineTrack } from './model';
import { placeScriptFragments } from './script-placement';
import type { StoryboardTimelineSegment, TimelineClip, TimelineModel } from './types';

export function buildTimelineFromStoryboard(
	segments: StoryboardTimelineSegment[],
	frameRate = 30,
): TimelineModel {
	let cursor = 0;
	const visualClips: TimelineClip[] = [];
	const animationClips: TimelineClip[] = [];
	const scriptInputs: Array<{
		id: string;
		text: string;
		anchorClipId: string;
		sourceId: string;
	}> = [];
	for (const segment of segments) {
		const durationMs = Math.max(1, segment.durationMs);
		const visualId = `visual-${segment.id}`;
		visualClips.push({
			id: visualId,
			trackId: 'track-visual',
			kind: 'visual',
			startMs: cursor,
			durationMs,
			label: segment.label,
			sourceId: segment.id,
			metadata: { baseDurationMs: durationMs },
		});
		if (segment.animationId) {
			animationClips.push({
				id: `animation-${segment.animationId}`,
				trackId: 'track-animation',
				kind: 'animation',
				startMs: cursor,
				durationMs,
				label: segment.label,
				sourceId: segment.animationId,
				parallelGroupId: segment.parallelGroupId,
			});
		}
		if (segment.script?.trim()) {
			scriptInputs.push({
				id: `script-${segment.id}`,
				text: segment.script.trim(),
				anchorClipId: visualId,
				sourceId: segment.id,
			});
		}
		cursor += durationMs;
	}
	const visual = { ...createTimelineTrack('visual', visualClips), locked: true };
	const animation = { ...createTimelineTrack('animation', animationClips), locked: true };
	const narration = placeScriptFragments(createTimelineTrack('narration'), scriptInputs, {
		anchorClips: visualClips,
	});
	const subtitle = {
		...placeScriptFragments(
			createTimelineTrack('subtitle'),
			scriptInputs.map((fragment) => ({
				...fragment,
				id: fragment.id.replace('script-', 'subtitle-'),
			})),
			{ anchorClips: visualClips },
		),
		locked: true,
	};
	return createTimelineModel([visual, animation, narration, subtitle], frameRate);
}

export interface ParallelAnimationGroup {
	id: string;
	clipIds: string[];
	startMs: number;
	durationMs: number;
}

export function collectParallelAnimationGroups(timeline: TimelineModel): ParallelAnimationGroup[] {
	const groups = new Map<string, TimelineClip[]>();
	for (const clip of timeline.tracks.find(({ kind }) => kind === 'animation')?.clips ?? []) {
		if (!clip.parallelGroupId) {
			continue;
		}
		groups.set(clip.parallelGroupId, [...(groups.get(clip.parallelGroupId) ?? []), clip]);
	}
	return [...groups.entries()].map(([id, clips]) => {
		const startMs = Math.min(...clips.map((clip) => clip.startMs));
		const endMs = Math.max(...clips.map((clip) => clip.startMs + clip.durationMs));
		return {
			id,
			clipIds: clips.map(({ id: clipId }) => clipId),
			startMs,
			durationMs: endMs - startMs,
		};
	});
}
