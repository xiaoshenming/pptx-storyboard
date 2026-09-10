import { TtsError } from './errors';

interface ParsedWav {
	format: Buffer;
	data: Buffer;
	byteRate: number;
}

function parseWav(wav: Buffer): ParsedWav {
	if (
		wav.length < 12 ||
		wav.toString('ascii', 0, 4) !== 'RIFF' ||
		wav.toString('ascii', 8, 12) !== 'WAVE'
	) {
		throw new TtsError('Tencent TTS returned invalid WAV audio', { kind: 'response' });
	}
	let format: Buffer | undefined;
	const dataChunks: Buffer[] = [];
	for (let offset = 12; offset + 8 <= wav.length;) {
		const id = wav.toString('ascii', offset, offset + 4);
		const size = wav.readUInt32LE(offset + 4);
		const bodyStart = offset + 8;
		const bodyEnd = bodyStart + size;
		if (bodyEnd > wav.length) {
			throw new TtsError('Tencent TTS returned a truncated WAV chunk', { kind: 'response' });
		}
		if (id === 'fmt ') {
			format = Buffer.from(wav.subarray(bodyStart, bodyEnd));
		}
		if (id === 'data') {
			dataChunks.push(Buffer.from(wav.subarray(bodyStart, bodyEnd)));
		}
		offset = bodyEnd + (size % 2);
	}
	if (!format || format.length < 16 || dataChunks.length === 0) {
		throw new TtsError('Tencent TTS WAV is missing fmt or data', { kind: 'response' });
	}
	const audioFormat = format.readUInt16LE(0);
	const byteRate = format.readUInt32LE(8);
	if ((audioFormat !== 1 && audioFormat !== 3) || byteRate < 1) {
		throw new TtsError('Tencent TTS WAV must contain uncompressed PCM audio', {
			kind: 'response',
		});
	}
	return { format, data: Buffer.concat(dataChunks), byteRate };
}

function sameFormat(left: Buffer, right: Buffer): boolean {
	return left.equals(right);
}

function buildWav(format: Buffer, data: Buffer): Buffer {
	const formatPadding = format.length % 2;
	const dataPadding = data.length % 2;
	const totalLength = 12 + 8 + format.length + formatPadding + 8 + data.length + dataPadding;
	const output = Buffer.alloc(totalLength);
	output.write('RIFF', 0, 'ascii');
	output.writeUInt32LE(totalLength - 8, 4);
	output.write('WAVE', 8, 'ascii');
	output.write('fmt ', 12, 'ascii');
	output.writeUInt32LE(format.length, 16);
	format.copy(output, 20);
	const dataHeader = 20 + format.length + formatPadding;
	output.write('data', dataHeader, 'ascii');
	output.writeUInt32LE(data.length, dataHeader + 4);
	data.copy(output, dataHeader + 8);
	return output;
}

export function getWavDurationMs(wav: Buffer): number {
	const parsed = parseWav(wav);
	return (parsed.data.length / parsed.byteRate) * 1000;
}

export function mergeWavSegments(wavs: readonly Buffer[]): Buffer {
	if (wavs.length === 0) {
		throw new TtsError('At least one WAV segment is required', { kind: 'input' });
	}
	const parsed = wavs.map(parseWav);
	const expectedFormat = parsed[0].format;
	if (parsed.some((item) => !sameFormat(item.format, expectedFormat))) {
		throw new TtsError('WAV segment formats do not match', { kind: 'response' });
	}
	return buildWav(expectedFormat, Buffer.concat(parsed.map((item) => item.data)));
}
