import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import React from 'react';
import { LuSparkles } from 'react-icons/lu';

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
		<aside className='w-[280px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4'>
			<div className='mb-4 flex items-center justify-between'>
				<div>
					<h2 className='font-bold'>页面与分镜</h2>
					<p className='text-xs text-slate-400'>PPT 动画已自动拆分</p>
				</div>
				<LuSparkles className='text-orange-500' />
			</div>
			<div className='space-y-3'>
				{slides.map((slide, slideIndex) => {
					const slideShots = shots.filter((shot) => shot.slideIndex === slideIndex);
					const selected = selectedShot?.slideIndex === slideIndex;
					return (
						<button
							key={slide.id}
							type='button'
							onClick={() => onSelectShot(slideShots[0]?.id ?? '')}
							className={cn(
								'w-full rounded-xl border p-2 text-left transition',
								selected
									? 'border-orange-400 bg-orange-50'
									: 'border-slate-200 hover:border-slate-300',
							)}
						>
							<SlideThumbnail
								slide={slide}
								templateElements={templateElementsBySlideId[slide.id] ?? []}
								canvasSize={canvasSize}
							/>
							<div className='mt-2 flex items-center gap-2'>
								<span className='rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white'>
									{slideIndex + 1}
								</span>
								<span className='min-w-0 flex-1 truncate text-xs font-semibold'>
									{slideDisplayTitle(slide, slideIndex)}
								</span>
								<span className='text-[10px] text-orange-600'>{slideShots.length} 镜</span>
							</div>
						</button>
					);
				})}
			</div>
		</aside>
	);
}
