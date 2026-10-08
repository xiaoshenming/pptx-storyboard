import React from 'react';

import type { PageNarrationDraft } from './narration-drafts';
import { narrationProtected } from './narration-drafts';
import type { StoryboardShot } from './storyboard-model';

export function NarrationDraftCards({
	pages,
	shots,
	generated,
	onChange,
	onApply,
	onRetry,
	running,
}: {
	pages: PageNarrationDraft[];
	shots: StoryboardShot[];
	generated: StoryboardShot[];
	running: boolean;
	onChange: (page: number, shotId: string, text: string) => void;
	onApply: (page: PageNarrationDraft) => void;
	onRetry: (page: number) => void;
}) {
	return (
		<div className='space-y-4'>
			{pages.map((page) => (
				<section key={page.page} className='rounded-xl border border-slate-700 bg-slate-900/60 p-4'>
					<div className='mb-3 flex items-center gap-3'>
						<h3 className='font-bold'>
							第 {page.page} 页{' '}
							{page.cached && <span className='text-xs text-slate-500'>已复用草稿</span>}
						</h3>
						<button
							disabled={running}
							onClick={() => onRetry(page.page)}
							className='ml-auto text-sm text-slate-300 hover:text-white disabled:opacity-40'
						>
							重新生成本页
						</button>
						<button
							disabled={running || page.applied}
							onClick={() => onApply(page)}
							className='rounded bg-orange-500 px-3 py-2 text-sm text-white disabled:opacity-40'
						>
							{page.applied ? '已应用' : '应用本页可更新节点'}
						</button>
					</div>
					{page.material.warnings.map((warning, i) => (
						<p key={i} className='mb-2 text-xs text-amber-300'>
							{warning}
						</p>
					))}
					{page.draft.nodes.map((node) => {
						const shot = shots.find((s) => s.id === node.shotId);
						const locked = shot
							? narrationProtected(
									shot,
									generated.find((s) => s.id === shot.id),
								)
							: true;
						return (
							<div key={node.shotId} className='mb-3 rounded-lg bg-slate-950/70 p-3'>
								<p className='mb-2 text-sm font-medium'>
									{shot?.label ?? node.shotId}
									{locked && <span className='ml-2 text-amber-300'>已保护，应用时跳过</span>}
								</p>
								<textarea
									aria-label={`${shot?.label ?? node.shotId} AI 草稿`}
									maxLength={4000}
									disabled={page.applied || running}
									value={node.text}
									onChange={(e) => onChange(page.page, node.shotId, e.target.value)}
									className='min-h-24 w-full rounded border border-slate-600 bg-slate-900 p-2 text-sm leading-6 text-slate-100'
								/>
								<details className='mt-1 text-xs text-slate-500'>
									<summary>查看原讲稿与来源</summary>
									<p className='my-2'>{page.baseline[node.shotId] || '原讲稿为空'}</p>
									{node.sources.map((id) => (
										<p key={id}>{page.material.contents.find((c) => c.id === id)?.text}</p>
									))}
								</details>
							</div>
						);
					})}
				</section>
			))}
		</div>
	);
}
