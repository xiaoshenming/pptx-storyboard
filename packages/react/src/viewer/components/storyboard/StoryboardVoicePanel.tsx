import React, { useCallback, useEffect, useState } from 'react';
import { LuAudioLines, LuLoaderCircle, LuRefreshCw, LuVolume2 } from 'react-icons/lu';

interface ProviderOption {
	id: string;
	label: string;
	configured: boolean;
	detail?: string;
}

interface ProviderConfig {
	provider: string;
	providers?: ProviderOption[];
}

interface StoryboardVoicePanelProps {
	ttsEndpoint?: string;
	text: string;
	speed: number;
	audioPreview?: { url: string; durationMs: number; taskId: string };
	onSpeedChange: (speed: number) => void;
	onAudioPreview: (preview: { url: string; durationMs: number; taskId: string }) => void;
}

function configEndpoint(ttsEndpoint: string): string {
	return `${ttsEndpoint.replace(/\/$/u, '')}/config`;
}

export function StoryboardVoicePanel({
	ttsEndpoint,
	text,
	speed,
	audioPreview,
	onSpeedChange,
	onAudioPreview,
}: StoryboardVoicePanelProps): React.ReactElement {
	const [config, setConfig] = useState<ProviderConfig | null>(null);
	const [notice, setNotice] = useState('');
	const [busy, setBusy] = useState(false);
	const loadConfig = useCallback(async () => {
		if (!ttsEndpoint) {
			return;
		}
		try {
			const response = await fetch(configEndpoint(ttsEndpoint));
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			setConfig((await response.json()) as ProviderConfig);
		} catch (error) {
			setNotice(`读取入口页语音配置失败：${error instanceof Error ? error.message : '未知错误'}`);
		}
	}, [ttsEndpoint]);
	useEffect(() => void loadConfig(), [loadConfig]);

	const selectProvider = async (provider: string) => {
		if (!ttsEndpoint || !config) {
			return;
		}
		setBusy(true);
		setNotice('');
		try {
			const response = await fetch(configEndpoint(ttsEndpoint), {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ provider }),
			});
			const next = (await response.json()) as ProviderConfig & { error?: string };
			if (!response.ok) {
				throw new Error(next.error || `HTTP ${response.status}`);
			}
			setConfig(next);
			setNotice('当前项目的试听和视频生成将使用该语音服务。');
		} catch (error) {
			setNotice(`切换失败：${error instanceof Error ? error.message : '未知错误'}`);
		} finally {
			setBusy(false);
		}
	};

	const generateAudio = async () => {
		if (!ttsEndpoint || !text.trim()) {
			return;
		}
		setBusy(true);
		setNotice('');
		try {
			const response = await fetch(ttsEndpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, voiceType: 101001, speed }),
			});
			const payload = (await response.json()) as {
				error?: string;
				provider?: string;
				taskId?: string;
				durationMs?: number;
				audioBase64?: string;
			};
			if (!response.ok || !payload.audioBase64 || !payload.taskId) {
				throw new Error(payload.error || `HTTP ${response.status}`);
			}
			const preview = {
				url: `data:audio/wav;base64,${payload.audioBase64}`,
				durationMs: payload.durationMs ?? 0,
				taskId: payload.taskId,
			};
			onAudioPreview(preview);
			setNotice(`配音已生成 · ${payload.provider || config?.provider || '当前服务'}`);
			await new Audio(preview.url).play();
		} catch (error) {
			setNotice(`配音失败：${error instanceof Error ? error.message : '未知错误'}`);
		} finally {
			setBusy(false);
		}
	};

	const providers = config?.providers ?? [];
	const selected = providers.find((provider) => provider.id === config?.provider);
	return (
		<div className='space-y-4 p-4'>
			<div className='rounded-xl border border-slate-700 bg-slate-900/70 p-4'>
				<div className='mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100'>
					<LuVolume2 className='text-pink-400' /> 语音服务
					<button
						type='button'
						onClick={() => void loadConfig()}
						className='ml-auto text-slate-400 hover:text-white'
						title='刷新入口页配置'
					>
						<LuRefreshCw className='h-4 w-4' />
					</button>
				</div>
				<select
					value={config?.provider ?? ''}
					disabled={busy || !config}
					onChange={(event) => void selectProvider(event.target.value)}
					className='w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-pink-500'
				>
					{providers.map((provider) => (
						<option key={provider.id} value={provider.id} disabled={!provider.configured}>
							{provider.label}
							{provider.configured ? '' : '（未配置）'}
						</option>
					))}
				</select>
				<p className='mt-2 text-xs leading-5 text-slate-400'>
					{selected?.detail || '服务地址、密钥、模型和音色均沿用入口页保存的配置。'}
				</p>
			</div>
			<label className='block rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-xs text-slate-400'>
				<span className='mb-3 flex justify-between'>
					<span>语速</span>
					<strong className='text-slate-200'>
						{speed > 0 ? '+' : ''}
						{speed}
					</strong>
				</span>
				<input
					type='range'
					min={-2}
					max={3}
					step={0.5}
					value={speed}
					onChange={(event) => onSpeedChange(Number(event.target.value))}
					className='w-full accent-pink-500'
				/>
			</label>
			<div className='flex gap-2'>
				<button
					type='button'
					onClick={() => void generateAudio()}
					disabled={busy || !ttsEndpoint || !text.trim()}
					className='flex flex-1 items-center justify-center gap-2 rounded-lg bg-pink-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-pink-400 disabled:opacity-40'
				>
					{busy ? (
						<LuLoaderCircle className='h-4 w-4 animate-spin' />
					) : (
						<LuAudioLines className='h-4 w-4' />
					)}
					{busy ? '处理中...' : '生成并试听'}
				</button>
				<button
					type='button'
					onClick={() => audioPreview && void new Audio(audioPreview.url).play()}
					disabled={!audioPreview}
					className='rounded-lg border border-slate-600 px-4 text-sm text-slate-200 disabled:opacity-30'
				>
					播放
				</button>
			</div>
			{notice && (
				<p className='rounded-lg bg-slate-800 px-3 py-2 text-xs leading-5 text-slate-300'>
					{notice}
				</p>
			)}
		</div>
	);
}
