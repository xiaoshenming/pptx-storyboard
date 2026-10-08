import type { IncomingMessage, ServerResponse } from 'node:http';

import {
	NARRATION_SYSTEM_PROMPT,
	narrationMaterialSchema,
	parseNarrationDraft,
} from '../../../packages/shared/src/narration/contracts';
import {
	getNarrationProviderConfig,
	narrationConcurrency,
	publicNarrationProviderConfig,
	updateNarrationProviderConfig,
} from './narration-provider-config';
import { acceptsContentType } from './request-security';

function json(response: ServerResponse, status: number, value: unknown): void {
	if (response.destroyed) {
		return;
	}
	response.statusCode = status;
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.setHeader('Cache-Control', 'no-store');
	response.end(JSON.stringify(value));
}
async function readBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let length = 0;
	for await (const chunk of request) {
		length += chunk.length;
		if (length > 64 * 1024) {
			throw new Error('请求过大');
		}
		chunks.push(Buffer.from(chunk));
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function connectionOf(value: unknown): { baseURL: string; model: string; apiKey: string } {
	const configured = getNarrationProviderConfig();
	const supplied = value !== undefined;
	const fields =
		supplied && value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const baseURL = supplied ? fields.baseURL : configured.baseURL;
	const model = supplied ? fields.model : configured.model;
	// Server secrets never accompany a client-selected URL.
	const apiKey = supplied ? fields.apiKey : configured.apiKey;
	if (
		typeof baseURL !== 'string' ||
		typeof model !== 'string' ||
		typeof apiKey !== 'string' ||
		!apiKey.trim() ||
		!model.trim()
	) {
		throw new Error('请先配置模型地址、模型名称和 API Key，或由服务端配置 DEEPSEEK_API_KEY');
	}
	if (baseURL.length > 2048 || model.length > 120 || apiKey.length > 4096) {
		throw new Error('模型配置过长');
	}
	const url = new URL(baseURL);
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
	return {
		baseURL: baseURL.replace(/\/+$/, '').replace(/\/chat\/completions$/, ''),
		model: model.trim(),
		apiKey: apiKey.trim(),
	};
}

export function createNarrationMiddleware(upstreamFetch: typeof fetch = fetch) {
	let activeRequests = 0;
	const concurrency = narrationConcurrency();
	return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
		if (request.method === 'GET') {
			json(response, 200, publicNarrationProviderConfig());
			return;
		}
		if (request.method === 'PUT') {
			if (!acceptsContentType(request, 'application/json')) {
				json(response, 415, { error: '需要 application/json' });
				return;
			}
			try {
				const input = (await readBody(request)) as Record<string, unknown>;
				await updateNarrationProviderConfig({
					baseURL: typeof input.baseURL === 'string' ? input.baseURL : undefined,
					model: typeof input.model === 'string' ? input.model : undefined,
					apiKey: typeof input.apiKey === 'string' ? input.apiKey : undefined,
				});
				json(response, 200, publicNarrationProviderConfig());
			} catch (error) {
				json(response, 400, {
					error: error instanceof Error ? error.message : '模型配置保存失败',
				});
			}
			return;
		}
		if (request.method !== 'POST') {
			json(response, 405, { error: '仅支持 GET/POST' });
			return;
		}
		if (!acceptsContentType(request, 'application/json')) {
			json(response, 415, { error: '需要 application/json' });
			return;
		}
		if (activeRequests >= concurrency) {
			json(response, 429, { error: `讲稿请求已达到并发上限 ${concurrency}，请稍后重试` });
			return;
		}
		activeRequests += 1;
		const controller = new AbortController();
		const closed = () => {
			if (!response.writableEnded) {
				controller.abort();
			}
		};
		response.once('close', closed);
		let phase = 'input';
		try {
			const raw = (await readBody(request)) as Record<string, unknown>;
			const material = narrationMaterialSchema.parse(raw.material);
			if (JSON.stringify(material).length > 14000) {
				throw new Error('本页材料过长，请拆分或精简');
			}
			const connection = connectionOf(raw.connection);
			phase = 'provider';
			const start = Date.now();
			const targetChars = { brief: 300, standard: 600, detailed: 1000 }[material.detail];
			// Include JSON IDs/source arrays as well as Chinese narration in the output budget.
			const structureChars = JSON.stringify(
				material.events.map((e) => ({ shotId: e.id, text: '', sources: e.targets })),
			).length;
			const initialBudget = Math.min(
				6144,
				Math.max(4096, Math.ceil(targetChars * 2 + structureChars)),
			);
			const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]);
			let retryInstruction = '';
			for (let attempt = 0; attempt < 2; attempt++) {
				signal.throwIfAborted();
				const maxTokens = attempt === 0 ? initialBudget : 8192;
				const lengthInstruction = `本页所有节点讲稿合计尽量不超过 ${targetChars} 个汉字，避免重复讲解。每个节点的 sources 只列必要来源，不要罗列全部历史内容。`;
				const upstream = await upstreamFetch(`${connection.baseURL}/chat/completions`, {
					method: 'POST',
					redirect: 'error',
					signal,
					headers: {
						Authorization: `Bearer ${connection.apiKey}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: connection.model,
						temperature: 0.3,
						max_tokens: maxTokens,
						messages: [
							{
								role: 'system',
								content: `${NARRATION_SYSTEM_PROMPT}\n${lengthInstruction}${retryInstruction}`,
							},
							{ role: 'user', content: JSON.stringify(material) },
						],
					}),
				});
				if (!upstream.ok) {
					throw new Error(`模型服务返回 HTTP ${upstream.status}，请检查配置或稍后重试`);
				}
				const data = (await upstream.json()) as {
					choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
				};
				const choice = data.choices?.[0];

				const content = choice?.message?.content
					?.trim()
					.replace(/^```(?:json)?\s*/i, '')
					.replace(/\s*```$/, '');
				try {
					if (!content || content.length > 30000) {
						throw new Error('模型返回空稿或内容过长');
					}
					const draft = parseNarrationDraft(JSON.parse(content), material);
					json(response, 200, {
						draft,
						model: connection.model,
						elapsedMs: Date.now() - start,
						attempts: attempt + 1,
					});
					return;
				} catch (error) {
					if (attempt === 0) {
						retryInstruction =
							choice?.finish_reason === 'length'
								? '\n上次输出被截断。请精简措辞并返回完整 JSON，不输出思考过程。'
								: '\n上次输出未通过结构或来源校验。必须返回全部节点且保持顺序；每段非空讲稿必须在 sources 填写当前及此前 targets 中的真实 ID（不能编造）。没有可用内容的节点返回空 text 和空 sources。';
						continue;
					}
					if (choice?.finish_reason !== 'length') {
						throw new Error(
							`模型结果经自动纠正后仍未通过校验：${error instanceof Error ? error.message : '格式错误'}`,
							{ cause: error },
						);
					}
					throw new Error(
						`模型仍截断输出（已自动重试一次，输出额度 ${maxTokens} tokens）。请使用简明讲解；若使用推理模型，可改用普通聊天模型`,
						{ cause: error },
					);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : '讲稿生成失败';
			json(response, phase === 'input' ? 400 : 502, {
				error: error instanceof SyntaxError ? '模型返回格式不正确，请重试' : message.slice(0, 400),
			});
		} finally {
			activeRequests = Math.max(0, activeRequests - 1);
			response.off('close', closed);
		}
	};
}
