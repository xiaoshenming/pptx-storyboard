import { describe, expect, it } from 'vitest';

import { splitChineseText } from './text';

describe('splitChineseText', () => {
	it('prefers Chinese sentence boundaries and preserves text exactly', () => {
		const text = `${'甲'.repeat(80)}。${'乙'.repeat(80)}。`;
		const chunks = splitChineseText(text);
		expect(chunks.map((chunk) => chunk.text)).toStrictEqual([
			`${'甲'.repeat(80)}。`,
			`${'乙'.repeat(80)}。`,
		]);
		expect(chunks.map((chunk) => [chunk.startIndex, chunk.endIndex])).toStrictEqual([
			[0, 81],
			[81, 162],
		]);
		expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
	});

	it('hard-splits to at most 150 Unicode characters', () => {
		const chunks = splitChineseText(`${'你'.repeat(149)}😀😀`);
		expect(chunks.map((chunk) => Array.from(chunk.text).length)).toStrictEqual([150, 1]);
		expect(chunks[1].startIndex).toBe(150);
	});

	it('rejects empty text', () => {
		expect(() => splitChineseText(' \n ')).toThrow('text must not be empty');
	});
});
