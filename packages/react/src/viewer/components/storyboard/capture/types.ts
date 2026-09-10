import type { PptxElement, PptxSlide } from 'pptx-viewer-core';

import type { CanvasSize } from '../../../types';
import type { StoryboardShot } from '../storyboard-model';

export interface StoryboardCaptureProgress {
	completed: number;
	total: number;
	index: number;
	shotId: string;
}

export interface CapturedStoryboardFrame {
	index: number;
	shot: StoryboardShot;
	png: Blob;
}

export interface CaptureStoryboardShotsOptions {
	shots: readonly StoryboardShot[];
	slides: readonly PptxSlide[];
	templateElementsBySlideId: Readonly<Record<string, readonly PptxElement[]>>;
	canvasSize: CanvasSize;
	/** Requested root count. Defaults to 3 and is always capped at 4. */
	concurrency?: number;
	/** Width of the offscreen capture stage in CSS pixels. Defaults to 320. */
	stageWidth?: number;
	/** Raster scale passed to html2canvas. Defaults to 4. */
	rasterScale?: number;
	signal?: AbortSignal;
	onProgress?: (progress: StoryboardCaptureProgress) => void;
}
