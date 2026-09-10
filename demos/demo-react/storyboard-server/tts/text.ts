export interface TextChunk {
	text: string;
	startIndex: number;
	endIndex: number;
}

const SENTENCE_END = /[。！？；!?;\n]/u;

export function splitChineseText(text: string, maxCharacters = 150): TextChunk[] {
	if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 150) {
		throw new RangeError('maxCharacters must be an integer between 1 and 150');
	}
	if (!text.trim()) {
		throw new TypeError('text must not be empty');
	}

	const characters = Array.from(text);
	const chunks: TextChunk[] = [];
	let start = 0;
	while (start < characters.length) {
		const hardEnd = Math.min(start + maxCharacters, characters.length);
		let end = hardEnd;
		if (hardEnd < characters.length) {
			for (let cursor = hardEnd - 1; cursor >= start; cursor -= 1) {
				if (SENTENCE_END.test(characters[cursor])) {
					end = cursor + 1;
					break;
				}
			}
		}
		chunks.push({ text: characters.slice(start, end).join(''), startIndex: start, endIndex: end });
		start = end;
	}
	return chunks;
}
