import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
	LuAudioLines,
	LuLogOut,
	LuPencilLine,
	LuPlay,
	LuPresentation,
	LuSparkles,
	LuTrash2,
	LuVideo,
	LuX,
} from 'react-icons/lu';

import { markAutosaveSnapshotConsumed } from '../../packages/shared/src/render/autosave-recovery';
import {
	createProject,
	deleteProject,
	listProjects,
	migrateProjects,
	readProject,
	saveProject,
} from '../../packages/shared/src/render/project-library';
import type { LocalProject } from '../../packages/shared/src/render/project-library';
import { loadSessionDeck } from '../../packages/shared/src/render/session-restore';
import { ProjectCover } from './ProjectCover';

export interface ProjectGenerationProgress {
	stage: string;
	progress: number;
	status: string;
	jobId?: string;
	terminal?: boolean;
}

export interface QuickVideoSettings {
	polish: boolean;
	subtitlesEnabled: boolean;
	ttsProvider: 'edge' | 'aliyun' | 'tencent' | 'local';
	audience: string;
	detail: 'brief' | 'standard' | 'detailed';
	supplement: string;
}

interface TtsProviderOption {
	id: QuickVideoSettings['ttsProvider'];
	label: string;
	configured: boolean;
	detail?: string;
}

const QUICK_SETTINGS_KEY = 'pptx-storyboard-quick-video-settings';
const defaultQuickSettings: QuickVideoSettings = {
	polish: true,
	subtitlesEnabled: true,
	ttsProvider: 'edge',
	audience: '中小学生',
	detail: 'standard',
	supplement: '',
};

function savedQuickSettings(): QuickVideoSettings {
	try {
		return {
			...defaultQuickSettings,
			...(JSON.parse(
				localStorage.getItem(QUICK_SETTINGS_KEY) || '{}',
			) as Partial<QuickVideoSettings>),
		};
	} catch {
		return defaultQuickSettings;
	}
}

function hasSavedQuickSettings(): boolean {
	try {
		return localStorage.getItem(QUICK_SETTINGS_KEY) !== null;
	} catch {
		return false;
	}
}

const stageNames: Record<string, string> = {
	idle: '等待开始',
	configuring: '应用生成设置',
	loading: '读取项目',
	parsing: '解析演示文稿',
	polishing: 'AI 润色讲稿',
	preparing: '准备分镜',
	capturing: '捕获分镜画面',
	queued: '任务排队中',
	synthesizing: '生成配音',
	rendering: '渲染视频画面',
	muxing: '合成音画与字幕',
	completed: '视频生成完成',
	failed: '生成失败',
	cancelled: '任务已取消',
};

export function useProjectLibrary(enabled: boolean) {
	const [projects, setProjects] = useState<LocalProject[]>([]);
	const [active, setActive] = useState<LocalProject | null>(null);
	const [ready, setReady] = useState(false);
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const [error, setError] = useState('');
	const refresh = useCallback(async () => setProjects(await listProjects()), []);
	useEffect(() => {
		if (!enabled) {
			setReady(true);
			return;
		}
		let disposed = false;
		void (async () => {
			try {
				await migrateProjects(await loadSessionDeck());
				const rows = await listProjects();
				if (!disposed) {
					setProjects(rows);
				}
			} catch {
				if (!disposed) {
					setError('无法读取本机项目，请检查浏览器是否允许本地存储，然后刷新重试。');
				}
			} finally {
				if (!disposed) {
					setReady(true);
				}
			}
		})();
		return () => {
			disposed = true;
		};
	}, [enabled]);
	const run = useCallback(async (action: () => Promise<void>) => {
		if (inFlight.current) {
			return;
		}
		inFlight.current = true;
		setBusy(true);
		setError('');
		try {
			await action();
		} catch (cause) {
			setError(
				`项目操作失败，当前文件仍保留在页面中。${cause instanceof Error ? cause.message : '请检查浏览器存储空间后重试。'}`,
			);
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}, []);
	const create = useCallback(async (name: string, data: Uint8Array) => {
		const project = await createProject(name, data);
		setActive(project);
		return project;
	}, []);
	const open = useCallback(async (id: string) => {
		const project = await readProject(id);
		if (!project) {
			throw new Error('未找到项目文件，请重新导入。');
		}
		markAutosaveSnapshotConsumed(project.updatedAt);
		// Keep heavy bytes out of the metadata state.
		const { data, ...metadata } = project;
		setActive(metadata);
		return { metadata, data };
	}, []);
	const load = useCallback(async (id: string) => {
		const project = await readProject(id);
		if (!project) {
			throw new Error('未找到项目文件，请重新导入。');
		}
		const { data, ...metadata } = project;
		return { metadata, data };
	}, []);
	const save = useCallback(
		async (name: string, data: Uint8Array) => {
			if (active) {
				await saveProject(active, data);
			} else {
				await createProject(name, data);
			}
			await refresh();
		},
		[active, refresh],
	);
	const remove = useCallback(
		async (project: LocalProject) => {
			await deleteProject(project);
			await refresh();
		},
		[refresh],
	);
	return { projects, active, setActive, ready, busy, error, run, create, open, load, save, remove };
}

export function ProjectLibrary({
	projects,
	ready,
	busy,
	onOpen,
	onGenerate,
	onDelete,
	progressByProject,
	loadPreview,
}: {
	projects: LocalProject[];
	ready: boolean;
	busy: boolean;
	onOpen: (id: string) => void;
	onGenerate: (project: LocalProject, settings: QuickVideoSettings) => void;
	onDelete: (project: LocalProject) => void;
	progressByProject: Record<string, ProjectGenerationProgress | undefined>;
	loadPreview: (id: string) => Promise<{ data: Uint8Array }>;
}) {
	const [generationProject, setGenerationProject] = useState<LocalProject | null>(null);
	const [generationSettings, setGenerationSettings] =
		useState<QuickVideoSettings>(savedQuickSettings);
	const [ttsProviders, setTtsProviders] = useState<TtsProviderOption[]>([]);
	const [settingsNotice, setSettingsNotice] = useState('');
	const [settingsLoading, setSettingsLoading] = useState(false);
	const [passwordAccessEnabled, setPasswordAccessEnabled] = useState(false);
	useEffect(() => {
		void fetch('/auth/status')
			.then((response) => response.json() as Promise<{ enabled?: boolean }>)
			.then((status) => setPasswordAccessEnabled(status.enabled === true))
			.catch(() => undefined);
	}, []);
	useEffect(() => {
		if (!generationProject) {
			return;
		}
		const close = (event: KeyboardEvent) => event.key === 'Escape' && setGenerationProject(null);
		window.addEventListener('keydown', close);
		return () => window.removeEventListener('keydown', close);
	}, [generationProject]);
	const openGenerationSettings = (project: LocalProject) => {
		const preferSavedProvider = hasSavedQuickSettings();
		setGenerationProject(project);
		setSettingsNotice('');
		setSettingsLoading(true);
		void fetch('/api/storyboard/tts/config')
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
				return response.json() as Promise<{
					provider?: QuickVideoSettings['ttsProvider'];
					providers?: TtsProviderOption[];
				}>;
			})
			.then((config) => {
				const providers = (config.providers ?? []).filter(
					(provider) => provider.id !== ('fake' as string),
				);
				setTtsProviders(providers);
				setGenerationSettings((current) => ({
					...current,
					ttsProvider:
						preferSavedProvider && providers.some((provider) => provider.id === current.ttsProvider)
							? current.ttsProvider
							: (config.provider ?? 'edge'),
				}));
				return undefined;
			})
			.catch(() => setSettingsNotice('无法读取语音服务状态，请先在首页配置服务。'))
			.finally(() => setSettingsLoading(false));
	};
	const confirmGeneration = () => {
		if (!generationProject) {
			return;
		}
		const provider = ttsProviders.find((item) => item.id === generationSettings.ttsProvider);
		if (provider?.configured === false) {
			setSettingsNotice(
				`${provider.label} 尚未配置密钥，请先在首页“AI 与语音服务配置”中完成配置。`,
			);
			return;
		}
		if (!generationSettings.audience.trim()) {
			setSettingsNotice('请填写教学对象。');
			return;
		}
		localStorage.setItem(QUICK_SETTINGS_KEY, JSON.stringify(generationSettings));
		const project = generationProject;
		setGenerationProject(null);
		onGenerate(project, generationSettings);
	};
	return (
		<>
			<section className='mt-8 w-full max-w-[1280px]' aria-label='本机项目列表'>
				<div className='mb-2 flex items-center justify-between gap-4'>
					<h1 className='text-2xl font-semibold'>我的项目</h1>
					{passwordAccessEnabled && (
						<form method='post' action='/auth/logout'>
							<button
								type='submit'
								className='inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground'
							>
								<LuLogOut className='h-4 w-4' /> 退出登录
							</button>
						</form>
					)}
				</div>
				<p className='text-sm text-muted-foreground mb-5'>
					保存在当前浏览器中，点击项目继续编辑。清除网站数据会移除本地记录，请及时导出重要文件。
				</p>
				{!ready ? (
					<p role='status'>正在读取本机项目…</p>
				) : projects.length === 0 ? (
					<p className='py-6 text-muted-foreground'>还没有项目，导入 PPTX 或新建一个演示文稿。</p>
				) : (
					<div className='grid max-h-[58vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4'>
						{projects.map((project) => {
							const progress = progressByProject[project.id];
							const active = progress && !progress.terminal;
							return (
								<article
									key={project.id}
									className='group overflow-hidden rounded-xl border border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg'
								>
									<div className='aspect-video overflow-hidden border-b border-border bg-slate-950'>
										<ProjectCover project={project} load={loadPreview} />
									</div>
									<div className='flex gap-2.5 p-3'>
										<div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-md'>
											<LuPresentation className='h-5 w-5' />
										</div>
										<div className='min-w-0 flex-1'>
											<h2 className='truncate font-semibold'>{project.name}</h2>
											<p className='mt-1 text-xs text-muted-foreground'>
												{new Date(project.updatedAt).toLocaleString('zh-CN')} ·{' '}
												{(project.size / 1024 / 1024).toFixed(2)} MB
											</p>
											<p className='mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground'>
												<LuVideo className='h-3.5 w-3.5' /> PPT 分镜视频项目
											</p>
										</div>
										<button
											type='button'
											disabled={busy || active}
											onClick={() => onDelete(project)}
											className='self-start rounded-lg p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30'
											aria-label={`删除项目 ${project.name}`}
										>
											<LuTrash2 className='h-4 w-4' />
										</button>
									</div>
									{progress && (
										<div className='border-y border-border bg-muted/35 px-3 py-2'>
											<div className='mb-2 flex items-center justify-between gap-3 text-xs'>
												<span className='min-w-0 truncate font-medium'>
													{stageNames[progress.stage] ?? progress.status ?? progress.stage}
												</span>
												<span className='shrink-0 tabular-nums text-muted-foreground'>
													{Math.round(progress.progress)}%
												</span>
											</div>
											<div className='h-2 overflow-hidden rounded-full bg-border/70'>
												<div
													className={`h-full rounded-full transition-all duration-300 ${progress.stage === 'failed' ? 'bg-red-500' : progress.stage === 'completed' ? 'bg-emerald-500' : 'bg-gradient-to-r from-rose-500 to-orange-500'}`}
													style={{ width: `${Math.max(0, Math.min(100, progress.progress))}%` }}
												/>
											</div>
											{progress.status && (
												<p
													className='mt-1.5 truncate text-[11px] text-muted-foreground'
													title={progress.status}
												>
													{progress.status}
												</p>
											)}
										</div>
									)}
									<div className='grid grid-cols-2 gap-2 p-3'>
										<button
											type='button'
											disabled={busy || active}
											onClick={() => openGenerationSettings(project)}
											className='flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 px-2 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-45'
										>
											<LuPlay className='h-4 w-4 fill-current' />
											一键生成视频
										</button>
										<button
											type='button'
											disabled={busy}
											onClick={() => onOpen(project.id)}
											className='flex items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-2 text-xs font-semibold hover:bg-accent disabled:opacity-50'
										>
											<LuPencilLine className='h-4 w-4' />
											编辑
										</button>
									</div>
								</article>
							);
						})}
					</div>
				)}
			</section>
			{generationProject && (
				<div
					className='fixed inset-0 z-[2100] flex items-center justify-center bg-black/65 p-4'
					onMouseDown={(event) =>
						event.target === event.currentTarget && setGenerationProject(null)
					}
				>
					<div
						role='dialog'
						aria-modal='true'
						aria-label='一键生成视频设置'
						className='w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-[#15171e] text-slate-100 shadow-2xl'
					>
						<div className='flex items-center justify-between border-b border-slate-700 px-6 py-4'>
							<div>
								<h2 className='text-lg font-semibold'>一键生成视频设置</h2>
								<p className='mt-1 max-w-[520px] truncate text-xs text-slate-400'>
									{generationProject.name}
								</p>
							</div>
							<button
								type='button'
								onClick={() => setGenerationProject(null)}
								className='rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white'
								aria-label='关闭生成设置'
							>
								<LuX className='h-5 w-5' />
							</button>
						</div>
						<div className='max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5'>
							<label className='flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-900/70 p-4'>
								<input
									type='checkbox'
									checked={generationSettings.polish}
									onChange={(event) =>
										setGenerationSettings({ ...generationSettings, polish: event.target.checked })
									}
									className='mt-1 h-4 w-4 accent-orange-500'
								/>
								<LuSparkles className='mt-0.5 h-5 w-5 shrink-0 text-orange-400' />
								<span>
									<span className='block text-sm font-medium'>生成前用 AI 润色讲稿</span>
									<span className='mt-1 block text-xs leading-5 text-slate-400'>
										结合每页文字和动画顺序生成教学式旁白；已手动锁定的讲稿不会被覆盖。
									</span>
								</span>
							</label>
							<label className='flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-900/70 p-4'>
								<input
									type='checkbox'
									checked={generationSettings.subtitlesEnabled}
									onChange={(event) =>
										setGenerationSettings({
											...generationSettings,
											subtitlesEnabled: event.target.checked,
										})
									}
									className='mt-1 h-4 w-4 accent-orange-500'
								/>
								<span>
									<span className='block text-sm font-medium'>生成字幕</span>
									<span className='mt-1 block text-xs leading-5 text-slate-400'>
										在视频底部显示旁白字幕；关闭后保留配音，不叠加字幕，可减少渲染耗时。
									</span>
								</span>
							</label>
							<div className='grid gap-4 sm:grid-cols-2'>
								<label className='text-sm text-slate-300'>
									<span className='mb-2 flex items-center gap-2 font-medium text-slate-100'>
										<LuAudioLines className='text-orange-400' /> 配音服务
									</span>
									<select
										value={generationSettings.ttsProvider}
										disabled={settingsLoading}
										onChange={(event) =>
											setGenerationSettings({
												...generationSettings,
												ttsProvider: event.target.value as QuickVideoSettings['ttsProvider'],
											})
										}
										className='w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100'
									>
										{ttsProviders.length === 0 && <option value='edge'>本地 Edge TTS</option>}
										{ttsProviders.map((provider) => (
											<option key={provider.id} value={provider.id} disabled={!provider.configured}>
												{provider.label}
												{provider.configured ? '' : '（未配置）'}
											</option>
										))}
									</select>
								</label>
								<label className='text-sm text-slate-300'>
									<span className='mb-2 block font-medium text-slate-100'>教学对象</span>
									<input
										value={generationSettings.audience}
										onChange={(event) =>
											setGenerationSettings({ ...generationSettings, audience: event.target.value })
										}
										placeholder='例如：小学五年级学生'
										className='w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 placeholder:text-slate-600'
									/>
								</label>
							</div>
							<fieldset>
								<legend className='mb-2 text-sm font-medium text-slate-100'>讲解程度</legend>
								<div className='grid grid-cols-3 gap-3'>
									{(
										[
											['brief', '简明', '少讲解，突出结论'],
											['standard', '标准', '解释重点与思路'],
											['detailed', '详细', '增加推导和衔接'],
										] as const
									).map(([value, label, help]) => (
										<label
											key={value}
											className={`cursor-pointer rounded-xl border p-3 ${generationSettings.detail === value ? 'border-orange-500 bg-orange-500/10' : 'border-slate-700 bg-slate-900/60'}`}
										>
											<input
												type='radio'
												name='quick-video-detail'
												value={value}
												checked={generationSettings.detail === value}
												onChange={() =>
													setGenerationSettings({ ...generationSettings, detail: value })
												}
												className='sr-only'
											/>
											<span className='block text-sm font-medium'>{label}</span>
											<span className='mt-1 block text-[11px] text-slate-400'>{help}</span>
										</label>
									))}
								</div>
							</fieldset>
							<label className='block text-sm text-slate-300'>
								<span className='mb-2 block font-medium text-slate-100'>补充讲解要求（可选）</span>
								<textarea
									value={generationSettings.supplement}
									onChange={(event) =>
										setGenerationSettings({ ...generationSettings, supplement: event.target.value })
									}
									maxLength={2000}
									rows={3}
									placeholder='例如：重点解释例题思路，避免朗读页眉和练习编号。'
									className='w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 placeholder:text-slate-600'
								/>
							</label>
							{settingsNotice && (
								<p
									role='alert'
									className='rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300'
								>
									{settingsNotice}
								</p>
							)}
						</div>
						<div className='flex items-center justify-end gap-3 border-t border-slate-700 px-6 py-4'>
							<button
								type='button'
								onClick={() => setGenerationProject(null)}
								className='rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800'
							>
								取消
							</button>
							<button
								type='button'
								disabled={settingsLoading}
								onClick={confirmGeneration}
								className='flex items-center gap-2 rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50'
							>
								<LuPlay className='h-4 w-4 fill-current' /> 开始生成
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
