import type { PptxSlide } from 'pptx-viewer-core';
import { describe, expect, it } from 'vitest';

import { cleanMathNarration, elementTextFragments } from './text';

describe('cleanMathNarration', () => {
	it('removes boilerplate, underline blanks, and duplicate lines', () => {
		expect(
			cleanMathNarration(['这一页主要讲解：求出结果____', '求出结果____', '  求出结果  ']),
		).toBe('求出结果');
	});

	it('turns common primary-school formulas into readable Chinese', () => {
		expect(cleanMathNarration(['x_1 + 3 = 7', 'a^2+b^2=c^2', String.raw`\frac{1}{2}`])).toBe(
			'x下标1 加 3 等于 7，a的平方加b的平方等于c的平方，2分之1',
		);
	});

	it('normalizes full-width arithmetic operators', () => {
		expect(cleanMathNarration(['20×3＝60', '40＋8＝48'])).toBe('20乘3等于60，40加8等于48');
	});
});

describe('elementTextFragments', () => {
	it('extracts text from groups, tables, and SmartArt', () => {
		const elements: PptxSlide['elements'] = [
			{
				id: 'group',
				type: 'group',
				x: 0,
				y: 0,
				width: 10,
				height: 10,
				children: [
					{ id: 'child', type: 'text', text: '分组文字', x: 0, y: 0, width: 1, height: 1 },
				],
			},
			{
				id: 'table',
				type: 'table',
				x: 0,
				y: 0,
				width: 10,
				height: 10,
				tableData: { rows: [{ cells: [{ text: '3' }, { text: '4' }] }], columnWidths: [0.5, 0.5] },
			},
			{
				id: 'smart',
				type: 'smartArt',
				x: 0,
				y: 0,
				width: 10,
				height: 10,
				smartArtData: { nodes: [{ id: 'node', text: '总数' }] },
			},
		];
		expect(elements.flatMap(elementTextFragments)).toStrictEqual(['分组文字', '3', '4', '总数']);
	});

	it('prefers rich text segments without duplicating the plain text field', () => {
		const text = {
			id: 'rich',
			type: 'text',
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			text: '重复值',
			textSegments: [
				{ text: '每份', style: {} },
				{ text: '4个', style: {} },
			],
		} satisfies PptxSlide['elements'][number];
		expect(elementTextFragments(text)).toStrictEqual(['每份4个']);
	});
});
