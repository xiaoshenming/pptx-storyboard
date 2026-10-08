import type { StoryboardShot } from './storyboard-model';
import type { StoryboardProjectSnapshot } from './storyboard-project-store';
import {
	buildStoryboardTimeline,
	normalizeNarrationDurations,
} from './storyboard-timeline-adapter';
import { applyNarrationBindings } from './timeline';
import type { TimelineModel } from './timeline';

export function hasInvalidStoryboardTiming(timeline: TimelineModel): boolean {
	return (
		!Number.isFinite(timeline.durationMs) ||
		timeline.tracks.some((track) =>
			track.clips.some(
				(clip) =>
					typeof clip.startMs !== 'number' ||
					!Number.isFinite(clip.startMs) ||
					clip.startMs < 0 ||
					typeof clip.durationMs !== 'number' ||
					!Number.isFinite(clip.durationMs) ||
					clip.durationMs <= 0 ||
					(track.kind === 'visual' && (clip.durationMs < 100 || clip.durationMs > 1800000)),
			),
		)
	);
}
export function rebuildStoryboardTiming(
	timeline: TimelineModel,
	shots: StoryboardShot[],
	generated: StoryboardShot[],
): TimelineModel {
	const base = new Map(generated.map((s) => [s.id, s]));
	const rebuilt = buildStoryboardTimeline(
		shots.map((shot) => ({
			...base.get(shot.id),
			...shot,
			durationMs: base.get(shot.id)?.durationMs ?? 2500,
		})),
	);
	const bindings = new Map(
		timeline.tracks
			.filter((t) => t.kind === 'narration')
			.flatMap((t) => t.clips)
			.filter((c) => c.binding && Number.isFinite(c.binding.offsetMs))
			.map((c) => [c.id, c.binding]),
	);
	const anchors = new Set(
		rebuilt.tracks
			.filter((t) => t.kind === 'animation')
			.flatMap((t) => t.clips)
			.map((c) => c.id),
	);
	return applyNarrationBindings({
		...rebuilt,
		tracks: rebuilt.tracks.map((track) =>
			track.kind === 'narration'
				? {
						...track,
						clips: track.clips.map((clip) => {
							const binding = bindings.get(clip.id);
							return binding && anchors.has(binding.anchorId) ? { ...clip, binding } : clip;
						}),
					}
				: track,
		),
	});
}
export function restoreStoryboardTimeline(
	saved: StoryboardProjectSnapshot,
	generated: StoryboardShot[],
): TimelineModel {
	if (!hasInvalidStoryboardTiming(saved.timeline)) {
		return normalizeNarrationDurations(saved.timeline, saved.shots);
	}
	// Keep the original snapshot before repairing corrupted timing, including manually positioned clips.
	const key = `pptx-viewer:storyboard-timing-backup:${saved.projectId}`;
	try {
		if (!localStorage.getItem(key)) {
			localStorage.setItem(key, JSON.stringify(saved));
		}
	} catch {
		return saved.timeline;
	}
	return rebuildStoryboardTiming(saved.timeline, saved.shots, generated);
}
