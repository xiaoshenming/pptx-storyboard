import type { PptxSlide } from 'pptx-viewer-core';
import type { NarrationDraft, NarrationOptions } from 'pptx-viewer-shared';
import React, { useEffect, useState, useTransition } from 'react';

import { collectNarrationApplication } from './narration-drafts';
import type { NarrationConnection, PageNarrationDraft } from './narration-drafts';
import { NarrationConnectionFields } from './NarrationConnectionFields';
import { NarrationDraftCards } from './NarrationDraftCards';
import type { StoryboardShot } from './storyboard-model';
import { useAiNarration } from './use-ai-narration';

export function NarrationWorkspace({
	endpoint,
	slides,
	shots,
	generated,
	currentPage,
	cache,
	onApply,
	onClose,
}: {
	endpoint: string;
	slides: PptxSlide[];
	shots: StoryboardShot[];
	generated: StoryboardShot[];
	currentPage: number;
	cache: Map<string, NarrationDraft>;
	onApply: (nodes: NarrationDraft['nodes'], editedShotIds: string[]) => void;
	onClose: () => void;
}) {
	const [connection, setConnection] = useState<NarrationConnection>({
		baseURL: 'https://api.deepseek.com',
		model: 'deepseek-chat',
		apiKey: '',
	});
	const [serverConfigured, setServerConfigured] = useState(false);
	const [useServer, setUseServer] = useState(false);
	const [scope, setScope] = useState('current');
	const [settings, setSettings] = useState<NarrationOptions>({
		audience: '高中学生',
		detail: 'standard',
		supplement: '',
	});
	const [notice, setNotice] = useState('');
	const [applying, startApplying] = useTransition();
	const job = useAiNarration({
		endpoint,
		slides,
		shots,
		connection: useServer ? undefined : connection,
		settings,
		cache,
	});
	useEffect(() => {
		const controller = new AbortController();
		void fetch(endpoint, { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) {
					throw new Error('配置状态读取失败');
				}
				const data = (await response.json()) as { configured?: boolean };
				setServerConfigured(Boolean(data.configured));
				setUseServer(Boolean(data.configured));
				return undefined;
			})
			.catch((error) => {
				if (!controller.signal.aborted) {
					setNotice(String(error));
				}
			});
		return () => controller.abort();
	}, [endpoint]);
	const canGenerate = useServer
		? serverConfigured
		: Boolean(connection.apiKey.trim() && connection.baseURL.trim() && connection.model.trim());
	const pages = scope === 'current' ? [currentPage] : [...new Set(shots.map((s) => s.slideIndex))];
	function apply(draftPages: PageNarrationDraft[]) {
		const result = collectNarrationApplication(draftPages, shots, generated);
		onApply(result.nodes, result.editedShotIds);
		job.setDrafts((current) =>
			current.map((p) => (result.pageNumbers.includes(p.page) ? { ...p, applied: true } : p)),
		);
		setNotice(
			`已处理 ${result.pageNumbers.length} 页，应用 ${result.nodes.length} 个节点，跳过 ${result.skipped} 个受保护或已变化节点。`,
		);
	}

	return (
		<div
			className='fixed inset-0 z-[400] flex items-center justify-center bg-black/70 p-5 text-slate-100'
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === 'Escape') {
					job.cancel();
					onClose();
				}
			}}
		>
			<section
				role='dialog'
				aria-modal='true'
				aria-label='AI 讲稿工作台'
				className='flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#171821] shadow-2xl'
			>
				<header className='flex items-center border-b border-slate-700 bg-[#111219] px-6 py-4'>
					<div>
						<h2 className='text-xl font-bold'>AI 讲稿工作台</h2>
						<p className='mt-1 text-xs text-slate-500'>
							按页理解内容与动画顺序，生成草稿后再应用；不会自动覆盖原稿。
						</p>
					</div>
					<button
						autoFocus
						aria-label='关闭 AI 讲稿工作台'
						onClick={() => {
							job.cancel();
							onClose();
						}}
						className='ml-auto rounded px-3 py-2 text-slate-300 hover:bg-white/10'
					>
						关闭
					</button>
				</header>
				<div className='space-y-4 overflow-y-auto bg-[#171821] p-6'>
					<fieldset disabled={job.running} className='space-y-3 disabled:opacity-70'>
						<NarrationConnectionFields
							value={connection}
							onChange={setConnection}
							serverConfigured={serverConfigured}
							useServer={useServer}
							onUseServer={setUseServer}
						/>
						<div className='grid gap-3 md:grid-cols-3'>
							<label className='text-sm'>
								生成范围
								<select
									aria-label='讲稿生成范围'
									value={scope}
									onChange={(e) => setScope(e.target.value)}
									className='mt-1 w-full rounded border border-slate-600 bg-slate-900 p-2 text-slate-100'
								>
									<option value='current'>当前页（第 {currentPage + 1} 页）</option>
									<option value='all'>全部页（逐页排队）</option>
								</select>
							</label>
							<label className='text-sm'>
								教学对象
								<input
									aria-label='讲稿教学对象'
									value={settings.audience}
									maxLength={120}
									onChange={(e) => setSettings({ ...settings, audience: e.target.value })}
									className='mt-1 w-full rounded border border-slate-600 bg-slate-900 p-2 text-slate-100'
								/>
							</label>
							<label className='text-sm'>
								讲解程度
								<select
									aria-label='讲稿详细程度'
									value={settings.detail}
									onChange={(e) =>
										setSettings({
											...settings,
											detail: e.target.value as NarrationOptions['detail'],
										})
									}
									className='mt-1 w-full rounded border border-slate-600 bg-slate-900 p-2 text-slate-100'
								>
									<option value='brief'>简明</option>
									<option value='standard'>一般讲解</option>
									<option value='detailed'>详细解释</option>
								</select>
							</label>
						</div>
						<label className='block text-sm'>
							补充说明（图片含义、跨页条件；全部页模式下会用于每页）
							<textarea
								aria-label='讲稿补充说明'
								maxLength={2000}
								value={settings.supplement}
								onChange={(e) => setSettings({ ...settings, supplement: e.target.value })}
								className='mt-1 h-20 w-full rounded border border-slate-600 bg-slate-900 p-2 text-slate-100'
							/>
						</label>
					</fieldset>
					<div className='flex items-center gap-3'>
						<button
							disabled={job.running || !canGenerate}
							onClick={() => {
								setNotice('');
								void job.run(pages);
							}}
							className='rounded-lg bg-orange-500 px-5 py-2 font-semibold text-white disabled:opacity-40'
						>
							生成讲解草稿
						</button>
						{job.running && (
							<button
								onClick={job.cancel}
								className='rounded border border-slate-600 px-3 py-2 hover:bg-white/10'
							>
								停止生成
							</button>
						)}
						<span className='text-xs text-slate-500'>
							并发 1 · 每页最多 14000 字符 · 相同材料复用会话缓存
						</span>
					</div>
					{!canGenerate && (
						<p className='text-sm text-amber-300'>
							请先填写模型配置；未配置时不会用模板稿冒充 AI 结果。
						</p>
					)}
					{applying && <p role='status'>正在应用讲稿并更新时间轴…</p>}
					{job.progress && (
						<p role='status' className='text-sm'>
							{job.progress}
						</p>
					)}
					{notice && (
						<p role='status' className='rounded bg-blue-500/10 p-3 text-sm text-blue-200'>
							{notice}
						</p>
					)}
					{job.errors.map((error, i) => (
						<p role='alert' key={i} className='rounded bg-red-500/10 p-3 text-sm text-red-200'>
							{error}。原讲稿未改变，可修正后再次生成。
						</p>
					))}
					<button
						disabled={job.running || applying || !job.drafts.some((p) => !p.applied)}
						onClick={() => startApplying(() => apply(job.drafts))}
						className='rounded-lg bg-orange-500 px-4 py-2 text-white disabled:opacity-40'
					>
						一键应用所有已生成页
					</button>
					<NarrationDraftCards
						pages={job.drafts}
						shots={shots}
						generated={generated}
						running={job.running || applying}
						onApply={(page) => startApplying(() => apply([page]))}
						onRetry={(page) => void job.run([page - 1], true)}
						onChange={(page, shotId, text) =>
							job.setDrafts((current) =>
								current.map((p) =>
									p.page === page
										? {
												...p,
												editedShotIds: [...new Set([...(p.editedShotIds ?? []), shotId])],
												draft: {
													nodes: p.draft.nodes.map((n) =>
														n.shotId === shotId ? { ...n, text } : n,
													),
												},
											}
										: p,
								),
							)
						}
					/>
					<p className='text-xs text-slate-500'>
						应用后自动保存到项目，并更新讲稿/字幕时长。关闭窗口会丢弃未应用的草稿编辑；已生成的原始结果保留在本次工作台会话缓存中。
					</p>
				</div>
			</section>
		</div>
	);
}
