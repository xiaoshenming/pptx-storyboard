import { extractEmbeddedWordText } from 'pptx-viewer-core';
import type { PptxSlide } from 'pptx-viewer-core';
import { buildNarrationMaterial, narrationElements, parseNarrationDraft } from 'pptx-viewer-shared';
import type { NarrationDraft, NarrationOptions } from 'pptx-viewer-shared';
import { useEffect, useRef, useState } from 'react';

import type { NarrationConnection, PageNarrationDraft } from './narration-drafts';
import type { StoryboardShot } from './storyboard-model';

export function useAiNarration(options: {
	endpoint: string;
	slides: PptxSlide[];
	shots: StoryboardShot[];
	connection?: NarrationConnection;
	settings: NarrationOptions;
	cache: Map<string, NarrationDraft>;
}) {
	const [drafts, setDrafts] = useState<PageNarrationDraft[]>([]);
	const [errors, setErrors] = useState<string[]>([]);
	const [running, setRunning] = useState(false);
	const [progress, setProgress] = useState('');
	const abortRef = useRef<AbortController | null>(null);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			abortRef.current?.abort();
		};
	}, []);

	async function run(indices: number[], force = false) {
		if (abortRef.current) {
			return;
		}
		const controller = new AbortController();
		abortRef.current = controller;
		setRunning(true);
		setErrors([]);
		try {
			for (let i = 0; i < indices.length; i++) {
				if (controller.signal.aborted) {
					break;
				}
				const index = indices[i];
				setProgress(`正在生成第 ${index + 1} 页 · ${i + 1}/${indices.length}（单请求排队）`);
				try {
					const embedded: Record<string, string> = {};
					for (const el of narrationElements(options.slides[index].elements)) {
						if (
							el.type === 'ole' &&
							el.oleEmbeddedData &&
							(el.oleObjectType === 'word' || el.oleEmbeddedFileName?.endsWith('.docx'))
						) {
							try {
								const result = await extractEmbeddedWordText(el.oleEmbeddedData);
								embedded[el.id] = result.text + (result.incomplete ? '\n[内嵌内容未完整提取]' : '');
							} catch {
								/* material builder reports the gap */
							}
						}
					}
					controller.signal.throwIfAborted();
					const material = buildNarrationMaterial(
						options.slides,
						options.shots,
						index,
						options.settings,
						embedded,
					);
					const baseline = Object.fromEntries(
						options.shots.filter((s) => s.slideIndex === index).map((s) => [s.id, s.script]),
					);
					const cacheKey = JSON.stringify([
						material,
						options.connection?.baseURL ?? 'server',
						options.connection?.model ?? 'server',
					]);
					let draft = force ? undefined : options.cache.get(cacheKey);
					const cached = Boolean(draft);
					if (!draft) {
						const response = await fetch(options.endpoint, {
							method: 'POST',
							signal: controller.signal,
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ material, connection: options.connection }),
						});
						const data = (await response.json()) as { draft?: unknown; error?: string };
						if (!response.ok) {
							throw new Error(data.error || `HTTP ${response.status}`);
						}
						draft = parseNarrationDraft(data.draft, material);
						options.cache.set(cacheKey, draft);
						if (options.cache.size > 80) {
							options.cache.delete(options.cache.keys().next().value!);
						}
					}
					controller.signal.throwIfAborted();
					setDrafts((current) =>
						[
							...current.filter((d) => d.page !== index + 1),
							{ page: index + 1, material, draft: structuredClone(draft), baseline, cached },
						].sort((a, b) => a.page - b.page),
					);
				} catch (error) {
					if (controller.signal.aborted) {
						break;
					}
					setErrors((current) => [
						...current,
						`第 ${index + 1} 页：${error instanceof Error ? error.message : '生成失败'}`,
					]);
					// Stop on failure instead of repeating a bad credential/request for every page.
					break;
				}
			}
		} finally {
			abortRef.current = null;
			if (alive.current) {
				setRunning(false);
				setProgress(
					controller.signal.aborted
						? '已停止，已完成草稿保留'
						: '本轮结束；草稿尚未应用的部分不会改变原讲稿',
				);
			}
		}
	}
	return {
		drafts,
		setDrafts,
		errors,
		running,
		progress,
		run,
		cancel: () => abortRef.current?.abort(),
	};
}
