import React, { useEffect, useId, useRef, useState } from 'react';
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
	const panelRef = useRef<HTMLDivElement>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const detailsId = useId();
	const previousJobId = useRef(job.id);
	useEffect(() => {
		if (previousJobId.current !== job.id) {
			previousJobId.current = job.id;
			setExpanded(true);
		}
	}, [job.id]);
	useEffect(() => {
		if (!expanded) {
			return;
		}
		const outside = (event: PointerEvent) => {
			if (event.target instanceof Node && !panelRef.current?.contains(event.target)) {
				setExpanded(false);
			}
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				toggleRef.current?.focus();
				setExpanded(false);
			}
		};
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('keydown', escape, true);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('keydown', escape, true);
		};
	}, [expanded]);
	return (
		<div ref={panelRef} className='relative'>
			<button
				ref={toggleRef}
				type='button'
				aria-expanded={expanded}
				aria-controls={detailsId}
				aria-label={expanded ? '收起视频生成进度' : '查看视频生成进度'}
				onClick={() => setExpanded((value) => !value)}
				className='flex w-56 items-center gap-2 rounded-lg border border-slate-700 bg-[#171821] px-3 py-2 text-left shadow-lg hover:border-slate-500'
			>
				<StatusIcon status={job.stage === 'completed' ? 'succeeded' : job.stage} />
				<div className='min-w-0 flex-1'>
					<div className='flex items-center gap-2 text-xs font-semibold'>
						<span>{stageLabels[job.stage] ?? '视频任务'}</span>
					</div>
					<div className='mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100'>
						<div
							className='h-full bg-gradient-to-r from-orange-500 to-rose-500 transition-all'
							style={{ width: `${job.progress}%` }}
						/>
					</div>
				</div>
				<span className='text-xs text-slate-400'>{job.progress}%</span>
				{expanded ? <LuChevronUp /> : <LuChevronDown />}
			</button>
			{expanded && (
				<div
					id={detailsId}
					className='absolute right-0 top-[calc(100%+0.5rem)] z-50 max-h-72 w-96 overflow-y-auto rounded-lg border border-slate-700 bg-[#171821] px-3 py-2 shadow-2xl'
				>
					<div className='mb-2 flex items-center text-xs text-slate-400'>
						<div className='min-w-0'>
							<div>阶段：{stageLabels[job.stage] ?? job.stage}</div>
							<code className='block max-w-64 truncate text-[10px] text-slate-500'>{job.id}</code>
						</div>
						{onCancel && !['completed', 'failed', 'cancelled'].includes(job.stage) && (
							<button type='button' onClick={onCancel} className='ml-auto text-red-500'>
								取消任务
							</button>
						)}
					</div>
					{job.execution && (
						<div className='mb-2 rounded-md bg-slate-900 px-2 py-1.5 text-[11px] text-slate-300'>
							{job.execution.encoder === 'h264_nvenc' ? 'GPU NVENC' : 'CPU x264'} ·{' '}
							{job.execution.ttsProvider === 'edge-tts'
								? '晓晓神经语音'
								: job.execution.ttsProvider === 'local-espeak'
									? '本地普通话'
									: job.execution.ttsProvider === 'tencent-cloud'
										? '腾讯云TTS'
										: job.execution.ttsProvider === 'aliyun-compatible'
											? '阿里云百炼TTS'
											: '测试配音'}{' '}
							· 渲染
							{job.execution.renderConcurrency} 路 · 配音 {job.execution.ttsConcurrency} 路 · 用时{' '}
							{(job.execution.elapsedMs / 1000).toFixed(1)} 秒 / 成片{' '}
							{(job.execution.outputDurationMs / 1000).toFixed(1)} 秒
							{job.execution.ttsElapsedMs !== undefined && (
								<div className='mt-1 text-[10px] text-slate-400'>
									配音 {(job.execution.ttsElapsedMs / 1000).toFixed(1)} 秒 · 编码及校验{' '}
									{((job.execution.elapsedMs - job.execution.ttsElapsedMs) / 1000).toFixed(1)} 秒
								</div>
							)}
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
							className='flex items-center gap-2 border-t border-slate-700 py-1.5 text-[11px]'
						>
							<StatusIcon status={task.status} />
							<span className='w-12 text-slate-500'>{task.kind}</span>
							<code className='min-w-0 flex-1 truncate text-slate-400'>{task.id}</code>
							<span>{task.progress}%</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
