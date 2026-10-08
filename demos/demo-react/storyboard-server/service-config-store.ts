import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface ServiceConfigDocument {
	version: 1;
	ai?: Record<string, unknown>;
	tts?: Record<string, unknown>;
}

function serviceConfigPath(): string | undefined {
	const explicit = process.env.STORYBOARD_SERVICE_CONFIG_PATH?.trim();
	if (explicit) {
		return explicit;
	}
	const ttsPath = process.env.STORYBOARD_TTS_CONFIG_PATH?.trim();
	if (ttsPath) {
		return join(dirname(ttsPath), 'service-config.json');
	}
	const aiPath = process.env.STORYBOARD_AI_CONFIG_PATH?.trim();
	return aiPath ? join(dirname(aiPath), 'service-config.json') : undefined;
}

function readJson(path: string | undefined): Record<string, unknown> | undefined {
	if (!path) {
		return undefined;
	}
	try {
		const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function legacyAiPath(): string | undefined {
	const explicit = process.env.STORYBOARD_AI_CONFIG_PATH?.trim();
	if (explicit) {
		return explicit;
	}
	const ttsPath = process.env.STORYBOARD_TTS_CONFIG_PATH?.trim();
	return ttsPath ? join(dirname(ttsPath), 'ai-config.json') : undefined;
}

function readDocument(): ServiceConfigDocument {
	const saved = readJson(serviceConfigPath());
	if (saved?.version === 1) {
		return saved as unknown as ServiceConfigDocument;
	}
	return {
		version: 1,
		ai: readJson(legacyAiPath()),
		tts: readJson(process.env.STORYBOARD_TTS_CONFIG_PATH?.trim()),
	};
}

export function readServiceConfigSection<T extends Record<string, unknown>>(
	section: 'ai' | 'tts',
): Partial<T> {
	return (readDocument()[section] ?? {}) as Partial<T>;
}

export async function writeServiceConfigSection<T extends Record<string, unknown>>(
	section: 'ai' | 'tts',
	value: T,
): Promise<void> {
	const path = serviceConfigPath();
	if (!path) {
		return;
	}
	const document = readDocument();
	document[section] = value;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(document, null, 2), { mode: 0o600 });
}
