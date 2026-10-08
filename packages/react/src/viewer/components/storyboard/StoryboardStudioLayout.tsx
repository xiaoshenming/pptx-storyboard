import React, { useEffect, useRef, useState } from 'react';
import { LuChevronDown, LuChevronUp } from 'react-icons/lu';

interface StoryboardStudioLayoutProps {
	workspace: React.ReactNode;
	timeline: React.ReactNode;
}

export function StoryboardStudioLayout({
	workspace,
	timeline,
}: StoryboardStudioLayoutProps): React.ReactElement {
	const [timelineHeight, setTimelineHeight] = useState(330);
	const [timelineVisible, setTimelineVisible] = useState(true);
	const layoutRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const layout = layoutRef.current;
		if (!layout) {
			return;
		}
		const clampHeight = () => {
			const maximum = Math.max(160, layout.clientHeight - 228);
			setTimelineHeight((current) => Math.min(current, maximum));
		};
		clampHeight();
		const observer = new ResizeObserver(clampHeight);
		observer.observe(layout);
		return () => observer.disconnect();
	}, []);
	return (
		<div ref={layoutRef} className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<div className='flex min-h-[220px] min-w-0 flex-1 overflow-hidden'>{workspace}</div>
			<div className='group flex h-7 shrink-0 cursor-default items-center justify-between border-y border-slate-700 bg-[#20212b] px-2'>
				<span className='text-[11px] text-slate-400'>时间轴</span>
				<button
					type='button'
					onClick={() => setTimelineVisible((visible) => !visible)}
					className='rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white'
					title={timelineVisible ? '隐藏时间轴' : '显示时间轴'}
					aria-label={timelineVisible ? '隐藏时间轴' : '显示时间轴'}
				>
					{timelineVisible ? (
						<LuChevronDown className='h-4 w-4' />
					) : (
						<LuChevronUp className='h-4 w-4' />
					)}
				</button>
			</div>
			{timelineVisible && (
				<div
					role='separator'
					aria-label='调整时间轴高度'
					aria-orientation='horizontal'
					className='group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-slate-700 bg-[#20212b] hover:bg-pink-500/20'
					onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
					onPointerMove={(event) => {
						if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
							return;
						}
						const bounds = layoutRef.current?.getBoundingClientRect();
						if (!bounds) {
							return;
						}
						const maximum = Math.max(160, bounds.height - 228);
						setTimelineHeight(Math.min(maximum, Math.max(160, bounds.bottom - event.clientY)));
					}}
				>
					<span className='h-0.5 w-12 rounded-full bg-slate-500 group-hover:bg-pink-400' />
				</div>
			)}
			{timelineVisible && (
				<div className='min-h-0 shrink-0' style={{ height: timelineHeight }}>
					{timeline}
				</div>
			)}
		</div>
	);
}
