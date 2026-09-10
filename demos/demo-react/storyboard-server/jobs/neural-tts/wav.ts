import { NeuralTtsError } from './errors';

export function pcmWavDurationMs(wav: Buffer): number {
	if (
		wav.length < 44 ||
		wav.toString('ascii', 0, 4) !== 'RIFF' ||
		wav.toString('ascii', 8, 12) !== 'WAVE'
	) {
		throw new NeuralTtsError('EDGE_TTS_OUTPUT_INVALID', 'Edge TTS 转码结果不是有效 WAV。');
	}
	let byteRate = 0;
	let dataBytes = 0;
	for (let offset = 12; offset + 8 <= wav.length;) {
		const id = wav.toString('ascii', offset, offset + 4);
		const size = wav.readUInt32LE(offset + 4);
		const body = offset + 8;
		if (body + size > wav.length) {
			throw new NeuralTtsError('EDGE_TTS_OUTPUT_INVALID', 'Edge TTS WAV 数据被截断。');
		}
		if (id === 'fmt ' && size >= 16) {
			const format = wav.readUInt16LE(body);
			if (format !== 1) {
				throw new NeuralTtsError('EDGE_TTS_OUTPUT_INVALID', '最终 WAV 必须是 PCM 编码。');
			}
			byteRate = wav.readUInt32LE(body + 8);
		}
		if (id === 'data') {
			dataBytes += size;
		}
		offset = body + size + (size % 2);
	}
	if (byteRate < 1 || dataBytes < 1) {
		throw new NeuralTtsError('EDGE_TTS_OUTPUT_INVALID', 'Edge TTS WAV 缺少音频数据。');
	}
	return Math.round((dataBytes / byteRate) * 1000);
}
