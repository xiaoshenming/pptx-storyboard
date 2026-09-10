import { describe, expect, it } from 'vitest';

import { parseByteRange } from './media-response';

describe('parseByteRange', () => {
	it('parses explicit, open and suffix ranges', () => {
		expect(parseByteRange('bytes=10-19', 100)).toStrictEqual({ start: 10, end: 19 });
		expect(parseByteRange('bytes=90-', 100)).toStrictEqual({ start: 90, end: 99 });
		expect(parseByteRange('bytes=-10', 100)).toStrictEqual({ start: 90, end: 99 });
	});

	it('rejects invalid and out-of-bounds ranges', () => {
		expect(() => parseByteRange('bytes=100-120', 100)).toThrow('INVALID_RANGE');
		expect(() => parseByteRange('items=0-1', 100)).toThrow('INVALID_RANGE');
	});
});
