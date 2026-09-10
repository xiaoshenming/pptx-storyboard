import { describe, expect, it } from 'vitest';

import { wordsToSrt } from './subtitles';

describe('wordsToSrt', () => {
	it('emits valid non-overlapping cues when provider timings overlap', () => {
		const output = wordsToSrt([
			{ text: '第一句结束。', startMs: 0, endMs: 2000 },
			{ text: '第二句结束。', startMs: 100, endMs: 400 },
		]);
		expect(output).toContain('00:00:00,000 --> 00:00:02,000');
		expect(output).toContain('00:00:02,000 --> 00:00:02,001');
	});

	it('does not split a short English word at the soft character limit', () => {
		const text = [...'这一页讲解ProjectAtlas，下一部分。'];
		const output = wordsToSrt(
			text.map((character, index) => ({
				text: character,
				startMs: index * 100,
				endMs: (index + 1) * 100,
			})),
		);
		expect(output).toContain('ProjectAtlas，');
		expect(output).not.toContain('ProjectAt\n');
	});
});
