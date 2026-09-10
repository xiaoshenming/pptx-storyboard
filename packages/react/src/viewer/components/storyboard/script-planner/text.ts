import type { PptxElement } from 'pptx-viewer-core';

function directElementText(element: PptxElement): string[] {
	if ('textSegments' in element && element.textSegments?.length) {
		return [element.textSegments.map((segment) => segment.text).join('')];
	}
	if ('text' in element && typeof element.text === 'string') {
		return [element.text];
	}
	if (element.type === 'table') {
		return element.tableData?.rows.flatMap((row) => row.cells.map((cell) => cell.text)) ?? [];
	}
	if (element.type === 'smartArt') {
		return element.smartArtData?.nodes.map((node) => node.text) ?? [];
	}
	return [];
}

export function elementTextFragments(element: PptxElement): string[] {
	if (element.type === 'group') {
		return element.children.flatMap(elementTextFragments);
	}
	return directElementText(element);
}

function replaceLatexFractions(text: string): string {
	let result = text;
	const fraction = /\\(?:d?frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g;
	for (let pass = 0; pass < 3 && fraction.test(result); pass += 1) {
		fraction.lastIndex = 0;
		result = result.replace(fraction, (_, numerator: string, denominator: string) => {
			return `${denominator}分之${numerator}`;
		});
	}
	return result;
}

function replaceMathNotation(text: string): string {
	return replaceLatexFractions(text)
		.replace(/\\sqrt\s*\{([^{}]+)\}/g, '根号$1')
		.replace(/([\p{L}\p{N})\]}]+)\s*\^\s*\{?2\}?/gu, '$1的平方')
		.replace(/([\p{L}\p{N})\]}]+)\s*\^\s*\{?3\}?/gu, '$1的立方')
		.replace(/([\p{L}\p{N})\]}]+)\s*\^\s*\{?([^\s{}]+)\}?/gu, '$1的$2次方')
		.replace(/([\p{L}\p{N}])_\{?([\p{L}\p{N}]+)\}?/gu, '$1下标$2')
		.replace(/\\(?:times|cdot)\b/g, '乘')
		.replace(/\\div\b|÷/g, '除以')
		.replace(/\\pm\b|±/g, '正负')
		.replace(/\\(?:leq?|le)\b|≤/g, '小于等于')
		.replace(/\\(?:geq?|ge)\b|≥/g, '大于等于')
		.replace(/\\neq\b|≠/g, '不等于')
		.replace(/([\p{L}\p{N})]+)\s*\/\s*([\p{L}\p{N}(]+)/gu, '$2分之$1')
		.replace(/[=＝]/g, '等于')
		.replace(/[+＋]/g, '加')
		.replace(/(?<=[\p{L}\p{N})])\s*[-−]\s*(?=[\p{L}\p{N}(])/gu, '减')
		.replace(/[×·]/g, '乘');
}

function normalizedFragment(value: string): string {
	return replaceMathNotation(value)
		.replace(/这一页主要讲解\s*[：:]?/g, '')
		.replace(/_{2,}|＿+/g, ' ')
		.replace(/[{}$]/g, '')
		.replace(/\\[()[\]]/g, '')
		.replace(/\\([a-zA-Z]+)/g, '$1')
		.replace(/\s+/g, ' ')
		.replace(/\s*([，。；！？、：])\s*/g, '$1')
		.trim();
}

export function cleanMathNarration(fragments: readonly string[]): string {
	const seen = new Set<string>();
	const cleaned: string[] = [];
	for (const raw of fragments.flatMap((fragment) => fragment.split(/\r?\n/))) {
		const value = normalizedFragment(raw);
		const key = value.replace(/[，。；！？、：\s]/g, '').toLocaleLowerCase();
		if (!value || seen.has(key)) {
			continue;
		}
		seen.add(key);
		cleaned.push(value.replace(/[，；：]$/, ''));
	}
	return cleaned
		.join('，')
		.replace(/，{2,}/g, '，')
		.replace(/，$/, '');
}
