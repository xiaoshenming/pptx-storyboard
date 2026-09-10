import type { IncomingMessage } from 'node:http';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLoopbackAddress(address: string | undefined): boolean {
	return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function hasTrustedLocalOrigin(request: IncomingMessage): boolean {
	if (request.headers['sec-fetch-site'] === 'cross-site') {
		return false;
	}
	const origin = request.headers.origin;
	if (!origin) {
		return true;
	}
	try {
		const value = new URL(origin);
		const hostHeader = request.headers.host?.toLowerCase();
		return (
			value.protocol === 'http:' &&
			LOOPBACK_HOSTS.has(value.hostname) &&
			Boolean(hostHeader) &&
			value.host.toLowerCase() === hostHeader
		);
	} catch {
		return false;
	}
}

export function acceptsContentType(request: IncomingMessage, expected: string): boolean {
	return request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === expected;
}
