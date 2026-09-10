import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function argument(name) {
	const index = process.argv.indexOf(name);
	if (index < 0 || !process.argv[index + 1]) {
		throw new Error(`missing ${name}`);
	}
	return process.argv[index + 1];
}

const mediaPath = argument('--media');
const boundariesPath = argument('--boundaries');
const result = spawnSync(
	'ffmpeg',
	[
		'-y',
		'-v',
		'error',
		'-f',
		'lavfi',
		'-i',
		'sine=frequency=440:duration=0.8:sample_rate=24000',
		'-ac',
		'1',
		mediaPath,
	],
	{ encoding: 'utf8' },
);
if (result.status !== 0) {
	throw new Error(result.stderr);
}
writeFileSync(
	boundariesPath,
	JSON.stringify([
		{ text: '函数', startMs: 50, endMs: 350 },
		{ text: '图像', startMs: 370, endMs: 740 },
	]),
);
