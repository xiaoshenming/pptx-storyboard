import {
	applyNarrationDuration,
	reconcileNarrationTiming,
	updateTimelineScript,
} from './storyboard-timeline-adapter';
import { applyNarrationBindings } from './timeline';
import type { TimelineModel } from './timeline';

export interface NarrationBatchUpdate {
	id: string;
	script: string;
	durationMs: number;
}
/** Apply page edits before reconciling the full deck once. */
export function applyNarrationBatch(
	timeline: TimelineModel,
	updates: NarrationBatchUpdate[],
): TimelineModel {
	if (!updates.length) {
		return timeline;
	}
	let next = timeline;
	for (const update of updates) {
		next = applyNarrationDuration(
			updateTimelineScript(next, update.id, update.script),
			update.id,
			update.durationMs,
		);
	}
	return applyNarrationBindings(reconcileNarrationTiming(next));
}
