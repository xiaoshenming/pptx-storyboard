import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FrameRun } from './frame-runs';

export async function writeConcatInput(
	workDir: string,
	runs: readonly FrameRun[],
	fps: number,
	signal?: AbortSignal,
): Promise<string> {
	const lines = ['ffconcat version 1.0'];
	for (const [index, run] of runs.entries()) {
		if (signal?.aborted) {
			throw new DOMException('Cancelled', 'AbortError');
		}
		const name = `frame-${String(index).padStart(8, '0')}.png`;
		await symlink(run.framePath, join(workDir, name));
		lines.push(`file '${name}'`, `duration ${(run.frameCount / fps).toFixed(9)}`);
	}
	if (signal?.aborted) {
		throw new DOMException('Cancelled', 'AbortError');
	}
	const finalName = `frame-${String(runs.length - 1).padStart(8, '0')}.png`;
	lines.push(`file '${finalName}'`);
	const manifestPath = join(workDir, 'frames.ffconcat');
	await writeFile(manifestPath, `${lines.join('\n')}\n`, { signal });
	return manifestPath;
}
