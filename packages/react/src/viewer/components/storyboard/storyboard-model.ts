import type { PptxElement, PptxSlide } from 'pptx-viewer-core';

import { planStoryboardScript, polishStoryboardScripts } from './script-planner';
import {
	buildStoryboardAnimationGroups,
	initialHiddenElementIds,
} from './storyboard-animation-groups';
import type { StoryboardAnimationEvent } from './storyboard-animation-groups';

export type StoryboardShotKind = 'static' | 'initial' | 'animation';

export interface StoryboardShot {
	id: string;
	slideIndex: number;
	animationIndex?: number;
	animationIndices?: number[];
	clickGroupIndex?: number;
	parallelGroupId?: string;
	animationEvents?: StoryboardAnimationEvent[];
	hiddenElementIds?: string[];
	kind: StoryboardShotKind;
	label: string;
	effectLabel: string;
	durationMs: number;
	script: string;
	scriptCues?: { preCue: string; revealCue: string; postCue: string };
	subtitlesEnabled?: boolean;
}

export interface StoryboardScriptRequest {
	shot: StoryboardShot;
	slideTitle: string;
	slideText: string;
	speakerNotes: string;
}

function elementText(element: PptxElement): string {
	if ('text' in element && typeof element.text === 'string') {
		return element.text.trim();
	}
	if ('textSegments' in element && Array.isArray(element.textSegments)) {
		return element.textSegments
			.map((segment) => String(segment.text ?? ''))
			.join('')
			.trim();
	}
	return '';
}

export function slidePlainText(slide: PptxSlide): string {
	return slide.elements.map(elementText).filter(Boolean).join('\n').slice(0, 6000);
}

export function slideDisplayTitle(slide: PptxSlide, index: number): string {
	return (
		slide.name?.trim() || slidePlainText(slide).split('\n')[0]?.slice(0, 36) || `第 ${index + 1} 页`
	);
}

function withPlannedScript(slide: PptxSlide, shot: StoryboardShot): StoryboardShot {
	if (shot.kind !== 'animation' && slide.notes?.trim()) {
		return { ...shot, script: slide.notes.trim() };
	}
	const plan = planStoryboardScript(slide, shot);
	return {
		...shot,
		script: plan.speakText,
		scriptCues: {
			preCue: plan.preCue,
			revealCue: plan.revealCue,
			postCue: plan.postCue,
		},
	};
}

function buildSlideStoryboardShots(
	slide: PptxSlide,
	slideIndex: number,
	options: { collapseAnimations?: boolean },
): StoryboardShot[] {
	const animationGroups = buildStoryboardAnimationGroups(slide, slideIndex);
	if (animationGroups.length === 0 || options.collapseAnimations) {
		return polishStoryboardScripts([
			withPlannedScript(slide, {
				id: `slide-${slideIndex + 1}-static`,
				slideIndex,
				kind: 'static' as const,
				label: `第 ${slideIndex + 1} 页`,
				effectLabel: '静态页面',
				durationMs: 5000,
				script: '',
				subtitlesEnabled: true,
			}),
		]);
	}
	const initial: StoryboardShot = {
		id: `slide-${slideIndex + 1}-initial`,
		slideIndex,
		kind: 'initial',
		label: `第 ${slideIndex + 1} 页 · 初始`,
		effectLabel: '页面进入',
		durationMs: 2500,
		script: '',
		hiddenElementIds: initialHiddenElementIds(slide),
		subtitlesEnabled: true,
	};
	return polishStoryboardScripts([
		withPlannedScript(slide, initial),
		...animationGroups.map((group, groupIndex) => {
			const animationEvents = group.events;
			return withPlannedScript(slide, {
				id: `slide-${slideIndex + 1}-animation-group-${groupIndex + 1}`,
				slideIndex,
				animationIndex: group.animationIndices?.[0],
				animationIndices: group.animationIndices,
				clickGroupIndex: groupIndex,
				parallelGroupId: `${slide.id}:${group.id}`,
				animationEvents,
				hiddenElementIds: group.hiddenElementIds,
				kind: 'animation' as const,
				label: `第 ${slideIndex + 1} 页 · 动画组 ${groupIndex + 1}`,
				effectLabel: group.effectLabel,
				// Placeholder pacing for voiced shots; retimeSilentStoryboardShots
				// compresses the silent ones once the final scripts are known.
				durationMs: Math.max(
					1800,
					...animationEvents.map((event) => event.startOffsetMs + event.durationMs + 1000),
				),
				script: '',
				subtitlesEnabled: true,
			});
		}),
	]);
}

export function buildStoryboardShots(
	slides: PptxSlide[],
	options: { collapseAnimations?: boolean } = {},
): StoryboardShot[] {
	return retimeSilentStoryboardShots(
		slides.flatMap((slide, slideIndex) => buildSlideStoryboardShots(slide, slideIndex, options)),
	);
}

// Silent-pacing policy (real-deck calibration: 19 pages, 127 shots, 83 voiced).
// Exit-only groups read as "cleared off stage", so they need the least dwell
// time; entrance/emphasis reveals must stay up about a second so students can
// read the answer that just appeared. Voiced shots keep their narration anchor
// and are never retimed here.
const SILENT_EXIT_FLOOR_MS = 900;
const SILENT_REVEAL_FLOOR_MS = 1300;
const SILENT_TAIL_MS = 300;

function silentShotFloorMs(events: StoryboardAnimationEvent[]): number {
	const allExit = events.length > 0 && events.every((event) => event.presetClass === 'exit');
	return allExit ? SILENT_EXIT_FLOOR_MS : SILENT_REVEAL_FLOOR_MS;
}

/**
 * Compresses silent animation shots once their final scripts are known
 * (after withPlannedScript + polishStoryboardScripts, which may blank a
 * planned script through dedup). A shot counts as silent with the same
 * `script.trim()` rule the timeline adapter and narration normalization use.
 * The per-event startOffsetMs/durationMs come from the deck's native
 * animations and are untouched: only the floor and the tail after the last
 * event end are compressed. Voiced shots keep max(1800, lastEnd + 1000).
 */
export function retimeSilentStoryboardShots(shots: StoryboardShot[]): StoryboardShot[] {
	return shots.map((shot) => {
		const events = shot.animationEvents ?? [];
		if (shot.kind !== 'animation' || shot.script.trim() || events.length === 0) {
			return shot;
		}
		const lastEventEndMs = Math.max(
			...events.map((event) => event.startOffsetMs + event.durationMs),
		);
		const durationMs = Math.max(silentShotFloorMs(events), lastEventEndMs + SILENT_TAIL_MS);
		return durationMs === shot.durationMs ? shot : { ...shot, durationMs };
	});
}

export function storyboardSlideForShot(slide: PptxSlide, shot: StoryboardShot): PptxSlide {
	if (shot.kind === 'static') {
		return slide;
	}
	if (shot.hiddenElementIds) {
		const hiddenIds = new Set(shot.hiddenElementIds);
		return hiddenIds.size === 0
			? slide
			: { ...slide, elements: slide.elements.filter((element) => !hiddenIds.has(element.id)) };
	}
	const editorAnimations = slide.animations ?? [];
	const nativeAnimations = editorAnimations.length === 0 ? (slide.nativeAnimations ?? []) : [];
	const currentAnimation = Math.max(...(shot.animationIndices ?? [shot.animationIndex ?? -1]));
	const hiddenIds = new Set<string>();

	if (editorAnimations.length > 0) {
		editorAnimations.forEach((animation, index) => {
			if (animation.entrance && index > currentAnimation) {
				hiddenIds.add(animation.elementId);
			}
			if (animation.exit && index <= currentAnimation) {
				hiddenIds.add(animation.elementId);
			}
		});
	} else {
		nativeAnimations.forEach((animation, index) => {
			if (!animation.targetId) {
				return;
			}
			if (animation.presetClass === 'entr' && index > currentAnimation) {
				hiddenIds.add(animation.targetId);
			}
			if (animation.presetClass === 'exit' && index <= currentAnimation) {
				hiddenIds.add(animation.targetId);
			}
		});
	}

	return hiddenIds.size === 0
		? slide
		: { ...slide, elements: slide.elements.filter((element) => !hiddenIds.has(element.id)) };
}

export function storyboardDuration(shots: StoryboardShot[]): number {
	return shots.reduce((total, shot) => total + shot.durationMs, 0);
}

export function formatStoryboardTime(durationMs: number): string {
	const seconds = Math.round(durationMs / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
