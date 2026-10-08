import React, { useCallback, useEffect, useState } from 'react';
import { LuAudioLines, LuBrainCircuit, LuSettings2 } from 'react-icons/lu';

interface TtsConfig {
	provider: 'edge' | 'aliyun' | 'tencent' | 'local' | 'fake';
	aliyunBaseUrl: string;
	aliyunModel: string;
	aliyunVoice: string;
	aliyunApiKeyConfigured: boolean;
	tencentSecretIdConfigured: boolean;
	tencentSecretKeyConfigured: boolean;
	tencentSecurityTokenConfigured: boolean;
	tencentRegion: string;
	providers?: Array<{ id: string; label: string; configured: boolean; detail?: string }>;
}

interface AiConfig {
	baseURL: string;
	model: string;
	apiKeyConfigured: boolean;
	configured: boolean;
}

const emptyTts: TtsConfig = {
	provider: 'edge',
	aliyunBaseUrl: '',
	aliyunModel: 'qwen-audio-3.0-tts-flash',
	aliyunVoice: 'longanhuan_v3.6',
	aliyunApiKeyConfigured: false,
	tencentSecretIdConfigured: false,
	tencentSecretKeyConfigured: false,
	tencentSecurityTokenConfigured: false,
	tencentRegion: 'ap-beijing',
};
const emptyAi: AiConfig = {
	baseURL: 'https://api.deepseek.com',
	model: 'deepseek-chat',
	apiKeyConfigured: false,
	configured: false,
};

export function TtsProviderSettings() {
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<'ai' | 'tts'>('ai');
	const [tts, setTts] = useState<TtsConfig>(emptyTts);
	const [ai, setAi] = useState<AiConfig>(emptyAi);
	const [ttsKey, setTtsKey] = useState('');
	const [tencentSecretId, setTencentSecretId] = useState('');
	const [tencentSecretKey, setTencentSecretKey] = useState('');
	const [tencentSecurityToken, setTencentSecurityToken] = useState('');
	const [aiKey, setAiKey] = useState('');
	const [notice, setNotice] = useState('');
	const [busy, setBusy] = useState(false);
	const loadConfigs = useCallback(async () => {
		const [ttsConfig, aiConfig] = await Promise.all([
			fetch('/api/storyboard/tts/config').then((response) => response.json() as Promise<TtsConfig>),
			fetch('/api/storyboard/narration').then((response) => response.json() as Promise<AiConfig>),
		]);
		setTts(ttsConfig);
		setAi(aiConfig);
	}, []);

	useEffect(() => {
		void loadConfigs().catch(() => undefined);
	}, [loadConfigs]);
	useEffect(() => {
		if (open) {
			setNotice('');
			void loadConfigs().catch(() => setNotice('读取服务配置失败'));
		}
	}, [loadConfigs, open]);
	const selectedTts = tts.providers?.find((provider) => provider.id === tts.provider);

	const saveAi = async () => {
		setBusy(true);
		setNotice('');
		try {
			const response = await fetch('/api/storyboard/narration', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ baseURL: ai.baseURL, model: ai.model, apiKey: aiKey }),
			});
			const result = (await response.json()) as AiConfig & { error?: string };
			if (!response.ok) {
				throw new Error(result.error || `HTTP ${response.status}`);
			}
			setAi(result);
			setAiKey('');
			setNotice('DeepSeek 讲稿配置已保存，进入分镜后可直接使用服务端配置。');
		} catch (error) {
			setNotice(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
		} finally {
			setBusy(false);
		}
	};

	const saveTts = async (test: boolean) => {
		setBusy(true);
		setNotice('');
		try {
			const response = await fetch('/api/storyboard/tts/config', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...tts,
					aliyunApiKey: ttsKey,
					tencentSecretId,
					tencentSecretKey,
					tencentSecurityToken,
				}),
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			setTts((await response.json()) as TtsConfig);
			setTtsKey('');
			setTencentSecretId('');
			setTencentSecretKey('');
			setTencentSecurityToken('');
			if (test) {
				const preview = await fetch('/api/storyboard/tts', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						text: '你好，这是语音服务连通性测试。',
						voiceType: 101001,
						speed: 0,
					}),
				});
				const result = (await preview.json()) as { error?: string; provider?: string };
				if (!preview.ok) {
					throw new Error(result.error || `HTTP ${preview.status}`);
				}
				setNotice(`连接成功：${result.provider || tts.provider}`);
			} else {
				setNotice('语音配置已保存，试听和视频生成立即生效。');
			}
		} catch (error) {
			setNotice(`操作失败：${error instanceof Error ? error.message : '未知错误'}`);
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<button
				type='button'
				onClick={() => setOpen(true)}
				className='mt-4 flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent'
			>
				<LuSettings2 className='h-4 w-4' /> AI 与语音服务配置
				<span
					className={`ml-1 h-2 w-2 rounded-full ${ai.configured ? 'bg-emerald-500' : 'bg-amber-500'}`}
					title={ai.configured ? 'DeepSeek 已配置' : 'DeepSeek 未配置'}
				/>
				<span
					className={`h-2 w-2 rounded-full ${selectedTts?.configured === false ? 'bg-amber-500' : 'bg-emerald-500'}`}
					title={selectedTts?.configured === false ? '当前语音服务未配置' : '语音服务已配置'}
				/>
			</button>
			{open && (
				<div
					className='fixed inset-0 z-[2000] flex items-center justify-center bg-black/55 p-4'
					onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
				>
					<div
						role='dialog'
						aria-modal='true'
						aria-label='AI 与语音服务配置'
						className='max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-background p-6 text-foreground shadow-2xl'
					>
						<div className='flex items-center justify-between'>
							<h2 className='text-xl font-semibold'>AI 与语音服务</h2>
							<button
								type='button'
								onClick={() => setOpen(false)}
								className='rounded px-2 py-1 hover:bg-accent'
							>
								关闭
							</button>
						</div>
						<div className='mt-5 flex gap-2 border-b border-border pb-3'>
							<button
								type='button'
								onClick={() => setTab('ai')}
								className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${tab === 'ai' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
							>
								<LuBrainCircuit />
								DeepSeek 讲稿
							</button>
							<button
								type='button'
								onClick={() => setTab('tts')}
								className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${tab === 'tts' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
							>
								<LuAudioLines />
								语音合成
							</button>
						</div>
						{tab === 'ai' ? (
							<div className='mt-5 space-y-4'>
								<div
									className={`rounded-lg border px-3 py-2 text-sm ${ai.configured ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600' : 'border-amber-500/40 bg-amber-500/10 text-amber-600'}`}
								>
									{ai.configured ? `已配置 · ${ai.model}` : '尚未配置 DeepSeek API Key'}
								</div>
								<label className='block text-sm'>
									接口地址
									<input
										value={ai.baseURL}
										onChange={(event) => setAi({ ...ai, baseURL: event.target.value })}
										className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
									/>
								</label>
								<label className='block text-sm'>
									模型名称
									<input
										value={ai.model}
										onChange={(event) => setAi({ ...ai, model: event.target.value })}
										className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
									/>
								</label>
								<label className='block text-sm'>
									API Key
									<input
										type='password'
										value={aiKey}
										placeholder={
											ai.apiKeyConfigured ? '已配置；留空保持不变' : '请输入 DeepSeek API Key'
										}
										onChange={(event) => setAiKey(event.target.value)}
										className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
									/>
								</label>
								<p className='text-xs text-muted-foreground'>
									支持 DeepSeek 官方地址及 OpenAI
									兼容接口。密钥只保存在本机服务配置文件中，不返回网页。
								</p>
							</div>
						) : (
							<div className='mt-5 space-y-4'>
								<div
									className={`rounded-lg border px-3 py-2 text-sm ${selectedTts?.configured === false ? 'border-amber-500/40 bg-amber-500/10 text-amber-600' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'}`}
								>
									{selectedTts?.configured === false
										? `${selectedTts.label} 尚未配置密钥`
										: `已配置 · ${selectedTts?.label ?? tts.provider}`}
								</div>
								<label className='block text-sm'>
									服务商
									<select
										value={tts.provider}
										onChange={(event) =>
											setTts({ ...tts, provider: event.target.value as TtsConfig['provider'] })
										}
										className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
									>
										<option value='edge'>本地 Edge TTS</option>
										<option value='aliyun'>阿里云百炼</option>
										<option value='tencent'>腾讯云 TTS</option>
										<option value='local'>本地 eSpeak</option>
									</select>
								</label>
								{tts.provider === 'aliyun' && (
									<>
										<label className='block text-sm'>
											接口地址
											<input
												value={tts.aliyunBaseUrl}
												onChange={(event) => setTts({ ...tts, aliyunBaseUrl: event.target.value })}
												className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
											/>
										</label>
										<label className='block text-sm'>
											API Key
											<input
												type='password'
												value={ttsKey}
												placeholder={
													tts.aliyunApiKeyConfigured ? '已配置；留空保持不变' : '请输入 API Key'
												}
												onChange={(event) => setTtsKey(event.target.value)}
												className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
											/>
										</label>
										<div className='grid gap-3 sm:grid-cols-2'>
											<label className='block text-sm'>
												模型
												<input
													value={tts.aliyunModel}
													onChange={(event) => setTts({ ...tts, aliyunModel: event.target.value })}
													className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
												/>
											</label>
											<label className='block text-sm'>
												音色
												<input
													value={tts.aliyunVoice}
													onChange={(event) => setTts({ ...tts, aliyunVoice: event.target.value })}
													className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
												/>
											</label>
										</div>
									</>
								)}
								{tts.provider === 'tencent' && (
									<>
										<div className='grid gap-3 sm:grid-cols-2'>
											<label className='block text-sm'>
												SecretId
												<input
													type='password'
													value={tencentSecretId}
													placeholder={
														tts.tencentSecretIdConfigured
															? '已配置；留空保持不变'
															: '请输入 SecretId'
													}
													onChange={(event) => setTencentSecretId(event.target.value)}
													className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
												/>
											</label>
											<label className='block text-sm'>
												SecretKey
												<input
													type='password'
													value={tencentSecretKey}
													placeholder={
														tts.tencentSecretKeyConfigured
															? '已配置；留空保持不变'
															: '请输入 SecretKey'
													}
													onChange={(event) => setTencentSecretKey(event.target.value)}
													className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
												/>
											</label>
										</div>
										<div className='grid gap-3 sm:grid-cols-2'>
											<label className='block text-sm'>
												地域
												<input
													value={tts.tencentRegion}
													onChange={(event) =>
														setTts({ ...tts, tencentRegion: event.target.value })
													}
													className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
												/>
											</label>
											<label className='block text-sm'>
												临时安全令牌（可选）
												<input
													type='password'
													value={tencentSecurityToken}
													placeholder={
														tts.tencentSecurityTokenConfigured
															? '已配置；留空保持不变'
															: '无需临时令牌可留空'
													}
													onChange={(event) => setTencentSecurityToken(event.target.value)}
													className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2'
												/>
											</label>
										</div>
									</>
								)}
								<p className='text-xs text-muted-foreground'>
									DeepSeek、阿里云和腾讯云密钥统一保存在本机服务配置文件中，网页只读取是否已配置。
								</p>
							</div>
						)}
						{notice && (
							<p role='status' className='mt-4 rounded-lg bg-muted px-3 py-2 text-sm'>
								{notice}
							</p>
						)}
						<div className='mt-5 flex justify-end gap-2'>
							{tab === 'tts' && (
								<button
									type='button'
									disabled={busy}
									onClick={() => void saveTts(true)}
									className='rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50'
								>
									保存并测试
								</button>
							)}
							<button
								type='button'
								disabled={busy}
								onClick={() => void (tab === 'ai' ? saveAi() : saveTts(false))}
								className='rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50'
							>
								{busy ? '处理中…' : '保存'}
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
