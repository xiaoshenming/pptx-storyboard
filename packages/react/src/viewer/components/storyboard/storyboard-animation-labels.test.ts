import type { PptxElement } from 'pptx-viewer-core';
import { describe, expect, it } from 'vitest';

import { animationTargetLabel, truncateLabel } from './storyboard-animation-labels';

function element(overrides: Partial<PptxElement> & { id: string }): PptxElement {
	return { type: 'shape', ...overrides } as PptxElement;
}

describe('animationTargetLabel typed fallbacks', () => {
	it('labels textless elements by their kind plus name or id tail', () => {
		expect(
			animationTargetLabel('ppt/slides/slide1.xml-shape-1', [
				element({ id: 'ppt/slides/slide1.xml-shape-1', type: 'shape' }),
			]),
		).toBe('形状 shape-1');
		expect(animationTargetLabel('conn-1', [element({ id: 'conn-1', type: 'connector' })])).toBe(
			'线条 conn-1',
		);
		expect(animationTargetLabel('pic-1', [element({ id: 'pic-1', type: 'image' })])).toBe(
			'图片 pic-1',
		);
		expect(animationTargetLabel('ole-1', [element({ id: 'ole-1', type: 'ole' })])).toBe(
			'对象 ole-1',
		);
	});

	it('prefers the element name over the id tail', () => {
		expect(
			animationTargetLabel('ppt/slides/slide2.xml-shape-3', [
				element({ id: 'ppt/slides/slide2.xml-shape-3', type: 'shape', name: '答案卡片' }),
			]),
		).toBe('形状 答案卡片');
	});
});

describe('animationTargetLabel without element context', () => {
	it('falls back to a readable tail without path prefixes', () => {
		expect(animationTargetLabel('ppt/slides/slide3.xml', [])).toBe('对象 slide3');
		expect(animationTargetLabel('ppt/slides/slide3.xml-shape-5', [])).toBe('对象 shape-5');
		expect(animationTargetLabel('ppt/slides/slide3.xml#12', [])).toBe('对象 12');
		expect(animationTargetLabel('ppt/media/image2.png', [])).toBe('对象 image2');
		expect(animationTargetLabel('missing-1', [])).toBe('对象 missing-1');
	});

	it('keeps text summaries and the 12-character truncation rule', () => {
		expect(
			animationTargetLabel('text-1', [element({ id: 'text-1', type: 'text', text: '勾股定理' })]),
		).toBe('勾股定理');
		expect(
			animationTargetLabel('text-1', [
				element({ id: 'text-1', type: 'text', text: '一二三四五六七八九十十一十二十三' }),
			]),
		).toBe('一二三四五六七八九十十一…');
		expect(animationTargetLabel('a-very-long-target-id', [])).toBe('对象 a-very-long-…');
		expect(truncateLabel('一二三四五六七八九十十一十二十三')).toBe('一二三四五六七八九十十一…');
		expect(truncateLabel('短文本')).toBe('短文本');
	});
});
