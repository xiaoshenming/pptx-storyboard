import type { PptxElement } from 'pptx-viewer-core';

import { createTimelineModel, sortClips } from './timeline';
import type { TimelineModel } from './timeline';

/** Target labels on animation cards are capped at this many characters. */
const TARGET_LABEL_MAX_CHARS = 12;

const PRESET_CLASS_LABELS: Readonly<Record<string, string>> = {
	entr: '进入',
	exit: '退出',
	emph: '强调',
	path: '路径',
};

const TRIGGER_LABELS: Readonly<Record<string, string>> = {
	onClick: '点击触发',
	withPrevious: '与上一动画同时',
	afterPrevious: '上一动画之后',
};

export function truncateLabel(text: string, maxChars: number = TARGET_LABEL_MAX_CHARS): string {
	return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function elementPlainText(element: PptxElement): string {
	if ('text' in element && typeof element.text === 'string') {
		return element.text;
	}
	if ('textSegments' in element && Array.isArray(element.textSegments)) {
		return element.textSegments.map((segment) => String(segment.text ?? '')).join('');
	}
	return '';
}

/**
 * Compact label for an animation target: the element's text summary, or
 * `元素 <id digest>` when the element has no text (or is missing entirely).
 */
export function animationTargetLabel(targetId: string, elements: readonly PptxElement[]): string {
	const element = elements.find((candidate) => candidate.id === targetId);
	const text = element ? elementPlainText(element).replace(/\s+/g, ' ').trim() : '';
	return text ? truncateLabel(text) : `元素 ${truncateLabel(targetId)}`;
}

export function presetClassLabel(presetClass?: string): string {
	return (presetClass ? PRESET_CLASS_LABELS[presetClass] : undefined) ?? '动画';
}

export function triggerLabel(trigger?: string): string {
	return (trigger ? TRIGGER_LABELS[trigger] : undefined) ?? '';
}

/**
 * Stamps `A1`, `A2`, ... onto animation-track clips in chronological order
 * (startMs ascending, ties broken by clip id). Returns a new TimelineModel;
 * the input model, tracks, and clips are never mutated.
 */
export function assignAnimationAnchorLabels(timeline: TimelineModel): TimelineModel {
	let anchorIndex = 0;
	const tracks = timeline.tracks.map((track) => {
		if (track.kind !== 'animation') {
			return track;
		}
		const clips = sortClips(track.clips).map((clip) => {
			anchorIndex += 1;
			return { ...clip, metadata: { ...clip.metadata, anchorLabel: `A${anchorIndex}` } };
		});
		return { ...track, clips };
	});
	return createTimelineModel(tracks, timeline.frameRate);
}
