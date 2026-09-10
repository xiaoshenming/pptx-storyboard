import { describe, expect, it } from 'vitest';

import { narrationToSrt, wordsToSrt } from './subtitles';

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

describe('narrationToSrt', () => {
	it('keeps punctuation and event-level timing from the original narration', () => {
		const output = narrationToSrt([
			{ text: '先算二乘三等于六，再添上两个零。', startMs: 2500, endMs: 6100 },
		]);
		expect(output).toContain('00:00:02,500');
		expect(output).toContain('先算二乘三等于六，再添上两个零。');
	});

	it('splits long narration only at readable punctuation', () => {
		const output = narrationToSrt([
			{
				text: '先把整十数零前面的数相乘，再看乘数末尾有几个零，就在积的末尾添上几个零。',
				startMs: 0,
				endMs: 6000,
			},
		]);
		expect(output).toContain('先把整十数零前面的数相乘，');
		expect(output).toContain('再看乘数末尾有几个零，');
		expect(output).not.toContain('数相\n');
	});
});
