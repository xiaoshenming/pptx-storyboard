import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Plugin } from 'vite';

const COOKIE_NAME = 'storyboard_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const SESSION_SECRET = createHash('sha256')
	.update(
		`${process.env.APP_SESSION_SECRET || randomBytes(32).toString('hex')}\0${process.env.APP_PASSWORD || ''}`,
	)
	.digest();
const attempts = new Map<string, { count: number; until: number }>();

function configuredPassword(): string {
	return process.env.APP_PASSWORD || '';
}

function digest(value: string): Buffer {
	return createHash('sha256').update(value).digest();
}

function equal(a: string, b: string): boolean {
	return timingSafeEqual(digest(a), digest(b));
}

function signature(payload: string): string {
	return createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

function cookie(value: string, maxAge: number): string {
	const secure = process.env.APP_SECURE_COOKIE === '1' ? '; Secure' : '';
	return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function issueSession(): string {
	const payload = `${Date.now() + SESSION_SECONDS * 1000}.${randomBytes(16).toString('hex')}`;
	return `${payload}.${signature(payload)}`;
}

export function hasAccessSession(request: IncomingMessage): boolean {
	const raw = request.headers.cookie
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${COOKIE_NAME}=`))
		?.slice(COOKIE_NAME.length + 1);
	if (!raw) {
		return false;
	}
	const split = raw.lastIndexOf('.');
	if (split < 0) {
		return false;
	}
	const payload = raw.slice(0, split);
	const expires = Number(payload.split('.', 1)[0]);
	return (
		Number.isSafeInteger(expires) &&
		expires > Date.now() &&
		equal(raw.slice(split + 1), signature(payload))
	);
}

export function hasSameSiteRequest(request: IncomingMessage): boolean {
	if (request.headers['sec-fetch-site'] === 'cross-site') {
		return false;
	}
	const origin = request.headers.origin;
	if (!origin) {
		return true;
	}
	try {
		return new URL(origin).host.toLowerCase() === request.headers.host?.toLowerCase();
	} catch {
		return false;
	}
}

function sendLogin(response: ServerResponse, invalid = false): void {
	response.statusCode = 200;
	response.setHeader('Content-Type', 'text/html; charset=utf-8');
	response.setHeader('Cache-Control', 'no-store');
	response.setHeader(
		'Content-Security-Policy',
		"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
	);
	response.end(
		`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>分镜工作台登录</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;color:#f9fafb;font:16px system-ui,sans-serif}main{width:min(360px,calc(100vw - 48px));padding:32px;border:1px solid #374151;border-radius:16px;background:#1f2937;box-shadow:0 18px 50px #0005}h1{font-size:24px;margin:0 0 8px}p{color:#9ca3af;margin:0 0 24px}label{display:block;margin-bottom:8px}input,button{box-sizing:border-box;width:100%;padding:12px 14px;border-radius:8px;font:inherit}input{color:#fff;background:#111827;border:1px solid #4b5563}button{margin-top:18px;border:0;background:#ec4899;color:#fff;cursor:pointer;font-weight:600}small{display:block;min-height:20px;margin-top:12px;color:#fca5a5}</style></head><body><main><h1>分镜工作台</h1><p>请输入访问密码</p><form method="post" action="/auth/login"><label for="password">访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">进入工作台</button></form><small>${invalid ? '密码错误或尝试次数过多，请稍后重试。' : ''}</small></main></body></html>`,
	);
}

async function readLoginPassword(request: IncomingMessage): Promise<string | null> {
	if (request.headers['content-type']?.split(';', 1)[0] !== 'application/x-www-form-urlencoded') {
		return null;
	}
	let body = '';
	for await (const chunk of request) {
		body += chunk.toString();
		if (body.length > 2048) {
			return null;
		}
	}
	return new URLSearchParams(body).get('password');
}

export function accessPassword(): Plugin {
	const install = (server: {
		middlewares: {
			use: (
				handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void,
			) => void;
		};
	}) => {
		server.middlewares.use((request, response, next) => {
			const path = new URL(request.url || '/', 'http://localhost').pathname;
			if (path === '/auth/status' && request.method === 'GET') {
				response.setHeader('Content-Type', 'application/json; charset=utf-8');
				response.setHeader('Cache-Control', 'no-store');
				response.end(
					JSON.stringify({
						enabled: Boolean(configuredPassword()),
						authenticated: hasAccessSession(request),
					}),
				);
				return;
			}
			if (!configuredPassword()) {
				return next();
			}
			if (path === '/auth/login' && request.method === 'POST') {
				void (async () => {
					if (!hasSameSiteRequest(request)) {
						response.statusCode = 403;
						response.end();
						return;
					}
					const ip = request.socket.remoteAddress || 'unknown';
					const previous = attempts.get(ip);
					const now = Date.now();
					const current =
						previous && previous.until > now ? previous : { count: 0, until: now + 10 * 60 * 1000 };
					const password = await readLoginPassword(request);
					if (current.count >= 10 || !password || !equal(password, configuredPassword())) {
						attempts.set(ip, { count: current.count + 1, until: current.until });
						sendLogin(response, true);
						return;
					}
					attempts.delete(ip);
					response.statusCode = 303;
					response.setHeader('Set-Cookie', cookie(issueSession(), SESSION_SECONDS));
					response.setHeader('Location', '/');
					response.end();
				})().catch(() => {
					response.statusCode = 400;
					response.end();
				});
				return;
			}
			if (path === '/auth/logout' && request.method === 'POST') {
				if (!hasSameSiteRequest(request)) {
					response.statusCode = 403;
					response.end();
					return;
				}
				response.statusCode = 303;
				response.setHeader('Set-Cookie', cookie('', 0));
				response.setHeader('Location', '/');
				response.end();
				return;
			}
			if (hasAccessSession(request)) {
				return next();
			}
			if (request.method === 'GET' && !path.startsWith('/api/')) {
				return sendLogin(response);
			}
			response.statusCode = 401;
			response.setHeader('Content-Type', 'application/json; charset=utf-8');
			response.end(JSON.stringify({ error: 'LOGIN_REQUIRED' }));
		});
	};
	return {
		name: 'storyboard-access-password',
		enforce: 'pre',
		configureServer: install,
		configurePreviewServer: install,
	};
}
