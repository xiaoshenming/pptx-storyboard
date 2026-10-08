import type { PptxSlide } from 'pptx-viewer-core';
import { describe, expect, it } from 'vitest';

import { buildNarrationMaterial, parseNarrationDraft } from './index';

const slides = [
	{
		id: 's1',
		elements: [
			{ id: 'a', type: 'text', text: '长方体的体积' },
			{ id: 'b', type: 'text', text: '长方体的体积' },
			{ id: 'c', type: 'text', text: 'WWW.1PPT.COM' },
			{
				id: 't',
				type: 'table',
				tableData: { rows: [{ cells: [{ text: '长' }, { text: '3cm' }] }] },
			},
		],
	},
] as unknown as PptxSlide[];
const shots = [
	{ id: 'initial', slideIndex: 0, kind: 'initial', hiddenElementIds: ['t'] },
	{ id: 'reveal', slideIndex: 0, kind: 'animation', animationEvents: [{ targetId: 't' }] },
];

describe('page narration material', () => {
	it('deduplicates content and references table reveal without sending image data', () => {
		const material = buildNarrationMaterial(slides, shots, 0, {
			audience: '高中生',
			detail: 'standard',
			supplement: '',
		});
		expect(material.contents).toHaveLength(2);
		expect(material.contents[1].text).toContain('长 | 3cm');
		expect(material.events[1].targets).toContain(material.contents[1].id);
		expect(material.events[0].targets).not.toContain(material.contents[1].id);
		expect(JSON.stringify(material)).not.toContain('1PPT');
	});

	it('accepts silent events but rejects invented IDs and future content', () => {
		const m = buildNarrationMaterial(slides, shots, 0, {
			audience: '高中生',
			detail: 'standard',
			supplement: '',
		});
		const nodes = [
			{ shotId: 'initial', text: '', sources: [] },
			{ shotId: 'reveal', text: '先看长和宽。', sources: [m.contents[1].id] },
		];
		expect(parseNarrationDraft({ nodes }, m).nodes).toHaveLength(2);
		expect(() =>
			parseNarrationDraft({ nodes: [{ ...nodes[0], shotId: 'fake' }, nodes[1]] }, m),
		).toThrow();
		expect(() =>
			parseNarrationDraft({ nodes: [{ ...nodes[0], sources: [m.contents[1].id] }, nodes[1]] }, m),
		).toThrow();
	});

	it('expands group visibility and animation targets, and reports partial Word extraction', () => {
		const grouped = [
			{
				id: 's',
				elements: [
					{
						id: 'g',
						shapeId: '20',
						type: 'group',
						children: [
							{ id: 'word', type: 'ole', text: '' },
							{ id: 'label', type: 'text', text: '体积' },
						],
					},
				],
			},
		] as unknown as PptxSlide[];
		const m = buildNarrationMaterial(
			grouped,
			[
				{ id: 'first', slideIndex: 0, kind: 'initial', hiddenElementIds: ['20'] },
				{ id: 'next', slideIndex: 0, kind: 'animation', animationEvents: [{ targetId: '20' }] },
			],
			0,
			{ audience: '学生', detail: 'standard', supplement: '' },
			{ word: '答案 [图片或旧版公式未提取]' },
		);
		expect(m.events[0].targets).toStrictEqual([]);
		expect(m.events[1].targets).toStrictEqual(['c1', 'c2']);
		expect(m.warnings.join('')).toContain('未提取');
	});

	it('fails explicitly when material exceeds the budget instead of silently dropping it', () => {
		const long = [
			{ id: 's', elements: [{ id: 'a', type: 'text', text: '知识'.repeat(7000) }] },
		] as unknown as PptxSlide[];
		expect(() =>
			buildNarrationMaterial(long, shots, 0, {
				audience: '学生',
				detail: 'standard',
				supplement: '',
			}),
		).toThrow(/过长/);
	});
});
