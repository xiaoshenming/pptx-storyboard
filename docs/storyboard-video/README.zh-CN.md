# PPT 分镜视频工程手册

当前工程版本：`storyboard-video-v0.1.0`

## 结论

这是一条可重复执行的本地服务链路，不是逐页手工剪辑：

```text
导入 PPTX
→ 解析 PowerPoint 原生动画
→ 按 onClick / withPrevious / afterPrevious 编译点击组
→ 捕获初始状态与每个动画组的稳定状态
→ 从当前组新增内容生成增量讲稿
→ 将讲稿绑定到该组的绝对时间戳
→ 并行生成 TTS
→ 并行编码视频分片
→ 拼接、混音、生成 SRT
→ ffprobe、完整解码、SHA-256 验收
```

第 6、7、12 页只用于研发阶段的代表性动画样片。正式验证必须从原始 PPTX
重新进入分镜工作台并点击“生成视频”，不能把已捕获的 PNG 或旧任务目录当作
一键生成成功。

## 自动化与人工边界

服务自动完成：

- PPTX 解析、动画点击组编译和并行动画合并；
- 低内存关键状态捕获；
- 讲稿初稿、重复消除和数学表达口语化；
- TTS、字幕、时间轴、分片渲染、混流和任务回执；
- 任务 ID、子任务状态、编码器、并发数、耗时和输出 SHA 记录。

人工可选完成：

- 在分镜工作台修改任意讲稿；
- 在多轨时间轴移动 TTS、调整持续时间或关闭某段字幕；
- 选择腾讯云音色或 Edge 神经音色；
- 对教学表达做最终审核。

历史说明：第一份“完美动画配音视频”在全片复审时，对开场、规则总结和两页
课堂小结共 4 条讲稿做过定向重混。相关问题已归纳为通用讲稿规则并写入
`script-planner/polish.ts`。`v0.1.0` 的最终复现必须使用正式 UI/服务重新生成，
不得注入课件专用讲稿覆盖。

## 启动

```bash
cd /home/ming/data/Project/NodeProject/chap5/pptx-viewer
STORYBOARD_TTS_EDGE=1 \
STORYBOARD_GPU_ENCODING=1 \
STORYBOARD_RENDER_CONCURRENCY=8 \
STORYBOARD_TTS_CONCURRENCY=4 \
bun run demo -- --host 127.0.0.1 --port 4173
```

打开 `http://127.0.0.1:4173/`，导入 PPTX，点击顶部“分镜视频”，检查讲稿和
时间轴后点击“生成视频”。

## 版本与任务身份

- 功能版本：读取本目录的 `VERSION`；
- Git 事实：`git rev-parse HEAD`；
- 发布记录：本目录 `CHANGELOG.md`；
- 本地恢复点：annotated tag `storyboard-video-v0.1.0`；
- 离线备份：Git bundle 文件，使用 `git bundle verify <file>` 验证；
- 运行任务：`/tmp/pptx-storyboard-jobs-v1/<job-id>/job.json`；
- 输入合同：任务目录中的 `manifest.json`；
- 产物身份：`execution.outputSha256`、`outputBytes`、`verifiedDurationMs`。

不要只凭 HTTP 200、任务 `completed` 或 MP4 文件存在判断成功。至少分别验证
动画组数量、配音锚点、字幕时序、媒体流、完整解码和 SHA。

## 当前实现边界

- 原生进入/退出动画会变成逐步披露的关键状态，并在状态之间做平滑过渡；
- `withPrevious` 同起动画保持同组，不会错误拆开；
- 当前导出重点是事件级音画同步，不是逐帧复刻所有 PowerPoint 运动路径；
- 无文本动画默认静音，避免重复讲解；
- DeepSeek 用于用户主动点击“生成讲稿”，没有 Key 时不阻塞本地确定性讲稿；
- Edge 晓晓神经语音适合无凭据本地验证，并带超时、取消和瞬时失败重试；
- 腾讯云适配器已存在，但正式使用必须配置专用最小权限 TTS 密钥，不能长期
  复用权限过宽的 COS 密钥。

## 验收命令

```bash
bunx oxlint --deny-warnings \
  demos/demo-react/storyboard-server \
  packages/react/src/viewer/components/storyboard
bunx vitest run \
  demos/demo-react/storyboard-server \
  packages/react/src/viewer/components/storyboard
bun run --cwd packages/react typecheck
bun run --cwd demos/demo-react build
ffprobe -v error -show_streams -show_format <output.mp4>
ffmpeg -v error -i <output.mp4> -f null -
sha256sum <source.pptx> <output.mp4> <output.srt>
```

验收时还应检查：

- 所有任务均为 `succeeded`；
- 每条 narration 的 `startMs` 等于对应视觉事件的 `startMs`；
- SRT 单调递增且无重叠；
- 开场、动画密集页、练习页和结尾课堂小结均实际播放；
- 不出现“这一页主要讲解”、题号误读或连续重复答案。

## 回滚

查看版本内容：

```bash
git show storyboard-video-v0.1.0
```

不要在有用户改动的工作区直接执行破坏性回退。需要恢复时，从 Git bundle 克隆
到新目录，或基于标签创建新分支后再比较。
