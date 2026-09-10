import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import React from 'react';
import { LuPause, LuPlay, LuRotateCcw } from 'react-icons/lu';

import type { CanvasSize } from '../../types';
import { SlideThumbnail } from '../SlideThumbnail';

interface StoryboardPreviewProps {
	slide: PptxSlide;
	templateElements: PptxElement[];
	canvasSize: CanvasSize;
	isPlaying: boolean;
	onTogglePlay: () => void;
	onRestart: () => void;
	progressMs?: number;
	durationMs?: number;
	stageRef?: React.RefObject<HTMLDivElement | null>;
}

/** Clamped playhead fraction, or undefined when no real timing was passed in. */
function progressRatio(progressMs: number | undefined, durationMs: number | undefined) {
	if (progressMs === undefined || durationMs === undefined || durationMs <= 0) {
		return undefined;
	}
	return Math.min(1, Math.max(0, progressMs / durationMs));
}

export function StoryboardPreview({
	slide,
	templateElements,
	canvasSize,
	isPlaying,
	onTogglePlay,
	onRestart,
	progressMs,
	durationMs,
	stageRef,
}: StoryboardPreviewProps): React.ReactElement {
	const thumbHeight = Math.max(
		56,
		Math.round((canvasSize.height / Math.max(canvasSize.width, 1)) * 160),
	);
	const previewScale = Math.min(4.8, 640 / 160, 410 / thumbHeight);
	const ratio = progressRatio(progressMs, durationMs);
	return (
		<section className='flex min-w-0 flex-1 flex-col bg-[#f4f5f8]'>
			<div className='flex items-center justify-center gap-2 border-b border-slate-200 bg-white px-4 py-2 text-xs text-slate-500'>
				<span className='rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-700'>
					16:9
				</span>
				<span>原 PPT 页面与动画预览</span>
			</div>
			<div className='flex flex-1 items-center justify-center overflow-hidden p-8'>
				<div
					ref={stageRef}
					className='overflow-hidden rounded-lg bg-white shadow-[0_18px_60px_rgba(15,23,42,0.18)] ring-1 ring-slate-200'
					style={{ width: 160 * previewScale, height: thumbHeight * previewScale }}
				>
					<div
						style={{ width: 160, transform: `scale(${previewScale})`, transformOrigin: 'top left' }}
					>
						<SlideThumbnail
							slide={slide}
							templateElements={templateElements}
							canvasSize={canvasSize}
						/>
					</div>
				</div>
			</div>
			<div className='flex items-center justify-center gap-3 border-t border-slate-200 bg-white px-4 py-3'>
				<button
					type='button'
					onClick={onRestart}
					className='rounded-full p-2 text-slate-500 hover:bg-slate-100'
					title='重新播放当前分镜'
				>
					<LuRotateCcw className='h-4 w-4' />
				</button>
				<button
					type='button'
					onClick={onTogglePlay}
					className='flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-700'
					title={isPlaying ? '暂停' : '播放'}
				>
					{isPlaying ? (
						<LuPause className='h-4 w-4' />
					) : (
						<LuPlay className='h-4 w-4 translate-x-px' />
					)}
				</button>
				<div className='h-1.5 w-56 overflow-hidden rounded-full bg-slate-200'>
					{ratio === undefined ? (
						<div
							className={`h-full bg-orange-500 ${
								isPlaying ? 'w-2/3 transition-all duration-[1800ms]' : 'w-1/3'
							}`}
						/>
					) : (
						<div className='h-full bg-orange-500' style={{ width: `${ratio * 100}%` }} />
					)}
				</div>
			</div>
		</section>
	);
}
