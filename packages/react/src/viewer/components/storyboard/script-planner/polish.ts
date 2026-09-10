import type { StoryboardShot } from '../storyboard-model';

function keyOf(value: string): string {
	return value.replace(/[，。！？、：；,.!?\s]/gu, '').toLocaleLowerCase();
}

function spokenZeroCount(count: string): string {
	return count === '2' ? '两个' : count === '3' ? '三个' : `${count}个`;
}

function completeMultiplications(value: string): string {
	return value.replace(/乘\s*(\d+)\s*等于\s*(\d+)/gu, (match, right, product, offset) => {
		const prefix = value.slice(0, Number(offset));
		if (/\d(?:\s*个\s*[十百千万]?)?\s*$/u.test(prefix)) {
			return match;
		}
		const divisor = Number(right);
		const result = Number(product);
		return divisor > 0 && Number.isInteger(result / divisor)
			? `${result / divisor}乘${right}等于${product}`
			: match;
	});
}

function naturalSentence(raw: string): string {
	const title = raw.trim().match(/^\d+[.、]\s*(口算.+)$/u);
	if (title) {
		return `今天我们学习${title[1]}。`;
	}
	let value = raw.trim().replace(/^(\d+)[.、]\s*/u, (_, number: string) => `第${number}步，`);
	if (!value) {
		return '';
	}
	if (/^00$/u.test(value)) {
		return '在积的末尾添上两个零。';
	}
	if (/^000$/u.test(value)) {
		return '在积的末尾添上三个零。';
	}
	if (/^\d+$/u.test(value)) {
		return `所以结果是${value}。`;
	}
	if (/^\d+\s*个\s*(?:十|百|千)$/u.test(value)) {
		return `也就是${value.replaceAll(' ', '')}。`;
	}
	const unfinishedEquations = value.match(/等于/gu)?.length ?? 0;
	if (unfinishedEquations >= 3) {
		return /随堂练习|教材/u.test(value)
			? '开始随堂练习。请先独立口算，再说一说你是怎样想的。'
			: '先完成这组口算，再观察乘数和积的变化规律。';
	}
	const method = value.match(/^(.+?)等于[，,]\s*(方法[^，,。]+)/u);
	if (method) {
		return `对于${method[1]}，我们再用${method[2]}来计算。`;
	}
	value = completeMultiplications(value)
		.replace(/整十[、，]\s*整百\s*0\s*前面的数/gu, '整十数、整百数中零前面的数')
		.replace(/[？?][，,]\s*\d+[。.]?$/u, '？')
		.replace(/^(.+?)[。，,]\s*课堂小结[。.]?$/u, '课堂小结：$1')
		.replace(/^(.+?)[。，,]\s*活动要求[。.]?$/u, '活动要求：$1')
		.replace(/再在积的末尾添上\s*(\d+)\s*个\s*0(?:[，,]\s*0+)?/gu, (_, count: string) => {
			return `在积的末尾添上${spokenZeroCount(count)}零`;
		})
		.replace(/乘数末尾有几个0/gu, '乘数末尾有几个零')
		.replace(/添上几个0/gu, '添上几个零')
		.replace(/(?<!\d)0(?!\d)/gu, '零');
	if (/等于\s*$/u.test(value)) {
		value = `${value}多少？`;
	}
	if (/等于\s*[，,]\s*想一想$/u.test(value)) {
		value = `想一想，${value.replace(/[，,]\s*想一想$/u, '')}多少？`;
	}
	return /[。！？?！]$/u.test(value) ? value : `${value}。`;
}

export function polishStoryboardScripts(shots: StoryboardShot[]): StoryboardShot[] {
	let previous = '';
	let spokenHistory = '';
	return shots.map((shot) => {
		let script = naturalSentence(shot.script);
		let key = keyOf(script);
		const previousKey = keyOf(previous);
		if (key && previousKey) {
			if (
				key === previousKey ||
				(/^所以结果是\d+$/u.test(key) && keyOf(spokenHistory).includes(key.slice(5)))
			) {
				script = '';
			} else if (/^方法[一二三四五六七八九十\d]+/u.test(key) && key.includes(previousKey)) {
				script = `我们再用${script.match(/^方法[^，,。]+/u)?.[0] ?? '另一种方法'}来算。`;
			} else if (/^\d+[，,]\d+[。.]?$/u.test(script) && previousKey.includes(key)) {
				script = '';
			} else if (/^\d+[，,]\d+[。.]?$/u.test(script)) {
				const numbers = script.match(/\d+/gu) ?? [];
				if (numbers.every((number) => previousKey.includes(number))) {
					script = '';
				}
			} else if (/^\d+乘\d+[。.]?$/u.test(script) && previousKey.includes(key)) {
				script = '';
			} else if (/^乘\s*\d+\s*等于多少/u.test(script)) {
				const count = previous.match(/(\d+个[十百千万])/u)?.[1];
				if (count) {
					script = `${count}${script}`;
				}
			} else if (/在积的末尾添上[两三\d]个零/u.test(key) && previousKey.includes('添上')) {
				script = '';
			}
		}
		key = keyOf(script);
		if (key) {
			previous = script;
			spokenHistory += `，${script}`;
		}
		return {
			...shot,
			script,
			scriptCues: { preCue: '', revealCue: script, postCue: '' },
		};
	});
}
