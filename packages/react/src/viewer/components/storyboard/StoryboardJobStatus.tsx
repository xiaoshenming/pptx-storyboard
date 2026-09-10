import React, { useState } from 'react';
import {
	LuChevronDown,
	LuChevronUp,
	LuCircleCheck,
	LuCircleX,
	LuClock3,
	LuLoaderCircle,
} from 'react-icons/lu';

import type { StoryboardJobProgress } from './storyboard-job-client';

interface StoryboardJobStatusProps {
	job: StoryboardJobProgress;
	onCancel?: () => void;
}

function StatusIcon({ status }: { status: string }): React.ReactElement {
	if (status === 'succeeded') {
		return <LuCircleCheck className='text-emerald-500' />;
	}
	if (status === 'failed' || status === 'cancelled') {
		return <LuCircleX className='text-red-500' />;
	}
	if (status === 'running') {
		return <LuLoaderCircle className='animate-spin text-orange-500' />;
	}
	return <LuClock3 className='text-slate-400' />;
}

const stageLabels: Record<string, string> = {
	queued: '排队中',
	preparing: '准备素材',
	synthesizing: '并行配音',
	rendering: '并行渲染',
	muxing: '合成音画',
	completed: '已完成',
	failed: '失败',
	cancelled: '已取消',
};

export function StoryboardJobStatus({
	job,
	onCancel,
}: StoryboardJobStatusProps): React.ReactElement {
	const [expanded, setExpanded] = useState(true);
	return (
		<div className='absolute right-4 top-20 z-50 w-[390px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl'>
			<button
				type='button'
				onClick={() => setExpanded((value) => !value)}
				className='flex w-full items-center gap-3 px-4 py-3 text-left'
			>
				<StatusIcon status={job.stage === 'completed' ? 'succeeded' : job.stage} />
				<div className='min-w-0 flex-1'>
					<div className='flex items-center gap-2 text-sm font-semibold'>
						<span>视频任务</span>
						<code className='truncate text-[10px] text-slate-400'>{job.id}</code>
					</div>
					<div className='mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100'>
						<div
							className='h-full bg-gradient-to-r from-orange-500 to-rose-500 transition-all'
							style={{ width: `${job.progress}%` }}
						/>
					</div>
				</div>
				<span className='text-xs text-slate-500'>{job.progress}%</span>
				{expanded ? <LuChevronUp /> : <LuChevronDown />}
			</button>
			{expanded && (
				<div className='max-h-64 overflow-y-auto border-t border-slate-100 px-4 py-2'>
					<div className='mb-2 flex items-center text-xs text-slate-500'>
						<span>阶段：{stageLabels[job.stage] ?? job.stage}</span>
						{onCancel && !['completed', 'failed', 'cancelled'].includes(job.stage) && (
							<button type='button' onClick={onCancel} className='ml-auto text-red-500'>
								取消任务
							</button>
						)}
					</div>
					{job.execution && (
						<div className='mb-2 rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600'>
							{job.execution.encoder === 'h264_nvenc' ? 'GPU NVENC' : 'CPU x264'} · 渲染
							{job.execution.renderConcurrency} 路 · 配音 {job.execution.ttsConcurrency} 路 · 用时{' '}
							{(job.execution.elapsedMs / 1000).toFixed(1)} 秒 / 成片{' '}
							{(job.execution.outputDurationMs / 1000).toFixed(1)} 秒
							{job.execution.outputSha256 && job.execution.outputBytes !== undefined && (
								<div className='mt-1 truncate text-[10px] text-slate-400'>
									SHA {job.execution.outputSha256.slice(0, 12)} ·{' '}
									{(job.execution.outputBytes / 1024 / 1024).toFixed(2)} MB
								</div>
							)}
						</div>
					)}
					{job.tasks.map((task) => (
						<div
							key={task.id}
							className='flex items-center gap-2 border-t border-slate-50 py-1.5 text-[11px]'
						>
							<StatusIcon status={task.status} />
							<span className='w-12 text-slate-500'>{task.kind}</span>
							<code className='min-w-0 flex-1 truncate text-slate-600'>{task.id}</code>
							<span>{task.progress}%</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
