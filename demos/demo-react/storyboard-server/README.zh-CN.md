# PPT 分镜视频本地服务

这套服务负责把前端捕获的 PPT 关键状态，转换为可追踪的后台视频任务：

1. 浏览器并行捕获每个分镜的 1920×1080 PNG。
2. 腾讯云 TTS 按 150 字以内切片，并行合成 WAV 与字幕时间戳。
3. FFmpeg 并行渲染各分镜；真实探测可用的 NVENC，失败自动回退 x264。
4. 按 48kHz 整数采样点放置音频，只在最终阶段编码一次 AAC。
5. 输出 MP4 与 SRT，并通过任务 ID 查询进度、取消和断点查看结果。

## 本地启动

无腾讯凭证的开发模式：

```bash
STORYBOARD_TTS_FAKE=1 STORYBOARD_GPU_ENCODING=1 bun run demo -- --host 127.0.0.1 --port 4173
```

本地普通话配音模式（需要系统安装 `espeak-ng`）：

```bash
STORYBOARD_TTS_LOCAL=1 STORYBOARD_GPU_ENCODING=1 bun run demo -- --host 127.0.0.1 --port 4173
```

高质量中文神经语音模式：

```bash
STORYBOARD_TTS_EDGE=1 STORYBOARD_GPU_ENCODING=1 bun run demo -- --host 127.0.0.1 --port 4173
```

腾讯精品 TTS 模式：

```bash
TENCENT_TTS_SECRET_ID=专用最小权限SecretId \
TENCENT_TTS_SECRET_KEY=专用最小权限SecretKey \
TENCENT_TTS_REGION=ap-guangzhou \
STORYBOARD_GPU_ENCODING=1 \
bun run demo -- --host 127.0.0.1 --port 4173
```

不要复用 COS 或其他服务的长期密钥。正式环境应通过密钥管理系统注入仅允许
`tts:TextToVoice` 的独立凭证。

## 并发参数

| 环境变量                            | 默认行为                       | 上限   |
| ----------------------------------- | ------------------------------ | ------ |
| `STORYBOARD_JOB_CONCURRENCY`        | 同时执行 1 个整片任务          | 3      |
| `STORYBOARD_TTS_CONCURRENCY`        | 按 CPU 自动取 2–6              | 配置值 |
| `STORYBOARD_TTS_CHUNK_CONCURRENCY`  | 单段长文本并行 4 路            | 6      |
| `STORYBOARD_TTS_GLOBAL_CONCURRENCY` | 全进程腾讯请求总闸门           | 见实现 |
| `STORYBOARD_RENDER_CONCURRENCY`     | CPU 最多 4 路，NVENC 最多 8 路 | 4/8    |
| `STORYBOARD_GPU_ENCODING`           | `1` 尝试 NVENC，`0` 强制 x264  | 不适用 |

任务完成后，工作台会展示实际编码器、渲染/TTS 并发数、生成耗时和成片时长。
看到 `GPU NVENC` 才代表 GPU 真正参与编码；配置为 `1` 并不等于 GPU 已启用。

## 本地任务数据

任务快照和中间产物保存在：

```text
/tmp/pptx-storyboard-jobs-v1/<job-id>/
```

每个任务有随机 UUID 和独立访问令牌。服务重启后会恢复已完成任务，并把中断中的
任务标记为失败，避免界面长期显示假运行。任务默认保留两小时。

## 验证

```bash
bun test demos/demo-react/storyboard-server packages/react/src/viewer/components/storyboard
bun run --cwd packages/react typecheck
bun run --cwd demos/demo-react build
```
