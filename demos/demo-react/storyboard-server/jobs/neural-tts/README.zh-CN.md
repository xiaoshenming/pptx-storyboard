# Edge TTS 候选合成器

`EdgeTtsStoryboardSynthesizer` 实现现有 `StoryboardSynthesizer` 接口，但本目录不负责把它接入
`job-runner` 或 `storyboard-api`。

默认声音为 `zh-CN-XiaoxiaoNeural`。运行时通过 `uvx --from edge-tts` 启动 Python bridge，接收
Edge TTS 的真实 `WordBoundary` 事件，再用 `ffmpeg` 将临时 MP3 转为 24 kHz、单声道、16-bit
PCM WAV。返回时只把 WAV 交给后续视频合成，并从 WAV 数据长度计算真实时长。

```ts
import { EdgeTtsStoryboardSynthesizer } from './neural-tts';

const synthesizer = new EdgeTtsStoryboardSynthesizer({
	voice: 'zh-CN-XiaoxiaoNeural',
	timeoutMs: 60_000,
});
```

可用环境变量：

- `STORYBOARD_EDGE_TTS_VOICE`：默认中文神经声音。
- `STORYBOARD_EDGE_TTS_PITCH`：Edge TTS 音高，例如 `+0Hz`。
- `STORYBOARD_EDGE_TTS_COMMAND`：替代 `uvx` 的 Python 可执行文件；该环境必须已安装 `edge-tts`。

失败边界是显式的：缺少 `uvx`/Python/`ffmpeg`、网络连接失败、服务端限流、超时、空或损坏音频、
缺少词边界会分别失败，不会用静音、均分字幕或旧文件冒充成功。取消会终止合成/转码子进程组并删除
临时 MP3、边界 JSON 和不完整 WAV。
