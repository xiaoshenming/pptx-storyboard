import { createServer } from 'node:http';

import { afterEach, expect, vi, test } from 'vitest';

import { createNarrationMiddleware } from './narration-api';

afterEach(() => vi.unstubAllEnvs());
const material = {
	version: 1,
	page: 1,
	audience: '学生',
	detail: 'standard',
	supplement: '',
	context: '',
	notes: '',
	warnings: [],
	contents: [{ id: 'c1', text: '体积' }],
	events: [{ id: 's1', kind: 'static', targets: ['c1'] }],
};
async function serve(upstream: typeof fetch, run: (url: string) => Promise<void>) {
	const server = createServer(createNarrationMiddleware(upstream));
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
	try {
		await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => {
			server.close(resolve);
		});
	}
}

test('uses one compact request and validates returned node IDs', async () => {
	vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-key');
	const upstream = vi.fn(async (_url, init) => {
		const body = JSON.parse(String(init?.body));
		expect(body.messages).toHaveLength(2);
		expect(JSON.parse(body.messages[1].content).events[0].id).toBe('s1');
		return Response.json({
			choices: [
				{
					message: {
						content: JSON.stringify({
							nodes: [{ shotId: 's1', text: '我们来认识体积。', sources: ['c1'] }],
						}),
					},
				},
			],
		});
	}) as unknown as typeof fetch;
	await serve(upstream, async (url) => {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ material }),
		});
		expect(response.status).toBe(200);
		expect((await response.json()).draft.nodes[0].text).toContain('体积');
	});
});

test('never forwards the server key to a client-selected provider', async () => {
	vi.stubEnv('DEEPSEEK_API_KEY', 'private-server-key');
	const upstream = vi.fn() as unknown as typeof fetch;
	await serve(upstream, async (url) => {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				material,
				connection: { baseURL: 'https://example.com/v1', model: 'test' },
			}),
		});
		expect(response.status).toBe(400);
		expect(upstream).not.toHaveBeenCalled();
	});
});

test('allocates enough output budget and retries truncation once without adding conversation history', async () => {
	vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
	const budgets: number[] = [];
	const upstream = vi.fn(async (_url, init) => {
		const body = JSON.parse(String(init?.body));
		budgets.push(body.max_tokens);
		expect(body.messages).toHaveLength(2);
		if (budgets.length === 1) {
			return Response.json({
				choices: [{ finish_reason: 'length', message: { content: '{"nodes":[' } }],
			});
		}
		return Response.json({
			choices: [
				{
					finish_reason: 'stop',
					message: {
						content: JSON.stringify({
							nodes: [{ shotId: 's1', text: '先认识体积。', sources: ['c1'] }],
						}),
					},
				},
			],
		});
	}) as unknown as typeof fetch;
	await serve(upstream, async (url) => {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ material }),
		});
		expect(response.status).toBe(200);
		expect(budgets).toHaveLength(2);
		expect(budgets[0]).toBeGreaterThanOrEqual(4096);
		expect(budgets[1]).toBeGreaterThan(budgets[0]);
	});
});

test('accepts a fully valid draft even when the provider labels it length', async () => {
	vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
	const upstream = vi.fn(async () =>
		Response.json({
			choices: [
				{
					finish_reason: 'length',
					message: {
						content: JSON.stringify({
							nodes: [{ shotId: 's1', text: '体积讲解。', sources: ['c1'] }],
						}),
					},
				},
			],
		}),
	) as unknown as typeof fetch;
	await serve(upstream, async (url) => {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ material }),
		});
		expect(response.status).toBe(200);
		expect(upstream).toHaveBeenCalledOnce();
	});
});

test('bounds repeated truncation to two requests and reports the exhausted budget', async () => {
	vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
	const upstream = vi.fn(async () =>
		Response.json({ choices: [{ finish_reason: 'length', message: { content: '' } }] }),
	) as unknown as typeof fetch;
	await serve(upstream, async (url) => {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ material }),
		});
		expect(response.status).toBe(502);
		expect(upstream).toHaveBeenCalledTimes(2);
		expect((await response.json()).error).toContain('8192');
	});
});

test('repairs a missing source reference once rather than requiring a manual regeneration', async () => {
	vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
	let calls = 0;
	const upstream = vi.fn(async (_url, init) => {
		calls++;
		const body = JSON.parse(String(init?.body));
		if (calls === 2) {
			expect(body.messages[0].content).toContain('sources');
		}
		return Response.json({
			choices: [
				{
					finish_reason: 'stop',
					message: {
						content: JSON.stringify({
							nodes: [{ shotId: 's1', text: '先看体积。', sources: calls === 1 ? [] : ['c1'] }],
						}),
					},
				},
			],
		});
	}) as unknown as typeof fetch;
	await serve(upstream, async (url) => {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ material }),
		});
		expect(response.status).toBe(200);
		expect(calls).toBe(2);
	});
});
