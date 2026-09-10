import type { PptxElement, PptxSlide } from 'pptx-viewer-core';

export type StoryboardShotKind = 'static' | 'initial' | 'animation';

export interface StoryboardShot {
	id: string;
	slideIndex: number;
	animationIndex?: number;
	animationIndices?: number[];
	parallelGroupId?: string;
	animationEvents?: Array<{
		id: string;
		targetId?: string;
		startOffsetMs: number;
		durationMs: number;
	}>;
	kind: StoryboardShotKind;
	label: string;
	effectLabel: string;
	durationMs: number;
	script: string;
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

function editorEffectLabel(animation: NonNullable<PptxSlide['animations']>[number]): string {
	return (
		animation.entrance ||
		animation.emphasis ||
		animation.exit ||
		(animation.motionPath ? '运动路径' : '动画')
	);
}

type SlideAnimation =
	| NonNullable<PptxSlide['animations']>[number]
	| NonNullable<PptxSlide['nativeAnimations']>[number];

interface AnimationGroup {
	id: string;
	items: Array<{ animation: SlideAnimation; index: number; startOffsetMs: number }>;
}

function animationGroups(animations: SlideAnimation[]): AnimationGroup[] {
	const groups: AnimationGroup[] = [];
	for (const [index, animation] of animations.entries()) {
		const nativeGroup = 'parGroupIndex' in animation ? animation.parGroupIndex : undefined;
		const continuesPrevious =
			animation.trigger === 'withPrevious' || animation.trigger === 'afterPrevious';
		const existing =
			nativeGroup === undefined
				? continuesPrevious
					? groups.at(-1)
					: undefined
				: groups.find((group) => group.id === `native-${nativeGroup}`);
		const group = existing ?? {
			id: nativeGroup === undefined ? `beat-${groups.length}` : `native-${nativeGroup}`,
			items: [],
		};
		if (!existing) {
			groups.push(group);
		}
		const delayMs =
			'triggerDelayMs' in animation
				? (animation.triggerDelayMs ?? animation.delayMs ?? 0)
				: (animation.delayMs ?? 0);
		const previous = group.items.at(-1);
		const startOffsetMs =
			animation.trigger === 'afterPrevious' && previous
				? previous.startOffsetMs + (previous.animation.durationMs ?? 600) + delayMs
				: animation.trigger === 'withPrevious' && previous
					? previous.startOffsetMs + delayMs
					: delayMs;
		group.items.push({ animation, index, startOffsetMs });
	}
	return groups;
}

function defaultScript(slide: PptxSlide, kind: StoryboardShotKind, _effectLabel: string): string {
	if (kind !== 'animation' && slide.notes?.trim()) {
		return slide.notes.trim();
	}
	const text = slidePlainText(slide).replaceAll('\n', '，').slice(0, 180);
	if (kind === 'animation') {
		return '';
	}
	return text ? `这一页主要讲解：${text}` : '请补充这一页的讲解文案。';
}

export function buildStoryboardShots(
	slides: PptxSlide[],
	options: { collapseAnimations?: boolean } = {},
): StoryboardShot[] {
	return slides.flatMap((slide, slideIndex) => {
		const editorAnimations = slide.animations ?? [];
		const nativeAnimations = editorAnimations.length === 0 ? (slide.nativeAnimations ?? []) : [];
		const animations: SlideAnimation[] =
			editorAnimations.length > 0 ? editorAnimations : nativeAnimations;
		if (animations.length === 0 || options.collapseAnimations) {
			return [
				{
					id: `slide-${slideIndex + 1}-static`,
					slideIndex,
					kind: 'static' as const,
					label: `第 ${slideIndex + 1} 页`,
					effectLabel: '静态页面',
					durationMs: 5000,
					script: defaultScript(slide, 'static', '静态页面'),
					subtitlesEnabled: true,
				},
			];
		}
		const initial: StoryboardShot = {
			id: `slide-${slideIndex + 1}-initial`,
			slideIndex,
			kind: 'initial',
			label: `第 ${slideIndex + 1} 页 · 初始`,
			effectLabel: '页面进入',
			durationMs: 2500,
			script: defaultScript(slide, 'initial', '页面进入'),
			subtitlesEnabled: true,
		};
		return [
			initial,
			...animationGroups(animations).map((group, groupIndex) => {
				const animation = group.items[0].animation;
				const animationIndex = group.items[0].index;
				const effectLabel =
					'elementId' in animation
						? editorEffectLabel(animation)
						: animation.presetClass === 'path'
							? '运动路径'
							: animation.presetClass === 'exit'
								? '退出动画'
								: animation.presetClass === 'emph'
									? '强调动画'
									: '进入动画';
				const animationEvents = group.items.map(({ animation: item, index, startOffsetMs }) => ({
					id: `slide-${slideIndex + 1}-animation-${index + 1}`,
					targetId: 'elementId' in item ? item.elementId : item.targetId,
					startOffsetMs,
					durationMs: item.durationMs ?? 600,
				}));
				return {
					id: `slide-${slideIndex + 1}-animation-group-${groupIndex + 1}`,
					slideIndex,
					animationIndex,
					animationIndices: group.items.map((item) => item.index),
					parallelGroupId: `${slide.id}:${group.id}`,
					animationEvents,
					kind: 'animation' as const,
					label: `第 ${slideIndex + 1} 页 · 动画组 ${groupIndex + 1}`,
					effectLabel,
					durationMs: Math.max(
						1800,
						...animationEvents.map((event) => event.startOffsetMs + event.durationMs + 1000),
					),
					script: defaultScript(slide, 'animation', effectLabel),
					subtitlesEnabled: true,
				};
			}),
		];
	});
}

export function storyboardSlideForShot(slide: PptxSlide, shot: StoryboardShot): PptxSlide {
	if (shot.kind === 'static') {
		return slide;
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
