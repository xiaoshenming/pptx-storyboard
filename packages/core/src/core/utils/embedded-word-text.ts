import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';

/** Read embedded DOCX locally. Unknown equation/image objects remain explicit gaps. */
export async function extractEmbeddedWordText(
	dataUrl: string,
): Promise<{ text: string; incomplete: boolean }> {
	const base64 = dataUrl.split(',')[1];
	if (
		!dataUrl.startsWith('data:') ||
		!dataUrl.includes(';base64,') ||
		!base64 ||
		base64.length > 6_000_000
	) {
		throw new Error('内嵌 Word 无法读取或过大');
	}
	const zip = await JSZip.loadAsync(base64, { base64: true });
	const file = zip.file('word/document.xml');
	if (!file) {
		throw new Error('不是可读取的 DOCX 文档');
	}
	const xml = await file.async('string');
	if (xml.length > 1_000_000) {
		throw new Error('内嵌 Word 文本过大');
	}
	const nodes = new XMLParser({
		preserveOrder: true,
		ignoreAttributes: true,
		parseTagValue: false,
	}).parse(xml) as Node[];
	let incomplete = false;
	function render(list: Node[], depth = 0): string {
		if (depth > 80) {
			incomplete = true;
			return '[嵌套内容未提取]';
		}
		return list
			.map((node) => {
				const tag = Object.keys(node)[0];
				const value = node[tag];
				if (tag === '#text') {
					return String(value);
				}
				const children = Array.isArray(value) ? (value as Node[]) : [];
				const child = (name: string) =>
					render(
						children.flatMap((n) => (Array.isArray(n[name]) ? (n[name] as Node[]) : [])),
						depth + 1,
					);
				if (['w:object', 'w:pict', 'w:drawing'].includes(tag)) {
					incomplete = true;
					return '[图片或旧版公式未提取]';
				}
				if (tag === 'm:f') {
					return `(${child('m:num')})/(${child('m:den')})`;
				}
				if (tag === 'm:sSup') {
					return `${child('m:e')}^(${child('m:sup')})`;
				}
				if (tag === 'm:sSub') {
					return `${child('m:e')}_(${child('m:sub')})`;
				}
				if (tag === 'm:sSubSup') {
					return `${child('m:e')}_(${child('m:sub')})^(${child('m:sup')})`;
				}
				if (tag === 'm:rad') {
					return `root(${child('m:e')}${child('m:deg') ? `,${child('m:deg')}` : ''})`;
				}
				if (tag.endsWith('Pr') || tag === 'w:instrText') {
					return '';
				}
				if (
					tag.startsWith('m:') &&
					![
						'm:oMath',
						'm:oMathPara',
						'm:r',
						'm:t',
						'm:e',
						'm:num',
						'm:den',
						'm:sub',
						'm:sup',
						'm:deg',
					].includes(tag)
				) {
					incomplete = true;
					return '[复杂公式未提取]';
				}
				return render(children, depth + 1) + (tag === 'w:p' ? '\n' : tag === 'w:tc' ? ' | ' : '');
			})
			.join('');
	}
	return { text: render(nodes).trim(), incomplete };
}
interface Node {
	[key: string]: unknown;
}
