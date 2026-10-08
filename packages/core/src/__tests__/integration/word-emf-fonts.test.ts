import { readFile } from 'node:fs/promises';

import { convertMetafileToDataUrl } from 'emf-converter';
import { afterEach, expect, vi, test } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

test.each(['image13.emf', 'image14.emf'])(
	'preserves Word preview font names and sizes: %s',
	async (name) => {
		const draws: { text: string; font: string }[] = [];
		const context = new Proxy(
			{
				font: '',
				fillText(text: string) {
					draws.push({ text, font: this.font });
				},
			},
			{
				get(target, key) {
					if (key in target) {
						return target[key as keyof typeof target];
					}
					if (key === 'measureText') {
						return () => ({ width: 10 });
					}
					return () => {};
				},
			},
		);
		let canvas: Canvas;
		class Canvas {
			width = 0;
			height = 0;
			getContext() {
				return context;
			}
			toDataURL() {
				return 'data:image/png;base64,AA==';
			}
		}
		vi.stubGlobal('HTMLCanvasElement', Canvas);
		vi.stubGlobal('document', { createElement: () => (canvas = new Canvas()) });
		const bytes = await readFile(new URL(`../fixtures/word-emf/${name}`, import.meta.url));
		await expect(
			convertMetafileToDataUrl(
				bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
			),
		).resolves.toBeTruthy();
		expect(draws.length).toBeGreaterThan(10);
		// The EMF frame includes Word's whitespace. Ink bounds must not shrink it.
		expect(canvas!.width).toBe(1172);
		expect(canvas!.height).toBe(name === 'image13.emf' ? 68 : 174);
		for (const draw of draws) {
			expect([...draw.font].some((character) => character.charCodeAt(0) < 32)).toBeFalsy();
		}
		const normal = draws.find((d) => d.text === '1')!;
		expect(normal.font).toContain('"Times New Roman"');
		if (name === 'image14.emf') {
			const subscript = draws.find((d) => d.text === '长方体')!;
			const size = (font: string) => Number(font.match(/([\d.]+)px/)![1]);
			expect(size(subscript.font) / size(normal.font)).toBeCloseTo(19 / 37);
		}
	},
);
