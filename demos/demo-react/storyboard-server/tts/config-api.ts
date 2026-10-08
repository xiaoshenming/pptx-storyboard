import type { Connect } from 'vite';

import { acceptsContentType } from '../request-security';
import { publicTtsProviderConfig, updateTtsProviderConfig } from './provider-config';

function respond(response: import('node:http').ServerResponse, status: number, body: unknown) {
	response.statusCode = status;
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.end(JSON.stringify(body));
}

async function readJson(
	request: import('node:http').IncomingMessage,
): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.from(chunk));
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export function createTtsConfigMiddleware(): Connect.NextHandleFunction {
	return async (request, response) => {
		if (request.method === 'GET') {
			return respond(response, 200, publicTtsProviderConfig());
		}
		if (request.method !== 'PUT') {
			return respond(response, 405, { error: 'METHOD_NOT_ALLOWED' });
		}
		if (!acceptsContentType(request, 'application/json')) {
			return respond(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' });
		}
		try {
			const input = await readJson(request);
			await updateTtsProviderConfig({
				provider: typeof input.provider === 'string' ? (input.provider as never) : undefined,
				aliyunBaseUrl:
					typeof input.aliyunBaseUrl === 'string' ? input.aliyunBaseUrl.trim() : undefined,
				aliyunApiKey:
					typeof input.aliyunApiKey === 'string' ? input.aliyunApiKey.trim() : undefined,
				aliyunModel: typeof input.aliyunModel === 'string' ? input.aliyunModel.trim() : undefined,
				aliyunVoice: typeof input.aliyunVoice === 'string' ? input.aliyunVoice.trim() : undefined,
				tencentSecretId:
					typeof input.tencentSecretId === 'string' ? input.tencentSecretId.trim() : undefined,
				tencentSecretKey:
					typeof input.tencentSecretKey === 'string' ? input.tencentSecretKey.trim() : undefined,
				tencentSecurityToken:
					typeof input.tencentSecurityToken === 'string'
						? input.tencentSecurityToken.trim()
						: undefined,
				tencentRegion:
					typeof input.tencentRegion === 'string' ? input.tencentRegion.trim() : undefined,
			});
			return respond(response, 200, publicTtsProviderConfig());
		} catch (error) {
			return respond(response, 400, {
				error: error instanceof Error ? error.message : 'INVALID_TTS_CONFIG',
			});
		}
	};
}
