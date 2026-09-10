import type { StoryboardShot } from './storyboard-model';
import {
	buildTimelineFromStoryboard,
	createTimelineModel,
	estimateScriptDuration,
	sortClips,
} from './timeline';
import type { TimelineClip, TimelineModel } from './timeline';

export function buildStoryboardTimeline(shots: StoryboardShot[]): TimelineModel {
	const base = buildTimelineFromStoryboard(
		shots.map((shot) => ({
			id: shot.id,
			durationMs: shot.durationMs,
			label: shot.label,
			script: shot.script,
			animationId: shot.kind === 'animation' ? shot.id : undefined,
			parallelGroupId: shot.parallelGroupId,
		})),
	);
	const visual = base.tracks.find((track) => track.kind === 'visual');
	const animation = base.tracks.find((track) => track.kind === 'animation');
	if (!visual || !animation) {
		return base;
	}
	const starts = new Map(visual.clips.map((clip) => [clip.sourceId, clip.startMs]));
	const clips: TimelineClip[] = [];
	for (const shot of shots) {
		const shotStart = starts.get(shot.id) ?? 0;
		for (const event of shot.animationEvents ?? []) {
			clips.push({
				id: `animation-${event.id}`,
				trackId: animation.id,
				kind: 'animation',
				startMs: shotStart + event.startOffsetMs,
				durationMs: event.durationMs,
				label: shot.effectLabel,
				sourceId: shot.id,
				parallelGroupId: shot.parallelGroupId,
				metadata: { targetId: event.targetId },
			});
		}
	}
	const timeline = createTimelineModel(
		base.tracks.map((track) =>
			track.kind === 'animation' ? { ...track, clips: sortClips(clips) } : track,
		),
		base.frameRate,
	);
	return normalizeNarrationDurations(timeline, shots);
}

export function normalizeNarrationDurations(
	timeline: TimelineModel,
	shots: StoryboardShot[],
): TimelineModel {
	return shots.reduce(
		(current, shot) =>
			shot.script.trim()
				? applyNarrationDuration(current, shot.id, estimateScriptDuration(shot.script) + 250)
				: current,
		timeline,
	);
}

export function reconcileNarrationTiming(timeline: TimelineModel): TimelineModel {
	const visualStarts = new Map(
		(timeline.tracks.find((track) => track.kind === 'visual')?.clips ?? []).map((clip) => [
			clip.sourceId,
			clip.startMs,
		]),
	);
	const clamped = createTimelineModel(
		timeline.tracks.map((track) => ({
			...track,
			clips: track.clips.map((clip) =>
				track.kind === 'narration'
					? { ...clip, startMs: Math.max(clip.startMs, visualStarts.get(clip.sourceId) ?? 0) }
					: clip,
			),
		})),
		timeline.frameRate,
	);
	const narration = clamped.tracks.find((track) => track.kind === 'narration');
	if (!narration) {
		return clamped;
	}
	const narrationBySource = new Map(narration.clips.map((clip) => [clip.sourceId, clip]));
	const synchronized = createTimelineModel(
		clamped.tracks.map((track) => ({
			...track,
			clips: track.clips.map((clip) => {
				const source = track.kind === 'subtitle' ? narrationBySource.get(clip.sourceId) : undefined;
				return source ? { ...clip, startMs: source.startMs, durationMs: source.durationMs } : clip;
			}),
		})),
		clamped.frameRate,
	);
	return sortClips(narration.clips).reduce(
		(current, clip) =>
			clip.sourceId ? applyNarrationDuration(current, clip.sourceId, clip.durationMs) : current,
		synchronized,
	);
}

export function updateTimelineScript(
	timeline: TimelineModel,
	shotId: string,
	script: string,
): TimelineModel {
	return createTimelineModel(
		timeline.tracks.map((track) => ({
			...track,
			clips: track.clips.map((clip) =>
				(track.kind === 'narration' || track.kind === 'subtitle') && clip.sourceId === shotId
					? {
							...clip,
							label: script,
							script: clip.script ? { ...clip.script, text: script } : undefined,
						}
					: clip,
			),
		})),
		timeline.frameRate,
	);
}

export function applyNarrationDuration(
	timeline: TimelineModel,
	shotId: string,
	durationMs: number,
): TimelineModel {
	const visual = timeline.tracks
		.find((track) => track.kind === 'visual')
		?.clips.find((clip) => clip.sourceId === shotId);
	const narration = timeline.tracks
		.find((track) => track.kind === 'narration')
		?.clips.find((clip) => clip.sourceId === shotId);
	if (!visual || !narration) {
		return timeline;
	}
	const nextNarrationEnd = narration.startMs + durationMs;
	const baseDurationMs = Number(visual.metadata?.baseDurationMs ?? visual.durationMs);
	const nextVisualDuration = Math.max(baseDurationMs, nextNarrationEnd + 250 - visual.startMs);
	const durationDelta = nextVisualDuration - visual.durationMs;
	const boundary = visual.startMs + visual.durationMs;
	return createTimelineModel(
		timeline.tracks.map((track) => ({
			...track,
			clips: track.clips.map((clip) => {
				if (clip.id === narration.id || (track.kind === 'subtitle' && clip.sourceId === shotId)) {
					return { ...clip, durationMs };
				}
				if (clip.id === visual.id) {
					return { ...clip, durationMs: nextVisualDuration };
				}
				if (durationDelta !== 0 && clip.startMs >= boundary && clip.sourceId !== shotId) {
					return { ...clip, startMs: Math.max(0, clip.startMs + durationDelta) };
				}
				return clip;
			}),
		})),
		timeline.frameRate,
	);
}
