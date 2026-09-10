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

/** Chinese labels per `PptxElement` discriminant; unknown kinds fall back to 对象. */
const ELEMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
	shape: '形状',
	image: '图片',
	picture: '图片',
	connector: '线条',
	table: '表格',
	chart: '图表',
	group: '组合',
	media: '媒体',
	ink: '墨迹',
	smartArt: '智能图形',
};

/** `.ext-` boundary inside positional element ids (`slide3.xml-shape-5`). */
const EMBEDDED_EXTENSION_BOUNDARY = /\.[A-Za-z0-9]+-/g;
/** Trailing file extension (`slide3.xml`, `image2.png`). */
const TRAILING_EXTENSION = /\.[A-Za-z0-9]+$/;

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
 * Readable tail of a raw animation target id: the text after the last `#`,
 * else after the last `/`, minus file extensions. Positional element ids embed
 * the slide part path (`ppt/slides/slide3.xml-shape-5`), so the segment after
 * the last `.ext-` boundary wins (`shape-5`); plain paths keep their bare name
 * (`ppt/media/image2.png` -> `image2`, `ppt/slides/slide3.xml` -> `slide3`).
 */
export function readableTargetTail(targetId: string): string {
	const hashIndex = targetId.lastIndexOf('#');
	let tail = hashIndex >= 0 ? targetId.slice(hashIndex + 1) : targetId;
	if (hashIndex < 0) {
		const slashIndex = tail.lastIndexOf('/');
		if (slashIndex >= 0) {
			tail = tail.slice(slashIndex + 1);
		}
	}
	let boundaryEnd = -1;
	for (const match of tail.matchAll(EMBEDDED_EXTENSION_BOUNDARY)) {
		boundaryEnd = (match.index ?? 0) + match[0].length;
	}
	if (boundaryEnd > 0) {
		return tail.slice(boundaryEnd);
	}
	return tail.replace(TRAILING_EXTENSION, '');
}

/** Name when the element carries one, else the readable tail of its id. */
function elementDisplayName(element: PptxElement): string {
	const name = typeof element.name === 'string' ? element.name.trim() : '';
	return name || readableTargetTail(element.id);
}

/**
 * Compact label for an animation target: the element's text summary when it
 * has one; otherwise a typed label built from the element kind plus its name
 * or id tail (`形状 shape-5`); and for targets that match no known element a
 * `对象 <readable tail>` digest that never shows a raw `ppt/slides/…` path.
 */
export function animationTargetLabel(targetId: string, elements: readonly PptxElement[]): string {
	const element = elements.find((candidate) => candidate.id === targetId);
	const text = element ? elementPlainText(element).replace(/\s+/g, ' ').trim() : '';
	if (text) {
		return truncateLabel(text);
	}
	if (element) {
		const typeLabel = ELEMENT_TYPE_LABELS[element.type] ?? '对象';
		return `${typeLabel} ${truncateLabel(elementDisplayName(element))}`;
	}
	return `对象 ${truncateLabel(readableTargetTail(targetId))}`;
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
