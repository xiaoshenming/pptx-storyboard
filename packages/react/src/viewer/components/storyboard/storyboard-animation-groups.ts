import type { PptxSlide } from 'pptx-viewer-core';

import { compileSlideAnimationExport } from './animation-export';
import { animationTargetLabel } from './storyboard-animation-labels';

export type StoryboardAnimationTrigger = 'onClick' | 'withPrevious' | 'afterPrevious';

export interface StoryboardAnimationEvent {
	id: string;
	targetId?: string;
	startOffsetMs: number;
	durationMs: number;
	presetClass?: 'entr' | 'exit' | 'emph' | 'path';
	/** How the event starts relative to its click group; defaults to 'onClick'. */
	trigger?: StoryboardAnimationTrigger;
	keyframeName?: string;
	cssAnimation?: string;
	/** Element text summary for timeline cards, resolved when the group is built. */
	targetLabel?: string;
}

export interface StoryboardAnimationGroup {
	id: string;
	effectLabel: string;
	animationIndices?: number[];
	events: StoryboardAnimationEvent[];
	hiddenElementIds: string[];
}

function nativeGroups(slide: PptxSlide, slideIndex: number): StoryboardAnimationGroup[] {
	const timeline = compileSlideAnimationExport(slide);
	return timeline.clickGroups.map((compiled, groupIndex) => {
		const events = compiled.group.steps
			.filter((step) => !step.command)
			.map((step, stepIndex): StoryboardAnimationEvent => {
				return {
					id: `slide-${slideIndex + 1}-group-${groupIndex + 1}-step-${stepIndex + 1}`,
					targetId: step.elementId,
					// The compiled click group no longer carries per-step triggers: the
					// first step owns the click and later steps play alongside it. This
					// is an approximation of native click-group semantics, not parsed
					// source data.
					trigger: stepIndex === 0 ? 'onClick' : 'withPrevious',
					startOffsetMs: step.delayMs,
					durationMs: step.durationMs,
					presetClass: step.presetClass,
					keyframeName: step.keyframeName,
					cssAnimation: step.cssAnimation,
					targetLabel: animationTargetLabel(step.elementId, slide.elements),
				};
			});
		const classes = new Set(events.map((event) => event.presetClass));
		const effectLabel = classes.has('entr')
			? '进入动画'
			: classes.has('exit')
				? '退出动画'
				: classes.has('path')
					? '运动路径'
					: '强调动画';
		return {
			id: `native-click-${groupIndex + 1}`,
			effectLabel,
			events,
			hiddenElementIds: [...compiled.settledState]
				.filter(([, state]) => !state.visible)
				.map(([id]) => id),
		};
	});
}

type EditorAnimation = NonNullable<PptxSlide['animations']>[number];

function editorPreset(animation: EditorAnimation): StoryboardAnimationEvent['presetClass'] {
	if (animation.entrance) {
		return 'entr';
	}
	if (animation.exit) {
		return 'exit';
	}
	if (animation.emphasis) {
		return 'emph';
	}
	return animation.motionPath ? 'path' : undefined;
}

function editorTrigger(animation: EditorAnimation): StoryboardAnimationTrigger {
	// Triggers outside the click-group trio (onShapeClick, onHover, afterDelay,
	// undefined) each start their own click group, so they read as 'onClick'.
	if (animation.trigger === 'withPrevious' || animation.trigger === 'afterPrevious') {
		return animation.trigger;
	}
	return 'onClick';
}

function editorGroups(slide: PptxSlide, slideIndex: number): StoryboardAnimationGroup[] {
	const animations = slide.animations ?? [];
	const hidden = new Set(animations.filter((item) => item.entrance).map((item) => item.elementId));
	const groups: Array<Array<{ animation: EditorAnimation; index: number; startOffsetMs: number }>> =
		[];
	for (const [index, animation] of animations.entries()) {
		const continues = animation.trigger === 'withPrevious' || animation.trigger === 'afterPrevious';
		const group = continues ? groups.at(-1) : undefined;
		const target = group ?? [];
		if (!group) {
			groups.push(target);
		}
		const previous = target.at(-1);
		const delay = animation.delayMs ?? 0;
		const startOffsetMs =
			animation.trigger === 'afterPrevious' && previous
				? previous.startOffsetMs + (previous.animation.durationMs ?? 600) + delay
				: animation.trigger === 'withPrevious' && previous
					? previous.startOffsetMs + delay
					: delay;
		target.push({ animation, index, startOffsetMs });
	}
	return groups.map((items, groupIndex) => {
		const events = items.map(({ animation, index, startOffsetMs }) => {
			const presetClass = editorPreset(animation);
			if (presetClass === 'entr') {
				hidden.delete(animation.elementId);
			}
			if (presetClass === 'exit') {
				hidden.add(animation.elementId);
			}
			return {
				id: `slide-${slideIndex + 1}-animation-${index + 1}`,
				targetId: animation.elementId,
				startOffsetMs,
				durationMs: animation.durationMs ?? 600,
				presetClass,
				trigger: editorTrigger(animation),
				targetLabel: animationTargetLabel(animation.elementId, slide.elements),
			};
		});
		return {
			id: `editor-click-${groupIndex + 1}`,
			effectLabel: events.some((event) => event.presetClass === 'entr')
				? '进入动画'
				: events.some((event) => event.presetClass === 'exit')
					? '退出动画'
					: '动画',
			animationIndices: items.map((item) => item.index),
			events,
			hiddenElementIds: [...hidden],
		};
	});
}

export function buildStoryboardAnimationGroups(
	slide: PptxSlide,
	slideIndex: number,
): StoryboardAnimationGroup[] {
	return slide.nativeAnimations?.length
		? nativeGroups(slide, slideIndex)
		: editorGroups(slide, slideIndex);
}

export function initialHiddenElementIds(slide: PptxSlide): string[] {
	if (slide.nativeAnimations?.length) {
		return [...compileSlideAnimationExport(slide).initialState]
			.filter(([, state]) => !state.visible)
			.map(([id]) => id);
	}
	return (slide.animations ?? []).filter((item) => item.entrance).map((item) => item.elementId);
}
