import { resolveNarrationDrop } from './narration-binding-actions';
import {
	detachTimelineBinding,
	findNearestAnimationAnchor,
	findTimelineClip,
	moveNarrationClipFreely,
	moveTimelineClip,
	pixelsToMilliseconds,
	rebindTimelineClip,
	resizeTimelineClip,
} from './timeline';
import type { TimelineBinding, TimelineClip, TimelineEditResult, TimelineModel } from './timeline';

/** Pointer travel (px) beyond which a press counts as a drag instead of a click. */
export const DRAG_MOVED_THRESHOLD_PX = 3;

/** Magnet radius while dragging a narration clip, in on-screen pixels. */
export const MAGNET_THRESHOLD_PX = 8;

/** Grid + threshold shared by every drag-time snap lookup. */
export const DRAG_SNAP_OPTIONS = { enabled: true, thresholdPx: 8, gridMs: 100 } as const;

export type TimelineDragMode = 'move' | 'resize-end';

/**
 * One active pointer drag. `clip` is the dragged clip as of the last committed
 * frame. For narration moves the binding is suspended: every intermediate
 * commit strips it, so the studio's `applyNarrationBindings` pass cannot snap
 * `startMs` back to the anchor mid-drag and the drop decision stays reachable.
 */
export interface TimelineDragState {
	clip: TimelineClip;
	clipId: string;
	clientX: number;
	mode: TimelineDragMode;
	/** Latches true once the pointer travelled past the moved threshold. */
	moved: boolean;
	/** Binding attached when the drag began; restored on pointercancel. */
	originBinding?: TimelineBinding;
	originClientX: number;
	originStartMs: number;
}

export function beginTimelineDrag(
	clip: TimelineClip,
	mode: TimelineDragMode,
	clientX: number,
): TimelineDragState {
	return {
		clip,
		clipId: clip.id,
		clientX,
		mode,
		moved: false,
		originBinding: clip.binding,
		originClientX: clientX,
		originStartMs: clip.startMs,
	};
}

/**
 * Latched "this is a drag, not a click" predicate: true once the pointer has
 * travelled past the moved threshold in any frame. Shared by the `moved`
 * latch in withDragClientX and the P1 frame-commit gate in the plan* helpers.
 */
export function dragPassedMoveThreshold(drag: TimelineDragState, clientX: number): boolean {
	return drag.moved || Math.abs(clientX - drag.originClientX) > DRAG_MOVED_THRESHOLD_PX;
}

/** Advances the drag pointer bookkeeping; `moved` latches past the threshold. */
export function withDragClientX(drag: TimelineDragState, clientX: number): TimelineDragState {
	return {
		...drag,
		clientX,
		moved: dragPassedMoveThreshold(drag, clientX),
	};
}

/** Dragged clip snapshot after an accepted edit, for the next incremental frame. */
export function clipAfterEdit(
	result: TimelineEditResult,
	clipId: string,
): TimelineClip | undefined {
	return result.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
}

export interface NarrationMoveFrame {
	magnetAnchorId: string | null;
	result: TimelineEditResult;
}

/**
 * One intermediate narration move frame: resolve the magnet against the current
 * model, then move on a model with the dragged clip's binding stripped (bound
 * narrations stay exactly where the pointer puts them until release).
 */
export function planNarrationMoveFrame(input: {
	timeline: TimelineModel;
	drag: TimelineDragState;
	clientX: number;
	pixelsPerSecond: number;
}): NarrationMoveFrame | undefined {
	const { drag, pixelsPerSecond, timeline } = input;
	// P1 帧 gate：未过移动阈值的抖动不提交任何帧。否则受控父级会采纳 detach
	// 中间态，而 release 因 !moved 早退，绑定被静默丢弃。
	if (!dragPassedMoveThreshold(drag, input.clientX)) {
		return undefined;
	}
	const deltaMs = ((input.clientX - drag.clientX) / pixelsPerSecond) * 1000;
	const proposed = drag.clip.startMs + deltaMs;
	const nearest = findNearestAnimationAnchor(timeline, proposed, {
		maxDistanceMs: pixelsToMilliseconds(MAGNET_THRESHOLD_PX, pixelsPerSecond),
	});
	const targetMs = nearest ? Math.max(0, nearest.anchorStartMs) : proposed;
	const working = detachTimelineBinding(timeline, drag.clipId).timeline;
	const result = moveTimelineClip(working, drag.clipId, targetMs, {
		snap: nearest ? undefined : { ...DRAG_SNAP_OPTIONS, pixelsPerSecond },
		collisionStrategy: 'allow',
		moveParallelGroup: true,
	});
	if (!result.accepted) {
		return undefined;
	}
	return { magnetAnchorId: nearest ? nearest.anchorId : null, result };
}

/** One intermediate plain (visual/animation/subtitle) move with ripple collisions. */
export function planMoveFrame(input: {
	timeline: TimelineModel;
	drag: TimelineDragState;
	clientX: number;
	pixelsPerSecond: number;
}): TimelineEditResult | undefined {
	const { drag, pixelsPerSecond, timeline } = input;
	// P1 帧 gate：与旁白移动一致，亚阈值抖动不提交 visual/animation 帧。
	if (!dragPassedMoveThreshold(drag, input.clientX)) {
		return undefined;
	}
	const deltaMs = ((input.clientX - drag.clientX) / pixelsPerSecond) * 1000;
	const result = moveTimelineClip(timeline, drag.clipId, drag.clip.startMs + deltaMs, {
		snap: { ...DRAG_SNAP_OPTIONS, pixelsPerSecond },
		collisionStrategy: 'ripple',
		moveParallelGroup: true,
	});
	return result.accepted ? result : undefined;
}

/** One intermediate end-edge resize; narration overlaps are allowed. */
export function planResizeFrame(input: {
	timeline: TimelineModel;
	drag: TimelineDragState;
	clientX: number;
	pixelsPerSecond: number;
}): TimelineEditResult | undefined {
	const { drag, pixelsPerSecond, timeline } = input;
	// P1 帧 gate：resize 帧同样不允许亚阈值抖动提交。
	if (!dragPassedMoveThreshold(drag, input.clientX)) {
		return undefined;
	}
	const deltaMs = ((input.clientX - drag.clientX) / pixelsPerSecond) * 1000;
	const proposed = drag.clip.startMs + drag.clip.durationMs + deltaMs;
	const result = resizeTimelineClip(timeline, drag.clipId, 'end', proposed, {
		snap: { ...DRAG_SNAP_OPTIONS, pixelsPerSecond },
		minimumDurationMs: 200,
		collisionStrategy: drag.clip.kind === 'narration' ? 'allow' : 'ripple',
	});
	return result.accepted ? result : undefined;
}

export interface NarrationRelease {
	magnetAnchorId: string | null;
	/** undefined means the model is already final and no onChange is needed. */
	result?: TimelineEditResult;
}

/**
 * Release decision for a narration drag (see resolveNarrationDrop): a magnet
 * landing rebinds to the anchor with zero offset, any other landing stays
 * free. When the committed intermediate state already matches the decision
 * (controlled onChange loop), `result` is undefined and no onChange is sent.
 */
export function resolveNarrationRelease(input: {
	timeline: TimelineModel;
	drag: TimelineDragState;
	pixelsPerSecond: number;
}): NarrationRelease {
	const { drag } = input;
	if (drag.mode !== 'move' || drag.clip.kind !== 'narration') {
		return { magnetAnchorId: null };
	}
	if (!drag.moved) {
		return restoreUnmovedNarration(input.timeline, drag);
	}
	const decision = resolveNarrationDrop({
		timeline: input.timeline,
		clip: drag.clip,
		proposedStartMs: drag.clip.startMs,
		pixelsPerSecond: input.pixelsPerSecond,
	});
	if (decision.binding) {
		return {
			magnetAnchorId: decision.binding.anchorId,
			result: rebindTimelineClip(input.timeline, drag.clipId, decision.binding),
		};
	}
	// 自由落点：受控回路里中间态已悬置绑定，位置一致时不发冗余 onChange。
	const current = findTimelineClip(input.timeline, drag.clipId)?.clip;
	if (current && !current.binding && current.startMs === drag.clip.startMs) {
		return { magnetAnchorId: null };
	}
	return {
		magnetAnchorId: null,
		result: moveNarrationClipFreely(input.timeline, drag.clipId, drag.clip.startMs, {
			collisionStrategy: 'allow',
			moveParallelGroup: true,
		}),
	};
}

/**
 * P1 兜底：亚阈值抖动本不该提交帧（plan* 已 gate），但即使未来帧提交逻辑
 * 变化导致 `!moved` 时仍有受控中间态落地，这里也按原绑定 rebind 回原位，
 * 绑定绝不因抖动丢失；模型仍是原绑定状态时保持零 onChange。
 */
function restoreUnmovedNarration(
	timeline: TimelineModel,
	drag: TimelineDragState,
): NarrationRelease {
	if (!drag.originBinding) {
		return { magnetAnchorId: null };
	}
	const current = findTimelineClip(timeline, drag.clipId)?.clip;
	const intact =
		current !== undefined &&
		current.startMs === drag.originStartMs &&
		sameTimelineBinding(current.binding, drag.originBinding);
	if (intact) {
		return { magnetAnchorId: null };
	}
	return {
		magnetAnchorId: drag.originBinding.anchorId,
		result: rebindTimelineClip(timeline, drag.clipId, drag.originBinding),
	};
}

function sameTimelineBinding(left: TimelineBinding | undefined, right: TimelineBinding): boolean {
	return (
		left !== undefined &&
		left.anchorId === right.anchorId &&
		left.mode === right.mode &&
		left.offsetMs === right.offsetMs &&
		left.locked === right.locked
	);
}

/**
 * Pointercancel rollback: a narration that started bound is rebound to its
 * original anchor, which also snaps `startMs` back to the bound position.
 */
export function rollbackNarrationDrag(input: {
	timeline: TimelineModel;
	drag: TimelineDragState;
}): TimelineEditResult | undefined {
	const { drag } = input;
	if (drag.mode !== 'move' || drag.clip.kind !== 'narration' || !drag.originBinding) {
		return undefined;
	}
	return rebindTimelineClip(input.timeline, drag.clipId, drag.originBinding);
}
