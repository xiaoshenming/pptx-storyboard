import { describe, expect, it } from 'vitest';

import type { StoryboardShot } from '../storyboard-model';
import { polishStoryboardScripts } from './polish';

function shot(id: string, script: string): StoryboardShot {
	return {
		id,
		slideIndex: 0,
		kind: 'animation',
		label: id,
		effectLabel: '进入动画',
		durationMs: 1800,
		script,
	};
}

describe('polishStoryboardScripts', () => {
	it('reads a numbered title as a lesson introduction instead of a procedure step', () => {
		expect(polishStoryboardScripts([shot('a', '1.口算乘法')])[0].script).toBe(
			'今天我们学习口算乘法。',
		);
	});

	it('turns fragments into speakable sentences and suppresses repeated answers', () => {
		const result = polishStoryboardScripts([
			shot('a', '2个十乘3是6个十，就是60。'),
			shot('b', '60'),
		]);
		expect(result.map((item) => item.script)).toStrictEqual(['2个十乘3是6个十，就是60。', '']);
	});

	it('speaks zero reveals naturally and removes the following duplicate explanation', () => {
		const result = polishStoryboardScripts([
			shot('a', '00'),
			shot('b', '再在积的末尾添上2个0，00'),
		]);
		expect(result.map((item) => item.script)).toStrictEqual(['在积的末尾添上两个零。', '']);
	});

	it('restores omitted multiplication operands from products', () => {
		expect(polishStoryboardScripts([shot('a', '分别与4相乘，乘4等于40，乘4等于8')])[0].script).toBe(
			'分别与4相乘，10乘4等于40，2乘4等于8。',
		);
	});

	it('does not inject an operand when the source already names a unit count', () => {
		expect(
			polishStoryboardScripts([shot('a', '2000表示2个千，2个千乘3等于6个千，就是6000')])[0].script,
		).toBe('2000表示2个千，2个千乘3等于6个千，就是6000。');
	});

	it('suppresses formula and decomposition fragments already spoken by the preceding cue', () => {
		const result = polishStoryboardScripts([
			shot('a', '想一想，12乘4等于多少？'),
			shot('b', '12乘4'),
			shot('c', '第1步，把12分解成整十数10和一位数2'),
			shot('d', '10，2'),
		]);
		expect(result.map((item) => item.script)).toStrictEqual([
			'想一想，12乘4等于多少？',
			'',
			'第1步，把12分解成整十数10和一位数2。',
			'',
		]);
	});

	it('removes stray exercise numbers and normalizes activity labels', () => {
		expect(
			polishStoryboardScripts([shot('a', '坐碰碰车每人12元，3人需要多少钱？，2')])[0].script,
		).toBe('坐碰碰车每人12元，3人需要多少钱？');
		expect(
			polishStoryboardScripts([shot('a', '摆一摆、画一画，写出思考过程。，活动要求')])[0].script,
		).toBe('活动要求：摆一摆、画一画，写出思考过程。');
	});

	it('moves a trailing lesson-summary label to the front', () => {
		expect(
			polishStoryboardScripts([shot('a', '先分别相乘，最后把两个积相加。，课堂小结')])[0].script,
		).toBe('课堂小结：先分别相乘，最后把两个积相加。');
	});

	it('makes the zero-prefix rule natural to speak', () => {
		expect(
			polishStoryboardScripts([
				shot('a', '先把整十、整百 0 前面的数与一位数相乘，再在积的末尾添上几个0'),
			])[0].script,
		).toBe('先把整十数、整百数中零前面的数与一位数相乘，再在积的末尾添上几个零。');
	});

	it('summarizes dense exercise prompts instead of reading every unfinished equation', () => {
		expect(
			polishStoryboardScripts([shot('a', '3乘3等于，30乘3等于，300乘3等于，3000乘3等于')])[0]
				.script,
		).toBe('先完成这组口算，再观察乘数和积的变化规律。');
	});

	it('suppresses a numeric fragment already introduced earlier in the same slide', () => {
		const result = polishStoryboardScripts([
			shot('a', '12乘3等于多少？'),
			shot('b', '方法一'),
			shot('c', '12'),
		]);
		expect(result[2].script).toBe('');
	});
});
