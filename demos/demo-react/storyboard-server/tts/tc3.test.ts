import { describe, expect, it } from 'vitest';

import { signTc3 } from './tc3';

describe('signTc3', () => {
	it('produces a deterministic TextToVoice authorization header', () => {
		const authorization = signTc3({
			payload: '{"Text":"你好","SessionId":"session-1"}',
			secretId: 'AKIDEXAMPLE',
			secretKey: 'Gu5t9xGARNpq86cd98joQYCN3Bn7bI',
			timestamp: 1551113065,
		});
		expect(authorization).toBe(
			'TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2019-02-25/tts/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=0edc0f58158505d10777003df2974b9c73d9bd852c54e0ded7dccba4eab904e2',
		);
	});
});
