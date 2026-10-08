import { extractEmbeddedWordText } from 'pptx-viewer-core';
import type { PptxSlide } from 'pptx-viewer-core';
import { buildNarrationMaterial, narrationElements, parseNarrationDraft } from 'pptx-viewer-shared';

import { narrationNodePatch, narrationProtected } from './narration-drafts';
import type { StoryboardShot } from './storyboard-model';

export interface AutoPolishNarrationOptions {
	audience: string;
	detail: 'brief' | 'standard' | 'detailed';
	supplement?: string;
}

const POLISH_CONCURRENCY = 3;
const RETRYABLE_STATUS = new Set([409, 429, 500, 502, 503, 504]);

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		globalThis.setTimeout(resolve, ms);
	});
}

async function requestDraft(
	endpoint: string,
	material: ReturnType<typeof buildNarrationMaterial>,
	pageIndex: number,
	signal: AbortSignal,
) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const response = await fetch(endpoint, {
			method: 'POST',
			signal,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ material }),
		});
		const data = (await response.json().catch(() => ({}))) as { draft?: unknown; error?: string };
		if (response.ok) {
			return parseNarrationDraft(data.draft, material);
		}
		if (attempt < 2 && RETRYABLE_STATUS.has(response.status)) {
			await wait(500 * 2 ** attempt);
			continue;
		}
		throw new Error(`第 ${pageIndex + 1} 页润色失败：${data.error || `HTTP ${response.status}`}`);
	}
	throw new Error(`第 ${pageIndex + 1} 页润色失败`);
}

export async function polishStoryboardForVideo(options: {
	endpoint: string;
	slides: PptxSlide[];
	shots: StoryboardShot[];
	generated: StoryboardShot[];
	narrationOptions?: AutoPolishNarrationOptions;
	onProgress?: (done: number, total: number) => void;
}): Promise<Array<{ id: string; patch: Partial<StoryboardShot> }>> {
	const pageIndexes = [...new Set(options.shots.map((shot) => shot.slideIndex))];
	const patchesByPage = new Map<number, Array<{ id: string; patch: Partial<StoryboardShot> }>>();
	const controller = new AbortController();
	let cursor = 0;
	let completed = 0;
	const processPage = async (pageIndex: number) => {
		const embedded: Record<string, string> = {};
		for (const element of narrationElements(options.slides[pageIndex].elements)) {
			if (
				element.type === 'ole' &&
				element.oleEmbeddedData &&
				(element.oleObjectType === 'word' || element.oleEmbeddedFileName?.endsWith('.docx'))
			) {
				try {
					const result = await extractEmbeddedWordText(element.oleEmbeddedData);
					embedded[element.id] = result.text;
				} catch {
					// The material builder reports unavailable embedded content.
				}
			}
		}
		const material = buildNarrationMaterial(
			options.slides,
			options.shots,
			pageIndex,
			{
				audience: options.narrationOptions?.audience.trim() || '学生',
				detail: options.narrationOptions?.detail ?? 'standard',
				supplement: options.narrationOptions?.supplement?.trim() || '',
			},
			embedded,
		);
		const draft = await requestDraft(options.endpoint, material, pageIndex, controller.signal);
		const pagePatches: Array<{ id: string; patch: Partial<StoryboardShot> }> = [];
		for (const node of draft.nodes) {
			const shot = options.shots.find((item) => item.id === node.shotId);
			if (
				shot &&
				!narrationProtected(
					shot,
					options.generated.find((item) => item.id === shot.id),
				)
			) {
				pagePatches.push({ id: shot.id, patch: narrationNodePatch(node, false) });
			}
		}
		patchesByPage.set(pageIndex, pagePatches);
		completed += 1;
		options.onProgress?.(completed, pageIndexes.length);
	};
	const worker = async () => {
		while (!controller.signal.aborted) {
			const position = cursor;
			cursor += 1;
			if (position >= pageIndexes.length) {
				return;
			}
			try {
				await processPage(pageIndexes[position]);
			} catch (error) {
				controller.abort();
				throw error;
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(POLISH_CONCURRENCY, pageIndexes.length) }, () => worker()),
	);
	const patches: Array<{ id: string; patch: Partial<StoryboardShot> }> = [];
	for (const pageIndex of pageIndexes) {
		patches.push(...(patchesByPage.get(pageIndex) ?? []));
	}
	return patches;
}
