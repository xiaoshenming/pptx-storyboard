import { describe, expect, it } from 'vitest';

import { acceptsContentType, hasTrustedLocalOrigin } from './request-security';

function request(headers: Record<string, string>): import('node:http').IncomingMessage {
	return { headers } as unknown as import('node:http').IncomingMessage;
}

describe('local request security', () => {
	it('accepts same-origin and non-browser requests but rejects cross-site origins', () => {
		expect(
			hasTrustedLocalOrigin(request({ host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' })),
		).toBeTruthy();
		expect(hasTrustedLocalOrigin(request({ host: '127.0.0.1:4173' }))).toBeTruthy();
		expect(
			hasTrustedLocalOrigin(request({ host: '127.0.0.1:4173', origin: 'https://attacker.test' })),
		).toBeFalsy();
		expect(hasTrustedLocalOrigin(request({ 'sec-fetch-site': 'cross-site' }))).toBeFalsy();
	});

	it('requires the exact request media type while allowing charset parameters', () => {
		expect(
			acceptsContentType(
				request({ 'content-type': 'application/json; charset=utf-8' }),
				'application/json',
			),
		).toBeTruthy();
		expect(
			acceptsContentType(request({ 'content-type': 'text/plain' }), 'application/json'),
		).toBeFalsy();
	});
});
