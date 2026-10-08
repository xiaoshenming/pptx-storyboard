import { readServiceConfigSection, writeServiceConfigSection } from './service-config-store';

export interface NarrationProviderConfig {
	baseURL: string;
	model: string;
	apiKey: string;
}

export function narrationConcurrency(): number {
	const configured = Number(process.env.STORYBOARD_AI_CONCURRENCY || '3');
	return Number.isSafeInteger(configured) ? Math.max(1, Math.min(6, configured)) : 3;
}

function environmentConfig(): NarrationProviderConfig {
	return {
		baseURL: process.env.STORYBOARD_AI_BASE_URL?.trim() || 'https://api.deepseek.com',
		model:
			process.env.STORYBOARD_AI_MODEL?.trim() ||
			process.env.DEEPSEEK_MODEL?.trim() ||
			'deepseek-chat',
		apiKey: process.env.STORYBOARD_AI_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || '',
	};
}

function loadConfig(): NarrationProviderConfig {
	const fallback = environmentConfig();
	return { ...fallback, ...readServiceConfigSection<NarrationProviderConfig>('ai') };
}

let current = loadConfig();

export function getNarrationProviderConfig(): NarrationProviderConfig {
	const environment = environmentConfig();
	return {
		baseURL: current.baseURL || environment.baseURL,
		model: current.model || environment.model,
		apiKey: current.apiKey || environment.apiKey,
	};
}

export async function updateNarrationProviderConfig(
	input: Partial<NarrationProviderConfig>,
): Promise<NarrationProviderConfig> {
	const next = {
		...current,
		...input,
		apiKey: input.apiKey?.trim() || current.apiKey,
		baseURL: input.baseURL?.trim() || current.baseURL,
		model: input.model?.trim() || current.model,
	};
	const url = new URL(next.baseURL);
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		(url.protocol !== 'https:' &&
			!(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
	) {
		throw new Error('模型地址应使用 HTTPS；本机服务可使用 HTTP');
	}
	if (!next.model || next.model.length > 120 || next.apiKey.length > 4096) {
		throw new Error('模型名称或 API Key 无效');
	}
	current = next;
	await writeServiceConfigSection('ai', current);
	return getNarrationProviderConfig();
}

export function publicNarrationProviderConfig() {
	const config = getNarrationProviderConfig();
	return {
		baseURL: config.baseURL,
		model: config.model,
		apiKeyConfigured: Boolean(config.apiKey),
		configured: Boolean(config.apiKey && config.model && config.baseURL),
		concurrency: narrationConcurrency(),
	};
}
