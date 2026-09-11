import { defaultBindingForNarration } from './narration-binding-actions';
import { presetClassLabel } from './storyboard-animation-labels';
import {
	createTimelineModel,
	createTimelineTrack,
	estimateScriptDuration,
	resolveBindingStartMs,
} from './timeline';
import type { TimelineClip, TimelineModel } from './timeline';

export interface AnimationClipMetadata {
	anchorLabel?: string;
	targetLabel?: string;
	presetClass?: string;
}

export function animationMetadata(clip: TimelineClip): AnimationClipMetadata {
	return (clip.metadata ?? {}) as AnimationClipMetadata;
}

/** `A1 · 进入 · 数字 60`, the canonical option label for an animation anchor. */
export function animationClipOptionLabel(clip: TimelineClip): string {
	const meta = animationMetadata(clip);
	const target = meta.targetLabel ?? clip.label;
	return [meta.anchorLabel ?? clip.id, presetClassLabel(meta.presetClass), target]
		.filter(Boolean)
		.join(' · ');
}

/**
 * Default anchor suggestion for an unbound narration clip. Delegates to the
 * canonical `defaultBindingForNarration` (audit C3: earliest same-shot
 * entrance with a text target, else earliest same-shot animation; no
 * cross-shot default) so the editor, the context menu and the drop logic
 * share one default; returns its anchorId.
 */
export function suggestedAnchorId(
	animationClips: TimelineClip[],
	sourceId?: string,
): string | undefined {
	const timeline = createTimelineModel([createTimelineTrack('animation', animationClips)]);
	const probe: TimelineClip = {
		id: 'suggested-anchor-probe',
		trackId: 'track-narration',
		kind: 'narration',
		startMs: 0,
		durationMs: 0,
		sourceId,
	};
	return defaultBindingForNarration(timeline, probe)?.anchorId;
}

/** Same-shot vs other-shot split backing the optgroup anchor select. */
export function splitAnimationClips(
	animationClips: TimelineClip[],
	sourceId: string | undefined,
): { own: TimelineClip[]; others: TimelineClip[] } {
	const own: TimelineClip[] = [];
	const others: TimelineClip[] = [];
	for (const clip of animationClips) {
		(sourceId !== undefined && clip.sourceId === sourceId ? own : others).push(clip);
	}
	return { own, others };
}

/**
 * Outcome preview `当前 X.Xs → 绑定后 Y.Ys`: the clip's current start versus
 * the start the binding resolves to. A negative result is reported as clamped
 * to 0. Undefined when there is no binding or the anchor cannot be resolved.
 */
export function bindingOutcomePreview(
	timeline: TimelineModel,
	clip: TimelineClip,
): string | undefined {
	if (!clip.binding) {
		return undefined;
	}
	const resolved = resolveBindingStartMs(timeline, clip);
	if (resolved === undefined || !Number.isFinite(resolved)) {
		return undefined;
	}
	const target = resolved < 0 ? '0.0s（将被钳到 0）' : `${(resolved / 1000).toFixed(1)}s`;
	return `当前 ${(clip.startMs / 1000).toFixed(1)}s → 绑定后 ${target}`;
}

export interface ScriptDriftFeedback {
	direction: 'longer' | 'shorter';
	/** Absolute drift in seconds, one decimal place. */
	seconds: string;
}

/**
 * D1 feedback: compares the script's estimated narration duration against the
 * narration clip's current duration. Returns undefined when within tolerance
 * (no user-facing warning needed).
 */
export function scriptDriftFeedback(
	script: string,
	currentDurationMs: number | undefined,
	toleranceMs = 500,
): ScriptDriftFeedback | undefined {
	if (currentDurationMs === undefined) {
		return undefined;
	}
	const driftMs = estimateScriptDuration(script) - currentDurationMs;
	if (Math.abs(driftMs) <= toleranceMs) {
		return undefined;
	}
	return {
		direction: driftMs > 0 ? 'longer' : 'shorter',
		seconds: (Math.abs(driftMs) / 1000).toFixed(1),
	};
}
