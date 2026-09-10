import { moveTimelineClip } from './editing';
import type { MoveClipOptions } from './editing';
import { findTimelineClip, updateTimelineTracks } from './model';
import type { TimelineClip, TimelineEditResult, TimelineModel } from './types';

export type TimelineBindingMode = 'before-animation' | 'with-animation' | 'after-animation';

export type TimelineBindingAnchorType = 'animation-event';

export interface TimelineBinding {
	anchorType: TimelineBindingAnchorType;
	anchorId: string;
	mode: TimelineBindingMode;
	offsetMs: number;
	locked: boolean;
}

function rejectedEdit(timeline: TimelineModel): TimelineEditResult {
	return { timeline, accepted: false, clipIds: [], collisionIds: [] };
}

function replaceNarrationClip(
	timeline: TimelineModel,
	clipId: string,
	update: (clip: TimelineClip) => TimelineClip,
): TimelineModel | undefined {
	const found = findTimelineClip(timeline, clipId);
	if (!found || found.track.kind !== 'narration') {
		return undefined;
	}
	const tracks = timeline.tracks.map((track) =>
		track.id === found.track.id
			? {
					...track,
					clips: track.clips.map((clip) => (clip.id === clipId ? update(clip) : clip)),
				}
			: track,
	);
	return updateTimelineTracks(timeline, tracks);
}

function withoutBinding(clip: TimelineClip): TimelineClip {
	const next = { ...clip };
	delete next.binding;
	return next;
}

export function createTimelineBinding(
	anchorId: string,
	mode: TimelineBindingMode,
	offsetMs = 0,
	locked = false,
): TimelineBinding {
	return { anchorType: 'animation-event', anchorId, mode, offsetMs, locked };
}

export function findAnimationAnchorClip(
	timeline: TimelineModel,
	anchorId: string,
): TimelineClip | undefined {
	for (const track of timeline.tracks) {
		if (track.kind !== 'animation') {
			continue;
		}
		const clip = track.clips.find((candidate) => candidate.id === anchorId);
		if (clip) {
			return clip;
		}
	}
	return undefined;
}

export function resolveBindingStartMs(
	timeline: TimelineModel,
	clip: TimelineClip,
): number | undefined {
	const binding = clip.binding;
	if (!binding) {
		return undefined;
	}
	const anchor = findAnimationAnchorClip(timeline, binding.anchorId);
	if (!anchor) {
		return undefined;
	}
	switch (binding.mode) {
		case 'with-animation':
			return anchor.startMs + binding.offsetMs;
		case 'after-animation':
			return anchor.startMs + anchor.durationMs + binding.offsetMs;
		case 'before-animation':
			// 旁白在锚点开始前结束，offset 是两者之间的间隙。
			return anchor.startMs - clip.durationMs + binding.offsetMs;
	}
}

export function applyNarrationBindings(timeline: TimelineModel): TimelineModel {
	let changed = false;
	const tracks = timeline.tracks.map((track) => {
		if (track.kind !== 'narration') {
			return track;
		}
		return {
			...track,
			clips: track.clips.map((clip) => {
				if (!clip.binding) {
					return clip;
				}
				const resolved = resolveBindingStartMs(timeline, clip);
				// NaN/Infinity 会经 timelineDuration 污染整条时间轴，视同无法解析。
				const startMs =
					resolved !== undefined && Number.isFinite(resolved) ? Math.max(0, resolved) : undefined;
				if (startMs === undefined || startMs === clip.startMs) {
					return clip;
				}
				changed = true;
				return { ...clip, startMs };
			}),
		};
	});
	return changed ? updateTimelineTracks(timeline, tracks) : timeline;
}

export function rebindTimelineClip(
	timeline: TimelineModel,
	clipId: string,
	binding: TimelineBinding,
): TimelineEditResult {
	const found = findTimelineClip(timeline, clipId);
	if (!found || found.track.kind !== 'narration') {
		return rejectedEdit(timeline);
	}
	if (!Number.isFinite(binding.offsetMs)) {
		return rejectedEdit(timeline);
	}
	if (!findAnimationAnchorClip(timeline, binding.anchorId)) {
		return rejectedEdit(timeline);
	}
	// 与 applyNarrationBindings 一致：锚点 startMs 非有限时解析为 NaN，
	// 不能经 Math.max 写入 startMs 污染整条时间轴，此时保持原 startMs。
	const resolved = resolveBindingStartMs(timeline, { ...found.clip, binding });
	const startMs =
		resolved !== undefined && Number.isFinite(resolved)
			? Math.max(0, resolved)
			: found.clip.startMs;
	const next = replaceNarrationClip(timeline, clipId, (current) => ({
		...current,
		binding,
		startMs,
	}));
	if (!next) {
		return rejectedEdit(timeline);
	}
	return { timeline: next, accepted: true, clipIds: [clipId], collisionIds: [] };
}

export function detachTimelineBinding(timeline: TimelineModel, clipId: string): TimelineEditResult {
	const found = findTimelineClip(timeline, clipId);
	if (!found || found.track.kind !== 'narration') {
		return rejectedEdit(timeline);
	}
	// 幂等约定：对无绑定 clip 的 detach 是成功的 no-op（accepted: true 且原引用）。
	if (!found.clip.binding) {
		return { timeline, accepted: true, clipIds: [clipId], collisionIds: [] };
	}
	const next = replaceNarrationClip(timeline, clipId, withoutBinding);
	if (!next) {
		return rejectedEdit(timeline);
	}
	return { timeline: next, accepted: true, clipIds: [clipId], collisionIds: [] };
}

export function moveNarrationClipFreely(
	timeline: TimelineModel,
	clipId: string,
	proposedStartMs: number,
	options: MoveClipOptions = {},
): TimelineEditResult {
	const found = findTimelineClip(timeline, clipId);
	// 锁定的绑定在模型层收口：UI 守护只是体验层，任何调用方都绕不过。
	if (found?.clip.binding?.locked) {
		return rejectedEdit(timeline);
	}
	if (!found?.clip.binding) {
		return moveTimelineClip(timeline, clipId, proposedStartMs, options);
	}
	const detached = detachTimelineBinding(timeline, clipId);
	// 旁白轨默认 reject 会拒绝重叠的自由摆放，自由拖动必须放行。
	const result = moveTimelineClip(detached.timeline, clipId, proposedStartMs, {
		...options,
		collisionStrategy: options.collisionStrategy ?? 'allow',
	});
	return result.accepted ? result : { ...result, timeline };
}

export function findNearestAnimationAnchor(
	timeline: TimelineModel,
	timeMs: number,
	options: { excludeClipId?: string; maxDistanceMs?: number } = {},
): { anchorId: string; anchorStartMs: number; distanceMs: number } | undefined {
	let nearest: { anchorId: string; anchorStartMs: number; distanceMs: number } | undefined;
	for (const track of timeline.tracks) {
		if (track.kind !== 'animation') {
			continue;
		}
		for (const clip of track.clips) {
			if (options.excludeClipId !== undefined && clip.id === options.excludeClipId) {
				continue;
			}
			const distanceMs = Math.abs(clip.startMs - timeMs);
			if (nearest && distanceMs >= nearest.distanceMs) {
				continue;
			}
			nearest = { anchorId: clip.id, anchorStartMs: clip.startMs, distanceMs };
		}
	}
	if (
		nearest &&
		options.maxDistanceMs !== undefined &&
		nearest.distanceMs > options.maxDistanceMs
	) {
		return undefined;
	}
	return nearest;
}

export function validateNarrationBindings(timeline: TimelineModel): string[] {
	const errors: string[] = [];
	for (const track of timeline.tracks) {
		for (const clip of track.clips) {
			if (!clip.binding) {
				continue;
			}
			if (track.kind !== 'narration') {
				errors.push(`Clip ${clip.id} has a binding on a ${track.kind} track`);
				continue;
			}
			if (!findAnimationAnchorClip(timeline, clip.binding.anchorId)) {
				errors.push(
					`Clip ${clip.id} references a missing animation anchor: ${clip.binding.anchorId}`,
				);
			}
			if (!Number.isFinite(clip.binding.offsetMs)) {
				errors.push(`Clip ${clip.id} has an invalid binding offsetMs`);
			}
		}
	}
	return errors;
}

export function describeTimelineBinding(mode: TimelineBindingMode): string {
	switch (mode) {
		case 'before-animation':
			return '动画前';
		case 'with-animation':
			return '动画同时';
		case 'after-animation':
			return '动画后';
	}
}

export function bindingBadgeText(binding: TimelineBinding, anchorLabel: string): string {
	const offset = formatBindingOffset(binding.offsetMs);
	if (!anchorLabel) {
		return offset;
	}
	return offset ? `🔗 ${anchorLabel} ${offset}` : `🔗 ${anchorLabel}`;
}

function formatBindingOffset(offsetMs: number): string {
	if (offsetMs === 0) {
		return '';
	}
	const sign = offsetMs > 0 ? '+' : '-';
	const magnitude = Math.abs(offsetMs);
	if (magnitude % 1000 === 0) {
		return `${sign}${magnitude / 1000}s`;
	}
	if (magnitude % 100 === 0) {
		return `${sign}${(magnitude / 1000).toFixed(1)}s`;
	}
	// 非整百毫秒（如手输 33ms）不产生长小数。
	return `${sign}${magnitude}ms`;
}
