import { defaultBindingForNarration } from './narration-binding-actions';
import { presetClassLabel } from './storyboard-animation-labels';
import {
	createTimelineBinding,
	createTimelineModel,
	createTimelineTrack,
	detachTimelineBinding,
	estimateScriptDuration,
	findTimelineClip,
	rebindTimelineClip,
	resolveBindingStartMs,
} from './timeline';
import type { TimelineClip, TimelineEditResult, TimelineModel } from './timeline';

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
 * What clicking an animation clip (card or diamond anchor) means for the
 * narration clip currently edited in the binding panel: `bind` rebinds to the
 * clicked clip, `toggle-off` detaches an existing binding to it, `ignored`
 * swallows the click (locked binding), `legacy` falls back to the plain
 * select path (feature off, narration missing or its track locked).
 */
export type AnimationBindingClickOutcome = 'bind' | 'toggle-off' | 'ignored' | 'legacy';

export function animationBindingClickOutcome(input: {
	timeline: TimelineModel;
	editingNarrationClipId: string | undefined;
	clip: TimelineClip;
}): AnimationBindingClickOutcome {
	const { clip, editingNarrationClipId, timeline } = input;
	if (clip.kind !== 'animation' || !editingNarrationClipId) {
		return 'legacy';
	}
	const found = findTimelineClip(timeline, editingNarrationClipId);
	if (!found || found.track.kind !== 'narration' || found.track.locked) {
		return 'legacy';
	}
	// 锁定的旁白完全吞掉点击：不绑定也不解绑。
	if (found.clip.binding?.locked) {
		return 'ignored';
	}
	return found.clip.binding?.anchorId === clip.id ? 'toggle-off' : 'bind';
}

export interface AnimationBindingClickHandler {
	/** True when the click was consumed by the binding toggle (or swallowed). */
	handleClick: (clip: TimelineClip) => boolean;
	/** Hover hint for an animation card/anchor, e.g. `点击绑定旁白`. */
	hintFor: (clip: TimelineClip) => string | undefined;
}

/**
 * Wires the click-to-bind decision to the timeline callbacks. Animation cards
 * and BindingOverlay diamonds share one handler: a consumed click rebinds or
 * detaches the editing narration (with-animation, zero offset), keeps the seek
 * for A/V checks and never calls onSelectSource, so the binding panel keeps
 * showing the same narration.
 */
export function createAnimationBindingClickHandler(input: {
	timeline: TimelineModel;
	editingNarrationClipId: string | undefined;
	selectedClipId?: string;
	applyEdit: (result: TimelineEditResult) => void;
	onSelectClip?: (clipId: string | undefined) => void;
	onSeek?: (playheadMs: number) => void;
}): AnimationBindingClickHandler {
	const { applyEdit, editingNarrationClipId, selectedClipId, timeline } = input;
	const hintFor = (clip: TimelineClip): string | undefined => {
		switch (animationBindingClickOutcome({ clip, editingNarrationClipId, timeline })) {
			case 'bind':
				return '点击绑定旁白';
			case 'toggle-off':
				return '点击解除绑定';
			case 'ignored':
				return '绑定已锁定';
			default:
				return undefined;
		}
	};
	const handleClick = (clip: TimelineClip): boolean => {
		const outcome = animationBindingClickOutcome({ clip, editingNarrationClipId, timeline });
		if (outcome === 'legacy') {
			return false;
		}
		if (outcome === 'ignored') {
			return true;
		}
		applyEdit(
			outcome === 'bind'
				? rebindTimelineClip(
						timeline,
						editingNarrationClipId!,
						createTimelineBinding(clip.id, 'with-animation', 0),
					)
				: detachTimelineBinding(timeline, editingNarrationClipId!),
		);
		input.onSelectClip?.(selectedClipId === clip.id ? undefined : clip.id);
		// 保留 seek 便于检查音画；刻意不切分镜，绑定面板的旁白保持不变。
		input.onSeek?.(clip.startMs);
		return true;
	};
	return { handleClick, hintFor };
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
