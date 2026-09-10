import type { PptxSlide } from 'pptx-viewer-core';
import { describe, expect, it } from 'vitest';

import type { StoryboardShot } from '../storyboard-model';
import { planStoryboardScript } from './planner';

function element(id: string, text?: string): PptxSlide['elements'][number] {
	return { id, type: 'text', text, x: 0, y: 0, width: 100, height: 30 };
}

function slide(overrides: Partial<PptxSlide> = {}): PptxSlide {
	return {
		id: 'slide-1',
		rId: 'rId1',
		slideNumber: 1,
		elements: [element('given', '长方形的长是 8 厘米'), element('answer', '8×3=24')],
		animations: [{ elementId: 'answer', entrance: 'fadeIn' }],
		...overrides,
	};
}

function shot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
	return {
		id: 'shot-1',
		slideIndex: 0,
		kind: 'animation',
		label: '动画组 1',
		effectLabel: 'fadeIn',
		durationMs: 1800,
		script: '',
		animationIndex: 0,
		...overrides,
	};
}

describe('planStoryboardScript', () => {
	it('uses only the current editor animation group entrance targets', () => {
		const plan = planStoryboardScript(slide(), shot());
		expect(plan.targetElementIds).toStrictEqual(['answer']);
		expect(plan.sourceText).toBe('8乘3等于24');
		expect(plan.revealCue).toBe('8乘3等于24');
		expect(plan.speakText).not.toContain('长方形的长');
		expect(plan.speakText).not.toContain('这一页主要讲解');
	});

	it('collects parallel entrance targets without reading an emphasis target', () => {
		const currentSlide = slide({
			elements: [element('a', '第一步'), element('b', '第二步'), element('old', '旧结论')],
			animations: [
				{ elementId: 'a', entrance: 'fadeIn' },
				{ elementId: 'b', entrance: 'wipe', trigger: 'withPrevious' },
				{ elementId: 'old', emphasis: 'pulse', trigger: 'withPrevious' },
			],
		});
		const plan = planStoryboardScript(
			currentSlide,
			shot({ animationIndex: 0, animationIndices: [0, 1, 2] }),
		);
		expect(plan.targetElementIds).toStrictEqual(['a', 'b']);
		expect(plan.sourceText).toBe('第一步，第二步');
		expect(plan.speakText).not.toContain('旧结论');
	});

	it('supports native animation targets matched by shape id', () => {
		const currentSlide = slide({
			elements: [{ ...element('synthetic', '答案是 12'), shapeId: '7' }],
			animations: [],
			nativeAnimations: [{ targetId: '7', presetClass: 'entr' }],
		});
		const plan = planStoryboardScript(currentSlide, shot());
		expect(plan.targetElementIds).toStrictEqual(['synthetic']);
		expect(plan.sourceText).toBe('答案是 12');
	});

	it('plans an initial shot from elements visible before entrances', () => {
		const plan = planStoryboardScript(
			slide(),
			shot({ kind: 'initial', animationIndex: undefined }),
		);
		expect(plan.targetElementIds).toStrictEqual(['given']);
		expect(plan.sourceText).toBe('长方形的长是 8 厘米');
		expect(plan.speakText).not.toContain('24');
	});

	it('keeps an animation with no text silent', () => {
		const currentSlide = slide({
			elements: [{ id: 'diagram', type: 'shape', x: 0, y: 0, width: 80, height: 80 }],
			animations: [{ elementId: 'diagram', entrance: 'fadeIn' }],
		});
		const plan = planStoryboardScript(currentSlide, shot());
		expect(plan.sourceText).toBe('');
		expect(plan.targetElementIds).toStrictEqual(['diagram']);
		expect(plan.speakText).toBe('');
	});

	it('does not reread text for emphasis, exit, or motion animations', () => {
		for (const animation of [
			{ elementId: 'answer', emphasis: 'pulse' as const },
			{ elementId: 'answer', exit: 'fadeOut' as const },
			{ elementId: 'answer', motionPath: 'M 0 0 L 1 1' },
		]) {
			const plan = planStoryboardScript(slide({ animations: [animation] }), shot());
			expect(plan.targetElementIds).toStrictEqual([]);
			expect(plan.sourceText).toBe('');
			expect(plan.speakText).not.toContain('24');
		}
	});
});
