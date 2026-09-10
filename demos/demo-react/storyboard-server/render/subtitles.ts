export interface StoryboardWordBoundary {
	text: string;
	startMs: number;
	endMs: number;
}

export interface StoryboardNarrationCue {
	text: string;
	startMs: number;
	endMs: number;
}

function srtTime(ms: number): string {
	const value = Math.max(0, Math.round(ms));
	const hours = Math.floor(value / 3_600_000);
	const minutes = Math.floor((value % 3_600_000) / 60_000);
	const seconds = Math.floor((value % 60_000) / 1000);
	const millis = value % 1000;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function wordsToSrt(words: StoryboardWordBoundary[]): string {
	const cues: StoryboardWordBoundary[][] = [];
	let current: StoryboardWordBoundary[] = [];
	for (const word of [...words].sort((left, right) => left.startMs - right.startMs)) {
		if (word.endMs <= word.startMs) {
			continue;
		}
		current.push(word);
		const text = current.map((item) => item.text).join('');
		const readableBoundary = !/[a-zA-Z0-9]$/u.test(text);
		if (
			/[。！？!?；;]$/u.test(text) ||
			(text.length >= 18 && readableBoundary) ||
			text.length >= 32
		) {
			cues.push(current);
			current = [];
		}
	}
	if (current.length) {
		cues.push(current);
	}
	let previousEndMs = 0;
	return cues
		.map((cue, index) => {
			const first = cue[0];
			const last = cue[cue.length - 1];
			const startMs = Math.max(previousEndMs, first.startMs);
			const endMs = Math.max(startMs + 1, last.endMs);
			previousEndMs = endMs;
			return `${index + 1}\n${srtTime(startMs)} --> ${srtTime(endMs)}\n${cue.map((item) => item.text).join('')}\n`;
		})
		.join('\n');
}

function splitNarration(text: string, limit = 22): string[] {
	const parts = text.match(/[^，。！？；,.!?;]+[，。！？；,.!?;]?/gu) ?? [text];
	const cues: string[] = [];
	let current = '';
	for (const part of parts.map((item) => item.trim()).filter(Boolean)) {
		if (current && current.length + part.length > limit) {
			cues.push(current);
			current = part;
		} else {
			current += part;
		}
	}
	if (current) {
		cues.push(current);
	}
	return cues;
}

export function narrationToSrt(narrations: StoryboardNarrationCue[]): string {
	let cueIndex = 0;
	let previousEndMs = 0;
	return [...narrations]
		.sort((left, right) => left.startMs - right.startMs)
		.flatMap((narration) => {
			const parts = splitNarration(narration.text);
			const totalCharacters = parts.reduce((sum, part) => sum + part.length, 0);
			let elapsedCharacters = 0;
			return parts.map((part) => {
				const nominalStart =
					narration.startMs +
					((narration.endMs - narration.startMs) * elapsedCharacters) / totalCharacters;
				elapsedCharacters += part.length;
				const nominalEnd =
					narration.startMs +
					((narration.endMs - narration.startMs) * elapsedCharacters) / totalCharacters;
				const startMs = Math.max(previousEndMs, nominalStart);
				const endMs = Math.max(startMs + 1, nominalEnd);
				previousEndMs = endMs;
				cueIndex += 1;
				return `${cueIndex}\n${srtTime(startMs)} --> ${srtTime(endMs)}\n${part}\n`;
			});
		})
		.join('\n');
}
