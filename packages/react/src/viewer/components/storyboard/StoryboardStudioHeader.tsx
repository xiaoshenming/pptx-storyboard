import React from 'react';
import { LuArrowLeft, LuClapperboard, LuFilm, LuLoaderCircle } from 'react-icons/lu';

import type { StoryboardSaveStatus } from './use-storyboard-autosave';

interface StoryboardStudioHeaderProps {
	fileName?: string;
	projectId: string;
	pageCount: number;
	shotCount: number;
	durationLabel: string;
	saveStatus: StoryboardSaveStatus;
	exportStatus: string;
	exporting: boolean;
	jobStatus?: React.ReactNode;
	canGenerate: boolean;
	canCancel: boolean;
	onClose: () => void;
	onGenerate: () => void;
	onCancel: () => void;
}

export function StoryboardStudioHeader({
	fileName,
	projectId,
	pageCount,
	shotCount,
	durationLabel,
	saveStatus,
	exportStatus,
	exporting,
	jobStatus,
	canGenerate,
	canCancel,
	onClose,
	onGenerate,
	onCancel,
}: StoryboardStudioHeaderProps): React.ReactElement {
	return (
		<header className='flex h-14 shrink-0 items-center border-b border-slate-700 bg-[#0c0d12] px-4 text-slate-100'>
			<button
				type='button'
				onClick={onClose}
				className='mr-3 rounded-lg p-2 text-slate-400 hover:bg-white/10'
				title='返回 PPT 编辑器'
			>
				<LuArrowLeft className='h-5 w-5' />
			</button>
			<div className='flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-rose-500 text-white'>
				<LuClapperboard className='h-5 w-5' />
			</div>
			<div className='ml-3 min-w-0'>
				<h1 className='truncate text-sm font-bold'>PPT 分镜视频工作台</h1>
				<p className='max-w-[420px] truncate text-xs text-slate-500'>
					{fileName || '未命名演示文稿'}
				</p>
			</div>
			<div className='ml-6 hidden items-center gap-4 text-xs text-slate-400 md:flex'>
				<span>{pageCount} 页</span>
				<span>{shotCount} 个分镜</span>
				<span>预计 {durationLabel}</span>
			</div>
			<div className='ml-auto flex items-center gap-3'>
				<span
					className={`hidden text-xs sm:inline ${
						saveStatus === 'error' ? 'text-rose-600' : 'text-emerald-600'
					}`}
				>
					● {saveStatus === 'saved' ? '已保存' : saveStatus === 'error' ? '保存失败' : '保存中'} ·{' '}
					{projectId}
				</span>
				{exportStatus && (
					<span title={exportStatus} role='status' className='max-w-72 text-xs text-slate-500'>
						{exportStatus}
					</span>
				)}
				{jobStatus}
				{canCancel && (
					<button
						type='button'
						onClick={onCancel}
						className='rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:bg-white/10'
					>
						取消
					</button>
				)}
				<button
					type='button'
					onClick={onGenerate}
					disabled={exporting || !canGenerate}
					className='flex items-center gap-2 rounded-lg bg-gradient-to-r from-pink-500 to-rose-500 px-5 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60'
				>
					{exporting ? (
						<LuLoaderCircle className='h-4 w-4 animate-spin' />
					) : (
						<LuFilm className='h-4 w-4' />
					)}
					{exporting ? '生成中...' : '生成视频'}
				</button>
			</div>
		</header>
	);
}
