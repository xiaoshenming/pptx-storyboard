import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import React from 'react';

import type { CanvasSize } from '../../types';
import { SlideThumbnail } from '../SlideThumbnail';
import { storyboardSlideForShot } from './storyboard-model';
import type { StoryboardShot } from './storyboard-model';

interface StoryboardExportStagesProps {
	shots: StoryboardShot[];
	slides: PptxSlide[];
	templateElementsBySlideId: Record<string, PptxElement[]>;
	canvasSize: CanvasSize;
}

export function StoryboardExportStages({
	shots,
	slides,
	templateElementsBySlideId,
	canvasSize,
}: StoryboardExportStagesProps): React.ReactElement {
	const height = Math.round((canvasSize.height / Math.max(canvasSize.width, 1)) * 320);
	return (
		<div className='pointer-events-none fixed -left-[10000px] top-0 opacity-0' aria-hidden='true'>
			{shots.map((shot) => {
				const source = slides[shot.slideIndex];
				const slide = storyboardSlideForShot(source, shot);
				return (
					<div
						key={shot.id}
						data-storyboard-export-shot={shot.id}
						className='overflow-hidden bg-white'
						style={{ width: 320, height }}
					>
						<div style={{ width: 160, transform: 'scale(2)', transformOrigin: 'top left' }}>
							<SlideThumbnail
								slide={slide}
								templateElements={templateElementsBySlideId[source.id] ?? []}
								canvasSize={canvasSize}
							/>
						</div>
					</div>
				);
			})}
		</div>
	);
}
