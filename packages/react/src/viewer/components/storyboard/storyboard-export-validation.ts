import type { StoryboardManifest } from './storyboard-job-client';

const explanations: Record<string, string> = {
	INVALID_SHOT_DURATION: '分镜时长无效或超过 30 分钟',
	INVALID_NARRATION_START: '旁白开始时间无效或超过 4 小时',
	INVALID_START_FRAME: '分镜起始帧无效',
	INVALID_START_SAMPLE: '配音起始位置无效',
	DURATION_OR_SCRIPT_TOTAL_TOO_LARGE: '总时长超过 4 小时或讲稿总量超限',
	INVALID_SCRIPT: '单段讲稿超过 4000 字或格式无效',
	TOO_MANY_SHOTS: '分镜数量超过 500',
	INVALID_JOB_ARCHIVE: '视频任务压缩包无法读取',
	INVALID_NARRATION_SOURCE: '旁白引用了不存在的分镜',
	MANIFEST_TOO_LARGE: '导出清单超过大小限制',
};
export async function storyboardJobError(response: Response): Promise<Error> {
	let code = '';
	try {
		const data = await response.json();
		if (typeof data.error === 'string') {
			code = data.error.slice(0, 200);
		}
	} catch {
		/* non-JSON HTTP failure */
	}
	return new Error(
		`创建视频任务失败：HTTP ${response.status}${code ? ` · ${explanations[code] ?? code} [${code}]` : ''}`,
	);
}
export function assertStoryboardExportReady(manifest: StoryboardManifest): void {
	if (!manifest.shots.length || manifest.shots.length > 500) {
		throw new Error('视频导出需要 1～500 个分镜');
	}
	let total = 0;
	for (const [i, shot] of manifest.shots.entries()) {
		if (!Number.isFinite(shot.durationMs) || shot.durationMs < 100 || shot.durationMs > 1800000) {
			throw new Error(`第 ${i + 1} 个分镜时长无效或超过 30 分钟，请检查时间轴`);
		}
		if (!Number.isSafeInteger(shot.startFrame) || shot.startFrame < 0) {
			throw new Error(`第 ${i + 1} 个分镜起始位置无效，请检查时间轴`);
		}
		if (shot.script.length > 4000) {
			throw new Error(`第 ${i + 1} 个分镜讲稿超过 4000 字`);
		}
		total += shot.durationMs;
	}
	if (total > 14400000) {
		throw new Error('视频总时长超过 4 小时，请缩短讲稿或分批导出');
	}
	const sources = new Set(manifest.shots.map((s) => s.id));
	for (const clip of manifest.narrationClips) {
		if (
			!sources.has(clip.sourceShotId) ||
			!Number.isFinite(clip.startMs) ||
			clip.startMs < 0 ||
			clip.startMs > 14400000
		) {
			throw new Error(`旁白 ${clip.id} 的来源或起始位置无效，请检查时间轴`);
		}
	}
}
