import type { PptxElement, PptxSlide } from 'pptx-viewer-core';

import type { NarrationMaterial, NarrationOptions, NarrationShotInput } from './contracts';
import { narrationMaterialSchema } from './contracts';

export function narrationElements(elements: PptxElement[]): PptxElement[] {
	return elements.flatMap((el) =>
		el.type === 'group' ? narrationElements(el.children ?? []) : [el],
	);
}
export function narrationElementText(el: PptxElement): string {
	if (el.type === 'table' && el.tableData) {
		return el.tableData.rows
			.map((row) => row.cells.map((cell) => cell.text ?? '').join(' | '))
			.join('\n');
	}
	if ('text' in el && typeof el.text === 'string' && el.text.trim()) {
		return el.text.trim();
	}
	if ('textSegments' in el && el.textSegments) {
		return el.textSegments.map((s) => s.text).join('');
	}
	return '';
}
function clean(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(
			(line) =>
				line &&
				!/(?:https?:\/\/|www\.|第一PPT模板|课后提能训练|自\s*学\s*导\s*引|课\s*堂\s*互\s*动|素\s*养\s*达\s*成)/iu.test(
					line,
				),
		)
		.join('\n');
}
export function buildNarrationMaterial(
	slides: PptxSlide[],
	shots: NarrationShotInput[],
	index: number,
	options: NarrationOptions,
	embeddedTexts: Record<string, string> = {},
): NarrationMaterial {
	const slide = slides[index];
	if (!slide) {
		throw new Error('幻灯片不存在');
	}
	const pageShots = shots.filter((s) => s.slideIndex === index);
	const contents: NarrationMaterial['contents'] = [];
	const aliases = new Map<string, string[]>();
	const byText = new Map<string, string>();
	const warnings: string[] = [];
	const elements = narrationElements(slide.elements);
	for (const el of elements) {
		const text = clean(embeddedTexts[el.id] ?? narrationElementText(el));
		if (!text) {
			if (el.type === 'ole' || el.type === 'image') {
				warnings.push(
					`元素 ${el.id} 含未提取的图片或内嵌内容，可在补充说明中描述；模型不会看到图片。`,
				);
			}
			continue;
		}
		if (/\[[^\]]*未(?:完整)?提取\]/.test(text)) {
			warnings.push(
				`元素 ${el.id} 的内嵌 Word 仅提取了部分内容，图片或旧版公式未提取，请补充说明。`,
			);
		}
		let id = byText.get(text);
		if (!id) {
			id = `c${contents.length + 1}`;
			contents.push({ id, text });
			byText.set(text, id);
		}
		aliases.set(el.id, [id]);
		if (el.shapeId) {
			aliases.set(el.shapeId, [id]);
		}
	}
	function registerGroups(items: PptxElement[]) {
		for (const el of items) {
			if (el.type === 'group') {
				registerGroups(el.children ?? []);
				const ids = [
					...new Set((el.children ?? []).flatMap((child) => aliases.get(child.id) ?? [])),
				];
				aliases.set(el.id, ids);
				if (el.shapeId) {
					aliases.set(el.shapeId, ids);
				}
			}
		}
	}
	registerGroups(slide.elements);
	function visibleIds(items: PptxElement[], hidden: Set<string>): string[] {
		return items.flatMap((el) =>
			hidden.has(el.id) || hidden.has(el.shapeId ?? '')
				? []
				: el.type === 'group'
					? visibleIds(el.children ?? [], hidden)
					: [el.id],
		);
	}
	const context = [index - 1, index + 1]
		.filter((i) => slides[i])
		.map(
			(i) =>
				`第${i + 1}页：${clean(narrationElements(slides[i].elements).map(narrationElementText).join('\n')).slice(0, 700)}`,
		)
		.join('\n');
	const events = pageShots.map((shot) => {
		const hidden = new Set(shot.hiddenElementIds ?? []);
		const ids =
			shot.kind === 'animation'
				? (shot.animationEvents ?? [])
						.filter((e) => e.presetClass !== 'exit')
						.map((e) => e.targetId ?? '')
				: visibleIds(slide.elements, hidden);
		return {
			id: shot.id,
			kind: shot.kind,
			targets: [...new Set(ids.flatMap((id) => aliases.get(id.split('::')[0]) ?? []))],
		};
	});
	const material = {
		version: 1 as const,
		page: index + 1,
		...options,
		context,
		notes: slide.notes ?? '',
		contents,
		events,
		warnings,
	};
	if (JSON.stringify(material).length > 14000) {
		throw new Error(`第 ${index + 1} 页材料过长，请精简补充说明或拆分页面（上限 14000 字符）`);
	}
	return narrationMaterialSchema.parse(material);
}
