import JSZip from 'jszip';
import { PptxHandler } from 'pptx-viewer-core';
import React, { useEffect, useRef, useState } from 'react';
import { LuPresentation } from 'react-icons/lu';

import { SlideThumbnail } from '../../packages/react/src/viewer/components/SlideThumbnail';
import type { LocalProject } from '../../packages/shared/src/render/project-library';
import { partitionTemplateElements } from '../../packages/shared/src/render/template-editing';

interface ParsedCover {
	slide: Awaited<ReturnType<PptxHandler['load']>>['slides'][number];
	templateElements: Awaited<ReturnType<PptxHandler['load']>>['slides'][number]['elements'];
	canvasSize: { width: number; height: number };
}

const imageCache = new Map<string, string>();
let parseQueue = Promise.resolve();

function queued<T>(work: () => Promise<T>): Promise<T> {
	const next = parseQueue.then(work, work);
	parseQueue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

async function embeddedThumbnail(data: Uint8Array): Promise<string | undefined> {
	const zip = await JSZip.loadAsync(data);
	for (const path of [
		'docProps/thumbnail.jpeg',
		'docProps/thumbnail.jpg',
		'docProps/thumbnail.png',
	]) {
		const entry = zip.file(path);
		if (entry) {
			const bytes = await entry.async('uint8array');
			const type = path.endsWith('.png') ? 'image/png' : 'image/jpeg';
			return URL.createObjectURL(new Blob([bytes], { type }));
		}
	}
	return undefined;
}

export function ProjectCover({
	project,
	load,
}: {
	project: LocalProject;
	load: (id: string) => Promise<{ data: Uint8Array }>;
}) {
	const [imageUrl, setImageUrl] = useState<string>();
	const [parsed, setParsed] = useState<ParsedCover>();
	const handlerRef = useRef<PptxHandler>();
	useEffect(() => {
		let cancelled = false;
		const cacheKey = `${project.id}:${project.updatedAt}`;
		const cached = imageCache.get(cacheKey);
		if (cached) {
			setImageUrl(cached);
			return;
		}
		void queued(async () => {
			const { data } = await load(project.id);
			const thumbnail = await embeddedThumbnail(data);
			if (thumbnail) {
				imageCache.set(cacheKey, thumbnail);
				if (!cancelled) {
					setImageUrl(thumbnail);
				}
				return;
			}
			const handler = new PptxHandler();
			const bytes = new Uint8Array(data);
			const result = await handler.load(bytes.buffer, { eagerDecodeImages: true });
			const partition = partitionTemplateElements(result.slides);
			const slide = partition.slides[0];
			if (!slide || cancelled) {
				handler.dispose();
				return;
			}
			handlerRef.current = handler;
			setParsed({
				slide,
				templateElements: partition.templateElementsBySlideId[slide.id] ?? [],
				canvasSize: { width: result.width, height: result.height },
			});
		}).catch(() => undefined);
		return () => {
			cancelled = true;
			handlerRef.current?.dispose();
		};
	}, [load, project.id, project.updatedAt]);

	if (imageUrl) {
		return (
			<img src={imageUrl} alt={`${project.name} 首页`} className='h-full w-full object-cover' />
		);
	}
	if (parsed) {
		return (
			<SlideThumbnail
				slide={parsed.slide}
				templateElements={parsed.templateElements}
				canvasSize={parsed.canvasSize}
			/>
		);
	}
	return (
		<div className='flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 text-slate-500'>
			<LuPresentation className='h-10 w-10 animate-pulse' />
		</div>
	);
}
