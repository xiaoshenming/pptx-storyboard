import { spawn } from 'node:child_process';

const activeChildren = new Set<ReturnType<typeof spawn>>();
process.once('exit', () => {
	for (const child of activeChildren) {
		child.kill('SIGKILL');
	}
});

export interface CommandResult {
	stdout: string;
	stderr: string;
}

export async function runCommand(
	command: string,
	args: string[],
	options: { signal?: AbortSignal; cwd?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
	if (options.signal?.aborted) {
		throw new DOMException('Cancelled', 'AbortError');
	}
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: false,
			env: {
				PATH: process.env.PATH,
				LANG: process.env.LANG || 'C.UTF-8',
				LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
				CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES,
				NVIDIA_VISIBLE_DEVICES: process.env.NVIDIA_VISIBLE_DEVICES,
			},
		});
		activeChildren.add(child);
		let stdout = '';
		let stderr = '';
		const append = (current: string, chunk: unknown) =>
			`${current}${String(chunk)}`.slice(-64 * 1024);
		child.stdout.on('data', (chunk) => {
			stdout = append(stdout, chunk);
		});
		child.stderr.on('data', (chunk) => {
			stderr = append(stderr, chunk);
		});
		const terminate = () => {
			if (!child.pid || child.killed) {
				return;
			}
			child.kill('SIGTERM');
			setTimeout(() => {
				if (child.exitCode === null) {
					child.kill('SIGKILL');
				}
			}, 2000).unref();
		};
		const abort = () => terminate();
		const timeout = setTimeout(terminate, options.timeoutMs ?? 5 * 60 * 1000);
		timeout.unref();
		options.signal?.addEventListener('abort', abort, { once: true });
		child.on('error', reject);
		child.on('close', (code) => {
			activeChildren.delete(child);
			clearTimeout(timeout);
			options.signal?.removeEventListener('abort', abort);
			if (options.signal?.aborted) {
				return reject(new DOMException('Cancelled', 'AbortError'));
			}
			if (code === 0) {
				return resolve({ stdout, stderr });
			}
			reject(new Error(`${command} exited ${code}: ${stderr.slice(-1600)}`));
		});
	});
}

const encoderProbes = new Map<string, Promise<'h264_nvenc' | 'libx264'>>();

async function probeVideoEncoder(width: number, height: number): Promise<'h264_nvenc' | 'libx264'> {
	if (process.env.STORYBOARD_GPU_ENCODING === '0') {
		return 'libx264';
	}
	try {
		const { stdout } = await runCommand('ffmpeg', ['-hide_banner', '-encoders']);
		if (!stdout.includes('h264_nvenc')) {
			return 'libx264';
		}
		await runCommand('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
			timeoutMs: 5000,
		});
		await runCommand(
			'ffmpeg',
			[
				'-hide_banner',
				'-loglevel',
				'error',
				'-f',
				'lavfi',
				'-i',
				`color=size=${width}x${height}:rate=1`,
				'-frames:v',
				'1',
				'-c:v',
				'h264_nvenc',
				'-f',
				'null',
				'-',
			],
			{ timeoutMs: 10_000 },
		);
		return 'h264_nvenc';
	} catch {
		return 'libx264';
	}
}

export function detectVideoEncoder(width = 1920, height = 1080): Promise<'h264_nvenc' | 'libx264'> {
	const key = `${process.env.STORYBOARD_GPU_ENCODING ?? 'auto'}:${width}x${height}`;
	const existing = encoderProbes.get(key);
	if (existing) {
		return existing;
	}
	const probe = probeVideoEncoder(width, height);
	encoderProbes.set(key, probe);
	return probe;
}
