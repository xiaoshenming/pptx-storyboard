import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { renderElementToCanvas } from '../../../utils/export-helpers';
import { PresentationStage } from '../../presentation/PresentationStage';
import { compileSlideAnimationExport } from '../animation-export';
import type { CompiledSlideAnimationExport } from '../animation-export';
import type { StoryboardShot } from '../storyboard-model';
import { normalizedConcurrency, runCapturePool } from './capture-pool';
import type { CapturePoolWorker } from './capture-pool';
import type { CapturedStoryboardFrame, CaptureStoryboardShotsOptions } from './types';

const DEFAULT_STAGE_WIDTH = 320;
const DEFAULT_RASTER_SCALE = 4;

interface ShotRenderInput {
	shot: StoryboardShot;
	slide: PptxSlide;
	templateElements: readonly PptxElement[];
}

function positiveNumber(value: number | undefined, fallback: number, label: string): number {
	const resolved = value ?? fallback;
	if (!Number.isFinite(resolved) || resolved <= 0) {
		throw new RangeError(`${label} must be a positive finite number`);
	}
	return resolved;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Storyboard PNG encoding failed'))),
			'image/png',
		);
	});
}

function waitForDomTick(signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = (): void => {
			clearTimeout(timeoutId);
			signal?.removeEventListener('abort', onAbort);
		};
		const onAbort = (): void => {
			cleanup();
			reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
		};
		const timeoutId = window.setTimeout(() => {
			cleanup();
			resolve();
		}, 0);
		signal?.addEventListener('abort', onAbort, { once: true });
		if (signal?.aborted) {
			onAbort();
		}
	});
}

function createOffscreenStage(width: number, height: number): HTMLDivElement {
	const stage = document.createElement('div');
	stage.dataset.storyboardCaptureStage = 'true';
	stage.setAttribute('aria-hidden', 'true');
	Object.assign(stage.style, {
		position: 'fixed',
		left: '-100000px',
		top: '0',
		width: `${width}px`,
		height: `${height}px`,
		overflow: 'hidden',
		pointerEvents: 'none',
		background: '#fff',
	});
	document.body.append(stage);
	return stage;
}

function createReactWorker(
	stageWidth: number,
	stageHeight: number,
	canvasSize: CaptureStoryboardShotsOptions['canvasSize'],
	rasterScale: number,
	signal?: AbortSignal,
): CapturePoolWorker<ShotRenderInput, Blob> {
	const stage = createOffscreenStage(stageWidth, stageHeight);
	const root: Root = createRoot(stage);
	const animationCache = new Map<string, CompiledSlideAnimationExport>();

	return {
		async run(input): Promise<Blob> {
			signal?.throwIfAborted();
			const animation =
				animationCache.get(input.slide.id) ?? compileSlideAnimationExport(input.slide);
			animationCache.set(input.slide.id, animation);
			const states =
				input.shot.kind === 'initial'
					? animation.initialState
					: input.shot.kind === 'animation' && input.shot.clickGroupIndex !== undefined
						? animation.clickGroups[input.shot.clickGroupIndex]?.settledState
						: undefined;
			flushSync(() => {
				root.render(
					<div
						style={{
							width: stageWidth,
							height: stageHeight,
							display: 'flex',
						}}
					>
						<PresentationStage
							activeSlide={input.slide}
							templateElements={input.templateElements as PptxElement[]}
							canvasSize={canvasSize}
							mediaDataUrls={new Map()}
							presentationElementStates={states ? new Map(states) : undefined}
							presentationKeyframesCss={animation.keyframesCss}
						/>
					</div>,
				);
			});
			await waitForDomTick(signal);
			await waitForDomTick(signal);
			signal?.throwIfAborted();
			const canvas = await renderElementToCanvas(stage, rasterScale, '#ffffff');
			signal?.throwIfAborted();
			return canvasToPng(canvas);
		},
		dispose(): void {
			flushSync(() => root.unmount());
			stage.remove();
		},
	};
}

export async function captureStoryboardShotsAsPng({
	shots,
	slides,
	templateElementsBySlideId,
	canvasSize,
	concurrency,
	stageWidth: requestedStageWidth,
	rasterScale: requestedRasterScale,
	signal,
	onProgress,
}: CaptureStoryboardShotsOptions): Promise<CapturedStoryboardFrame[]> {
	const workerCount = normalizedConcurrency(concurrency, shots.length);
	if (shots.length === 0) {
		return [];
	}
	const stageWidth = positiveNumber(requestedStageWidth, DEFAULT_STAGE_WIDTH, 'Stage width');
	const rasterScale = positiveNumber(requestedRasterScale, DEFAULT_RASTER_SCALE, 'Raster scale');
	const canvasWidth = positiveNumber(canvasSize.width, 1, 'Canvas width');
	const canvasHeight = positiveNumber(canvasSize.height, 1, 'Canvas height');
	const stageHeight = Math.max(1, Math.round((canvasHeight / canvasWidth) * stageWidth));
	const inputs = shots.map((shot) => {
		const slide = slides[shot.slideIndex];
		if (!slide) {
			throw new RangeError(
				`Storyboard shot ${shot.id} references missing slide ${shot.slideIndex}`,
			);
		}
		return {
			shot,
			slide,
			templateElements: templateElementsBySlideId[slide.id] ?? [],
		};
	});
	const pngs = await runCapturePool({
		items: inputs,
		concurrency: workerCount,
		signal,
		createWorker: () => createReactWorker(stageWidth, stageHeight, canvasSize, rasterScale, signal),
		onComplete: (_png, index, completed) =>
			onProgress?.({ completed, total: shots.length, index, shotId: shots[index].id }),
	});
	return pngs.map((png, index) => ({ index, shot: shots[index], png }));
}
