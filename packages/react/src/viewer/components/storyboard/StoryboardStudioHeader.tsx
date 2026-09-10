import React from 'react';
import { LuArrowLeft, LuClapperboard, LuFilm, LuLoaderCircle } from 'react-icons/lu';

interface StoryboardStudioHeaderProps {
	fileName?: string;
	projectId: string;
	pageCount: number;
	shotCount: number;
	durationLabel: string;
	saveStatus: 'saving' | 'saved';
	exportStatus: string;
	exporting: boolean;
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
	canGenerate,
	canCancel,
	onClose,
	onGenerate,
	onCancel,
}: StoryboardStudioHeaderProps): React.ReactElement {
	return (
		<header className='flex h-16 shrink-0 items-center border-b border-slate-200 bg-white px-5'>
			<button
				type='button'
				onClick={onClose}
				className='mr-3 rounded-lg p-2 text-slate-500 hover:bg-slate-100'
				title='返回 PPT 编辑器'
			>
				<LuArrowLeft className='h-5 w-5' />
			</button>
			<div className='flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 text-white'>
				<LuClapperboard className='h-5 w-5' />
			</div>
			<div className='ml-3 min-w-0'>
				<h1 className='truncate text-sm font-bold'>PPT 分镜视频工作台</h1>
				<p className='max-w-[420px] truncate text-xs text-slate-400'>
					{fileName || '未命名演示文稿'}
				</p>
			</div>
			<div className='ml-6 hidden items-center gap-4 text-xs text-slate-500 md:flex'>
				<span>{pageCount} 页</span>
				<span>{shotCount} 个分镜</span>
				<span>预计 {durationLabel}</span>
			</div>
			<div className='ml-auto flex items-center gap-3'>
				<span className='hidden text-xs text-emerald-600 sm:inline'>
					● {saveStatus === 'saved' ? '已保存' : '保存中'} · {projectId}
				</span>
				{exportStatus && (
					<span className='hidden max-w-52 truncate text-xs text-slate-500 lg:inline'>
						{exportStatus}
					</span>
				)}
				{canCancel && (
					<button
						type='button'
						onClick={onCancel}
						className='rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50'
					>
						取消
					</button>
				)}
				<button
					type='button'
					onClick={onGenerate}
					disabled={exporting || !canGenerate}
					className='flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-200 hover:opacity-90 disabled:opacity-60'
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
