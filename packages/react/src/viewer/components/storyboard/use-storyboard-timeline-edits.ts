import { useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { changeShotNarrationBinding, visualDurationsByShot } from './playback-model';
import type { StoryboardShot } from './storyboard-model';
import {
	applyNarrationDuration,
	reconcileNarrationTiming,
	updateTimelineScript,
} from './storyboard-timeline-adapter';
import { applyNarrationBindings, estimateScriptDuration } from './timeline';
import type { TimelineBinding, TimelineModel } from './timeline';

export interface StoryboardTimelineEdits {
	/** Apply a raw TimelineModel edit (drag, resize) through the reconcile chain. */
	applyTimelineEdit: (next: TimelineModel) => void;
	/** Binding editor change for the selected shot's narration clip. */
	changeNarrationBinding: (binding: TimelineBinding | undefined) => void;
	/** Patch a shot; script edits also re-time the narration and subtitle clips. */
	updateShot: (shotId: string, patch: Partial<StoryboardShot>) => void;
	/** TTS preview duration for a shot's narration, through the same chain. */
	applyNarrationPreview: (shotId: string, durationMs: number) => void;
}

function scriptDurationMs(shots: StoryboardShot[], shotId: string, script: string): number {
	const baseDurationMs = shots.find((shot) => shot.id === shotId)?.durationMs ?? 0;
	return Math.max(baseDurationMs, estimateScriptDuration(script) + 250);
}

/**
 * Pure commit chain every entry point funnels through: an edit is reconciled,
 * then narration bindings re-apply (bindings are the source of truth), so a
 * cross-shot narration (for example B's voice-over bound to an anchor inside
 * shot A) re-resolves to its anchor instead of drifting when an upstream shot
 * grows or shrinks. Takes the base model explicitly so state updaters can run
 * it against the latest committed timeline.
 */
function applyTimelineCommit(base: TimelineModel): TimelineModel {
	return applyNarrationBindings(reconcileNarrationTiming(base));
}

/** Mirror reconciled visual clip durations back onto the shots. */
function mirrorVisualDurations(
	reconciled: TimelineModel,
	setShots: Dispatch<SetStateAction<StoryboardShot[]>>,
): void {
	const durations = visualDurationsByShot(reconciled);
	setShots((current) =>
		current.map((shot) => {
			const durationMs = durations.get(shot.id);
			return durationMs === undefined ? shot : { ...shot, durationMs };
		}),
	);
}

/**
 * Conduit for every edit that reshapes the timeline. The hook keeps a ref of
 * the latest committed timeline so same-frame entry points chain off each
 * other; the timeline state itself is still derived by React from whichever
 * base the updater receives, never from the render closure.
 */
export function useStoryboardTimelineEdits(options: {
	timeline: TimelineModel;
	selectedShotId: string;
	generatedShots: StoryboardShot[];
	setTimeline: Dispatch<SetStateAction<TimelineModel>>;
	setShots: Dispatch<SetStateAction<StoryboardShot[]>>;
}): StoryboardTimelineEdits {
	const latestTimelineRef = useRef(options.timeline);
	latestTimelineRef.current = options.timeline;

	const applyTimelineEdit = (next: TimelineModel) => {
		const reconciled = applyTimelineCommit(next);
		latestTimelineRef.current = reconciled;
		options.setTimeline(reconciled);
		mirrorVisualDurations(reconciled, options.setShots);
	};
	return {
		applyTimelineEdit,
		changeNarrationBinding: (binding) => {
			const result = changeShotNarrationBinding(options.timeline, options.selectedShotId, binding);
			if (result?.accepted) {
				applyTimelineEdit(result.timeline);
			}
		},
		updateShot: (shotId, patch) => {
			const estimatedDuration =
				typeof patch.script === 'string'
					? scriptDurationMs(options.generatedShots, shotId, patch.script)
					: undefined;
			options.setShots((current) =>
				current.map((shot) =>
					shot.id === shotId
						? { ...shot, ...patch, durationMs: estimatedDuration ?? shot.durationMs }
						: shot,
				),
			);
			if (typeof patch.script === 'string') {
				// 讲稿 ripple 与 applyTimelineEdit 走同一条提交链：先对时再重放
				// 绑定，跨分镜锚点不随 ripple 漂移（漂移值会被持久化）。
				options.setTimeline((current) =>
					applyTimelineCommit(
						applyNarrationDuration(
							updateTimelineScript(current, shotId, patch.script!),
							shotId,
							estimatedDuration!,
						),
					),
				);
			}
		},
		applyNarrationPreview: (shotId, durationMs) => {
			// 试听时长统一走提交链，且对 timeline 用函数式更新：同帧连续两次
			// 试听各自基于最新已提交状态推导，第二次不再被渲染闭包覆盖丢失。
			// shots 镜像乐观地取 ref 上链出的同一模型；ref 偶发滞后时下一次
			// 编辑会重新镜像，timeline 状态本身永远正确。
			const reconciled = applyTimelineCommit(
				applyNarrationDuration(latestTimelineRef.current, shotId, durationMs),
			);
			latestTimelineRef.current = reconciled;
			options.setTimeline((current) =>
				applyTimelineCommit(applyNarrationDuration(current, shotId, durationMs)),
			);
			mirrorVisualDurations(reconciled, options.setShots);
		},
	};
}
