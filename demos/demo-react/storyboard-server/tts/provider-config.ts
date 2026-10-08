import { readServiceConfigSection, writeServiceConfigSection } from '../service-config-store';

export type TtsProvider = 'edge' | 'aliyun' | 'tencent' | 'local' | 'fake';

export interface TtsProviderConfig {
	provider: TtsProvider;
	aliyunBaseUrl: string;
	aliyunApiKey: string;
	aliyunModel: string;
	aliyunVoice: string;
	tencentSecretId: string;
	tencentSecretKey: string;
	tencentSecurityToken: string;
	tencentRegion: string;
}

function environmentConfig(): TtsProviderConfig {
	return {
		provider: (process.env.STORYBOARD_TTS_PROVIDER?.trim().toLowerCase() || 'edge') as TtsProvider,
		aliyunBaseUrl:
			process.env.ALIYUN_TTS_BASE_URL?.trim() ||
			'https://dashscope.aliyuncs.com/compatible-mode/v1',
		aliyunApiKey:
			process.env.ALIYUN_TTS_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim() || '',
		aliyunModel: process.env.ALIYUN_TTS_MODEL?.trim() || 'qwen-audio-3.0-tts-flash',
		aliyunVoice: process.env.ALIYUN_TTS_VOICE?.trim() || 'longanhuan_v3.6',
		tencentSecretId: process.env.TENCENT_TTS_SECRET_ID?.trim() || '',
		tencentSecretKey: process.env.TENCENT_TTS_SECRET_KEY?.trim() || '',
		tencentSecurityToken: process.env.TENCENT_TTS_SECURITY_TOKEN?.trim() || '',
		tencentRegion: process.env.TENCENT_TTS_REGION?.trim() || 'ap-beijing',
	};
}

function loadConfig(): TtsProviderConfig {
	const fallback = environmentConfig();
	const saved = readServiceConfigSection<TtsProviderConfig>('tts');
	return {
		...fallback,
		...saved,
		provider: saved.provider || fallback.provider,
		aliyunBaseUrl: saved.aliyunBaseUrl?.trim() || fallback.aliyunBaseUrl,
		aliyunApiKey: saved.aliyunApiKey?.trim() || fallback.aliyunApiKey,
		aliyunModel: saved.aliyunModel?.trim() || fallback.aliyunModel,
		aliyunVoice: saved.aliyunVoice?.trim() || fallback.aliyunVoice,
		tencentSecretId: saved.tencentSecretId?.trim() || fallback.tencentSecretId,
		tencentSecretKey: saved.tencentSecretKey?.trim() || fallback.tencentSecretKey,
		tencentSecurityToken: saved.tencentSecurityToken?.trim() || fallback.tencentSecurityToken,
		tencentRegion: saved.tencentRegion?.trim() || fallback.tencentRegion,
	};
}

let current = loadConfig();

export function getTtsProviderConfig(): TtsProviderConfig {
	const fallback = environmentConfig();
	return {
		...fallback,
		...current,
		aliyunBaseUrl: current.aliyunBaseUrl?.trim() || fallback.aliyunBaseUrl,
		aliyunApiKey: current.aliyunApiKey?.trim() || fallback.aliyunApiKey,
		aliyunModel: current.aliyunModel?.trim() || fallback.aliyunModel,
		aliyunVoice: current.aliyunVoice?.trim() || fallback.aliyunVoice,
		tencentSecretId: current.tencentSecretId?.trim() || fallback.tencentSecretId,
		tencentSecretKey: current.tencentSecretKey?.trim() || fallback.tencentSecretKey,
		tencentSecurityToken: current.tencentSecurityToken?.trim() || fallback.tencentSecurityToken,
		tencentRegion: current.tencentRegion?.trim() || fallback.tencentRegion,
	};
}

export async function updateTtsProviderConfig(
	input: Partial<TtsProviderConfig>,
): Promise<TtsProviderConfig> {
	const providers: TtsProvider[] = ['edge', 'aliyun', 'tencent', 'local', 'fake'];
	if (input.provider && !providers.includes(input.provider)) {
		throw new Error('INVALID_TTS_PROVIDER');
	}
	current = {
		...getTtsProviderConfig(),
		...(input.provider ? { provider: input.provider } : {}),
		...(input.aliyunBaseUrl?.trim() ? { aliyunBaseUrl: input.aliyunBaseUrl.trim() } : {}),
		...(input.aliyunModel?.trim() ? { aliyunModel: input.aliyunModel.trim() } : {}),
		...(input.aliyunVoice?.trim() ? { aliyunVoice: input.aliyunVoice.trim() } : {}),
		...(input.tencentRegion?.trim() ? { tencentRegion: input.tencentRegion.trim() } : {}),
		aliyunApiKey: input.aliyunApiKey?.trim() || current.aliyunApiKey,
		tencentSecretId: input.tencentSecretId?.trim() || current.tencentSecretId,
		tencentSecretKey: input.tencentSecretKey?.trim() || current.tencentSecretKey,
		tencentSecurityToken: input.tencentSecurityToken?.trim() || current.tencentSecurityToken,
	};
	if (current.provider === 'aliyun') {
		const url = new URL(current.aliyunBaseUrl);
		if (url.protocol !== 'https:') {
			throw new Error('阿里云语音接口地址必须使用 HTTPS');
		}
	}
	await writeServiceConfigSection('tts', current);
	return getTtsProviderConfig();
}

export function publicTtsProviderConfig() {
	const config = getTtsProviderConfig();
	return {
		provider: config.provider,
		aliyunBaseUrl: config.aliyunBaseUrl,
		aliyunModel: config.aliyunModel,
		aliyunVoice: config.aliyunVoice,
		aliyunApiKeyConfigured: Boolean(config.aliyunApiKey),
		tencentSecretIdConfigured: Boolean(config.tencentSecretId),
		tencentSecretKeyConfigured: Boolean(config.tencentSecretKey),
		tencentSecurityTokenConfigured: Boolean(config.tencentSecurityToken),
		tencentRegion: config.tencentRegion,
		providers: [
			{ id: 'edge', label: '本地 Edge TTS', configured: true },
			{
				id: 'aliyun',
				label: '阿里云百炼',
				configured: Boolean(config.aliyunApiKey),
				detail: `${config.aliyunModel} · ${config.aliyunVoice}`,
			},
			{
				id: 'tencent',
				label: '腾讯云 TTS',
				configured: Boolean(config.tencentSecretId && config.tencentSecretKey),
				detail: config.tencentRegion,
			},
			{ id: 'local', label: '本地 eSpeak', configured: true },
		],
	};
}
