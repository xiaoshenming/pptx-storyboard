import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import React from 'react';

import type { CanvasSize } from '../../types';
import { cn } from '../../utils';
import { SlideThumbnail } from '../SlideThumbnail';
import { slideDisplayTitle } from './storyboard-model';
import type { StoryboardShot } from './storyboard-model';

interface StoryboardPageRailProps {
	slides: PptxSlide[];
	shots: StoryboardShot[];
	selectedShot?: StoryboardShot;
	templateElementsBySlideId: Record<string, PptxElement[]>;
	canvasSize: CanvasSize;
	onSelectShot: (shotId: string) => void;
}

export function StoryboardPageRail({
	slides,
	shots,
	selectedShot,
	templateElementsBySlideId,
	canvasSize,
	onSelectShot,
}: StoryboardPageRailProps): React.ReactElement {
	return (
		<aside className='flex min-h-0 w-[320px] shrink-0 flex-col border-r border-slate-700 bg-[#171821] text-slate-100'>
			<div className='flex items-center justify-between border-b border-slate-700 px-4 py-3'>
				<div>
					<h2 className='text-sm font-semibold'>页面</h2>
					<p className='mt-1 text-xs text-slate-500'>宫格浏览 · 点击切换分镜</p>
				</div>
			</div>
			<div className='grid min-h-0 flex-1 auto-rows-max grid-cols-2 gap-3 overflow-y-auto p-3'>
				{slides.map((slide, slideIndex) => {
					const slideShots = shots.filter((shot) => shot.slideIndex === slideIndex);
					const selected = selectedShot?.slideIndex === slideIndex;
					return (
						<button
							key={slide.id}
							type='button'
							onClick={() => onSelectShot(slideShots[0]?.id ?? '')}
							className={cn(
								'min-w-0 rounded-lg border p-1.5 text-left transition',
								selected
									? 'border-pink-500 bg-pink-500/10 ring-1 ring-pink-500/30'
									: 'border-slate-700 bg-slate-900/50 hover:border-slate-500',
							)}
						>
							<SlideThumbnail
								slide={slide}
								templateElements={templateElementsBySlideId[slide.id] ?? []}
								canvasSize={canvasSize}
							/>
							<div className='mt-1.5 flex items-center gap-1.5'>
								<span className='rounded bg-slate-700 px-1.5 py-0.5 text-[9px] text-white'>
									{slideIndex + 1}
								</span>
								<span className='min-w-0 flex-1 truncate text-[10px] font-medium text-slate-300'>
									{slideDisplayTitle(slide, slideIndex)}
								</span>
								<span className='text-[9px] text-pink-400'>{slideShots.length} 镜</span>
							</div>
						</button>
					);
				})}
			</div>
		</aside>
	);
}
