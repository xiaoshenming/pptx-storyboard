import { describe, expect, it } from 'vitest';

import { makePcmWav } from './test-utils';
import { getWavDurationMs, mergeWavSegments } from './wav';

describe('wAV utilities', () => {
	it('merges PCM payloads and reports the combined duration', () => {
		const merged = mergeWavSegments([makePcmWav(125), makePcmWav(375)]);
		expect(merged.toString('ascii', 0, 12)).toMatch(/^RIFF....WAVE$/s);
		expect(getWavDurationMs(merged)).toBe(500);
	});

	it('rejects mismatched WAV formats', () => {
		expect(() => mergeWavSegments([makePcmWav(100, 8000), makePcmWav(100, 16000)])).toThrow(
			'formats do not match',
		);
	});

	it('rejects malformed WAV data', () => {
		expect(() => getWavDurationMs(Buffer.from('not wav'))).toThrow('invalid WAV');
	});
});
