import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import React, { useEffect, useRef, useState } from 'react';
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
	subtitleText?: string;
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
	subtitleText,
	stageRef,
}: StoryboardPreviewProps): React.ReactElement {
	const viewportRef = useRef<HTMLDivElement>(null);
	const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
	useEffect(() => {
		const element = viewportRef.current;
		if (!element) {
			return;
		}
		const update = () =>
			setViewportSize({ width: element.clientWidth, height: element.clientHeight });
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const thumbHeight = Math.max(
		56,
		Math.round((canvasSize.height / Math.max(canvasSize.width, 1)) * 160),
	);
	const previewScale = Math.max(
		0.1,
		Math.min(5.4, (viewportSize.width - 40) / 160, (viewportSize.height - 40) / thumbHeight),
	);
	const ratio = progressRatio(progressMs, durationMs);
	return (
		<section className='flex min-h-0 min-w-0 flex-1 flex-col bg-[#101117] text-slate-200'>
			<div className='flex items-center justify-center gap-2 border-b border-slate-700 bg-[#171821] px-4 py-2 text-xs text-slate-400'>
				<span className='rounded-md border border-slate-600 px-2 py-1 font-medium text-slate-200'>
					16:9
				</span>
				<span>原 PPT 页面与动画预览</span>
			</div>
			<div
				ref={viewportRef}
				className='flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5'
			>
				<div
					ref={stageRef}
					className='relative overflow-hidden rounded-md bg-white shadow-[0_22px_70px_rgba(0,0,0,0.55)] ring-1 ring-white/10'
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
					{subtitleText?.trim() && (
						<div className='pointer-events-none absolute inset-x-[6%] bottom-[4%] flex justify-center'>
							<p className='line-clamp-2 rounded-md bg-black/75 px-3 py-1.5 text-center text-[clamp(12px,1.3vw,22px)] font-medium leading-relaxed text-white shadow-lg [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]'>
								{subtitleText.trim()}
							</p>
						</div>
					)}
				</div>
			</div>
			<div className='flex items-center justify-center gap-3 border-t border-slate-700 bg-[#171821] px-4 py-2.5'>
				<button
					type='button'
					onClick={onRestart}
					className='rounded-full p-2 text-slate-400 hover:bg-white/10'
					title='重新播放当前分镜'
				>
					<LuRotateCcw className='h-4 w-4' />
				</button>
				<button
					type='button'
					onClick={onTogglePlay}
					className='flex h-9 w-9 items-center justify-center rounded-full bg-pink-500 text-white hover:bg-pink-400'
					title={isPlaying ? '暂停' : '播放'}
				>
					{isPlaying ? (
						<LuPause className='h-4 w-4' />
					) : (
						<LuPlay className='h-4 w-4 translate-x-px' />
					)}
				</button>
				<div className='h-1.5 w-56 overflow-hidden rounded-full bg-slate-700'>
					{ratio === undefined ? (
						<div
							className={`h-full bg-pink-500 ${
								isPlaying ? 'w-2/3 transition-all duration-[1800ms]' : 'w-1/3'
							}`}
						/>
					) : (
						<div className='h-full bg-pink-500' style={{ width: `${ratio * 100}%` }} />
					)}
				</div>
			</div>
		</section>
	);
}
