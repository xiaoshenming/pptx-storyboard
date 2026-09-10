export function makePcmWav(durationMs: number, sampleRate = 16000): Buffer {
	const samples = Math.round((durationMs / 1000) * sampleRate);
	const data = Buffer.alloc(samples * 2);
	const wav = Buffer.alloc(44 + data.length);
	wav.write('RIFF', 0, 'ascii');
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write('WAVE', 8, 'ascii');
	wav.write('fmt ', 12, 'ascii');
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(sampleRate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write('data', 36, 'ascii');
	wav.writeUInt32LE(data.length, 40);
	data.copy(wav, 44);
	return wav;
}
