# PPT 分镜视频：技术交接文档

交接日期：2026-09-11
工程版本：`storyboard-video-v0.2.0`（见本目录 `VERSION` / `CHANGELOG.md`）
基线 commit：`772f6a49`（annotated tag `storyboard-video-v0.2.0`）
读者：接手后续开发的工程师。读完本文你应当能够独立跑通全流程、定位时间戳相关的任何 bug、并在此之上继续开发。

---

## 1. 一段话说明这套系统

用户在浏览器里导入一份 `.pptx`，系统把每一页的 PowerPoint 原生动画解析成
"点击组"时间轴，自动切成 127 个左右的分镜（shot），为每个分镜生成讲解词，
按**绝对毫秒时间戳**并行合成配音（TTS）与画面分片（NVENC），最终混流成
带字幕的 MP4。全程本地：前端 Vite demo + 本机 Bun 服务端（127.0.0.1）+
FFmpeg。没有云端依赖（Edge TTS 走微软公共端点，无需凭据）。

关键代码位置速查：

| 模块                       | 路径                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| 分镜工作台（前端）         | `packages/react/src/viewer/components/storyboard/`                 |
| 视频流水线服务端           | `demos/demo-react/storyboard-server/`                              |
| 工程手册 / 变更日志 / 版本 | `docs/storyboard-video/`                                           |
| 动画绑定交互审计           | `docs/03-新需求与规划/2026-09-10-PPT动画绑定交互点对点功能审计.md` |

---

## 2. 核心机制：PPT 原生动画的时间戳是怎么来的（重点）

这是本文档的重点。一句话概括数据流：

```text
slide XML 的 <p:timing> 树                       （OOXML，毫秒都在这里）
  → core 解析为 PptxNativeAnimation[]            （逐动画：trigger/delay/duration）
  → shared TimelineEngine 编译为点击组            （onClick 开新组，with/after 挂进当前组）
  → react animation-export 在固定逻辑时钟上展开    （每组得到组内绝对时间 + 稳定状态）
  → storyboard 把每组变成一个分镜                  （事件级 startOffsetMs/durationMs 保留原生值）
  → adapter 把分镜铺到全局时间轴                   （视觉/动画/旁白轨，得到绝对 startMs）
  → 客户端逐分镜捕获"稳定状态"PNG + 上传 manifest  （manifest 里每个时间戳都有回执）
  → 服务端按同一套毫秒渲染分片、adelay 配音、混流   （音画同源，所以天然同步）
```

下面逐步展开。**所有路径均相对仓库根目录**，函数名可直接全局搜索。

### 2.1 第一步：OpenXML 解析（core 包）

PowerPoint 把动画全部存在 slide XML 的 `p:timing / p:tnLst` 树里，本质是一棵
"时间节点树"：每个 `p:par` 节点有一个 `p:cTn`（CT_TLCommonTimeNodeData），
上面的属性带着全部时间信息：

- `@_nodeType`：`clickEffect`（点击触发）/ `withEffect`（与上一动画同时）/
  `afterEffect`（上一动画之后）/ `mouseOver` 等；
- `@_delay` / `@_dur`：本节点的延迟与时长（毫秒，也可能写作秒字符串）；
- `@_presetClass`：`entr`（进入）/ `exit`（退出）/ `emph`（强调）/ `path`（路径）；
- 子节点 `p:childTnLst` 递归嵌套。

解析入口：`packages/core/src/core/services/PptxNativeAnimationService.ts`
的 `parseNativeAnimations(slideXml)`。要点：

1. `resolveSlideTimingNode()` 拿到 `p:timing`（兼容包在
   `mc:AlternateContent` 里的情况，issue #132）；
2. `walkTimingTree()` 从根 `p:par` 递归下行走树，在 每个 `p:cTn` 上：
   - 由 `@_nodeType` 判定触发类型（254 行附近：`afterEffect/afterPrevious`
     映射 `afterPrevious`，`withEffect/withPrevious` 映射 `withPrevious`，
     `clickEffect` 映射 `onClick`）；
   - `delayMs = readTimingAttr(cTn['@_delay'])`，必要时叠加
     `extractStartConditionDelayMs(cTn)`（开始条件里的延迟）；
3. 额外三趟：交互序列（`p:seq` + 触发形状）、媒体节点（`p:audio/p:video`，
   保持时间轴顺序）、构建列表（`p:bldLst` 的 `bldP/bldDgm/bldOleChart`，
   给 `targetId === spid` 的动画挂 `groupId` 与分步构建标记）。

产出：`PptxSlide.nativeAnimations: PptxNativeAnimation[]`
（类型定义：`packages/core/src/core/types/animation.ts:171`）。**每个动画
自带原生毫秒**：`delayMs`、`durationMs`、`triggerDelayMs`、`trigger`、
`presetClass`、`presetSubtype`（飞入方向位掩码）、`accel/decel`（缓入缓出）、
`motionPath`（路径字符串）等。这个数组同时服务于播放器和分镜导出，
是唯一事实源。

调用点：`packages/core/src/core/services/PptxSlideLoaderService.ts:296`
（加载 slide 时执行 `params.parseNativeAnimations(slideXmlObj, path)`）。

注意 targetId 的两种形态：编辑器动画用元素 id；原生动画的 target 是
`<p:spTgt @_spid>`，经
`packages/core/src/core/services/animation-target-reconcile.ts`
（`reconcileAnimationTargets`）对齐到 `slide.elements[].id`。对齐不上的
target 渲染层拿不到元素，标签会回退成"对象 + id 尾部"（见
`storyboard-animation-labels.ts`）。

### 2.2 第二步：点击组编译（shared 包）

文件：`packages/shared/src/render/presentation-animation-controller.ts`

- `animation-timeline-engine.ts` + `animation-timeline-builder.ts`。

`PresentationAnimationController.fromSlide(slide)`（112 行起）：

1. 合并动画来源：原生 `nativeAnimations` + 编辑器尚未保存的运动路径
   （`motionPathNativeAnimations`）+ 编辑器"退出后"终态
   （`applyAfterAnimationFromEditorList`）；
2. 文本构建展开：`p:txEl` 段落/字符范围（`expandTextRangeAnimations`）与
   `p:bldP` 分步构建（`expandTextBuildAnimations`）会把一个 shape 动画
   展开成多个子动画（子元素 id 带 `TEXT_BUILD_ID_SEP` 分隔符）；
3. `TimelineEngine.fromAnimations(expandedAnims)` 编译点击组。

**触发语义**（`animation-timeline-builder.ts` 140 行注释 + 315-400 行实现，
这是时间戳语义的心脏）：

| 原生 trigger               | 编译行为                                                   |
| -------------------------- | ---------------------------------------------------------- |
| `onClick` / `onShapeClick` | 开启**新点击组**                                           |
| `withPrevious`             | 挂进当前组，`delayMs = 前一步的 delayMs`（+ 自身动画延迟） |
| `afterPrevious`            | 挂进当前组，`delayMs = 前一步 delayMs + 前一步 durationMs` |
| `afterDelay`               | 同 afterPrevious 再加触发延迟                              |

也就是说：**组内每一步的 `delayMs` 是"相对本组开始的毫秒"**，同起动画
天然同组同起点，顺序动画天然级联。这就是"原生动画时间戳"的第一层，
完全来自 PPT 文件本身，没有任何启发式。

`TimelineEngine` 还处理了 OOXML 的 `@concurrent`/`@nextAc` 门控
（`shouldBlockNextAdvance`：某些组应当"吞掉"下一次点击），以及交互序列
（点形状触发）与 hover 序列的独立组列表。

### 2.3 第三步：固定逻辑时钟与采样（react 包，导出专用）

文件：`packages/react/src/viewer/components/storyboard/animation-export/compile-slide-animation.ts`

- `fixed-logical-clock.ts`。

`compileSlideAnimationExport(slide)` 把引擎的交互式时间轴"压平"成一份
**确定性导出时间轴**：

```ts
const clock = new FixedLogicalClock(fps=30, originMs=0);   // 不用 Date.now()！
let cursorMs = 0;
while (controller.hasMoreSteps()) {
  const startAtMs = cursorMs + (autoAdvance ? autoAdvanceDelayMs : 0);
  const group = controller.advance(startAtMs);            // 拿到点击组
  const groupDurationMs = max(group.totalDurationMs, ...steps(delayMs+durationMs));
  const settleAtMs = startAtMs + groupDurationMs;
  // 在 [startAtMs, settleAtMs] 上按 30fps 采样（sampleAnimationWindow）
  clickGroups.push({ startAtMs, settleAtMs, stateBefore, activeState, settledState, ... });
  cursorMs = settleAtMs;                                   // 下一组从上一组稳定点起算
}
```

产出 `CompiledSlideAnimationExport`：

- `clickGroups[]`：每组带 `startAtMs / settleAtMs`（**页内绝对毫秒**）、
  `stateBefore / activeState / settledState`（三个元素状态快照：
  组前 / 组进行中 / 组稳定后）、`sampleTimesMs`（帧采样点）；
- `initialState`：第 0ms 的状态（进入动画未发生的元素是隐藏的）；
- `keyframesCss`：引擎为每个效果生成的 `@keyframes`（播放器和导出共用）；
- `durationMs`：本页动画总时长（逻辑时钟口径）。

为什么叫"固定逻辑时钟"：播放器跑的是真实 `Date.now()`，而导出必须
可复现，所以导出用 `FixedLogicalClock`（`frameDurationMs = 1000/30`），
同样的输入永远得到同样的时间戳。**这是导出与播放器共用同一套编译器、
但时间语义彼此独立的关键设计。**

三个状态快照的用途：`stateBefore` 是"这一组点击之前世界长什么样"，
`settledState` 是"这一组播完之后长什么样"。分镜视频的每一帧画面
本质上就是这些状态快照（见 2.6）。

### 2.4 第四步：分镜编译（事件级时间戳进入分镜模型）

文件：`packages/react/src/viewer/components/storyboard/storyboard-animation-groups.ts`
的 `buildStoryboardAnimationGroups(slide, slideIndex)`。

原生路径（`nativeGroups`）调用 `compileSlideAnimationExport(slide)`，把每个
点击组变成一个"动画分镜"的动画事件：

```ts
events = compiled.group.steps
	.filter((step) => !step.command) // 媒体命令不是画面事件
	.map((step, stepIndex) => ({
		id: `slide-${slideIndex + 1}-group-${groupIndex + 1}-step-${stepIndex + 1}`,
		targetId: step.elementId, // 经 target-reconcile 对齐过的元素 id
		startOffsetMs: step.delayMs, // ★ 原生时间戳：相对组开始的毫秒
		durationMs: step.durationMs, // ★ 原生时间戳：效果时长
		presetClass: step.presetClass,
		trigger: stepIndex === 0 ? 'onClick' : 'withPrevious', // 编译后近似
	}));
```

`★` 标记的两个字段就是"原生动画时间戳"在分镜模型里的落点：**它们原样
来自 PPT 文件的 `p:timing`，没有经过任何缩放或启发式**。触发类型也做了
一次编译后近似（点击组内首步视为点击触发、其余视为同起），因为分组本身
已经编码了触发语义。

同文件还有编辑器动画路径（`editorGroups`，处理 `slide.animations`，即
查看器内创作、尚未保存为原生 timing 的动画），语义一致。

每个动画分镜的 `durationMs`（分镜画面要停留多久）在
`storyboard-model.ts` 的 `buildStoryboardShots` 里计算：

- 有配音：`max(1800, 最后事件结束 + 1000)`；
- 无配音（讲稿定稿后由 `retimeSilentStoryboardShots` 分级压缩，
  2026-09-11 迭代加入）：全退出类底薪 900ms、揭示类 1300ms、尾距 300ms；
- 初始分镜 2500ms、静态分镜 5000ms。

**这里要特别理解一个设计决定**：分镜时长不是原生动画时长，而是
"原生事件跨度 + 朗读呼吸位"的启发式下限。原因：视频节奏要照顾
旁白朗读速度（约 4.5 字/秒），纯按 PowerPoint 原生时长切分镜会
出现大量 600ms 的碎片镜头。原生时间戳完整保留在事件层；分镜层
只做"不少于 X"的钳制。改节奏策略时改 `retimeSilentStoryboardShots`，
不要动事件层。

### 2.5 第五步：铺到全局时间轴（绝对毫秒的唯一来源）

文件：`storyboard-timeline-adapter.ts` 的 `buildStoryboardTimeline(shots, options)`。

分镜是顺序排列的：`buildTimelineFromStoryboard`（`timeline/storyboard.ts`）
用 `cursor += durationMs` 累出每个分镜的视觉片段绝对 `startMs`；动画事件
clip 的 `startMs = 所在分镜 startMs + event.startOffsetMs`（adapter 27-43 行）。
旁白 clip 的默认 `startMs = 分镜视觉片段 startMs`（可被拖动改写）。

从这一步起，全系统只认一个时间轴：`TimelineModel`
（`timeline/types.ts`），画面/动画/旁白/字幕四轨，所有 clip 都有绝对
`startMs/durationMs`。绑定模型（`timeline/binding.ts`）允许旁白的
`binding` 成为时间事实源、`startMs` 退化为派生值（`resolveBindingStartMs`
按三种模式解析）；导出时 manifest 同时记录 `binding` 与
`resolvedStartMs`，方便事后追溯。

### 2.6 第六步：把时间戳变成画面（客户端关键状态捕获）

文件：`packages/react/src/viewer/components/storyboard/capture/capture-storyboard-shots.tsx`。

每个分镜对应一帧 PNG（"关键状态帧"）：

1. 离屏创建隐藏 stage（`position: fixed; left: -100000px`），React
   `createRoot` 挂 `PresentationStage`（与真实放映共用渲染组件）；
2. 按 `shot.kind` 决定元素状态：
   - `initial`：`compileSlideAnimationExport(slide).initialState`（进入动画
     未发生的隐藏集合）；
   - `animation`：`clickGroups[shot.clickGroupIndex].settledState`
     （**这一组播完后的稳定状态**，来自 2.3 的逻辑时钟编译）；
   - `static`：整页元素全可见；
   - 另有一路 `stateBefore` 用于转场前一帧；
3. `flushSync` 同步提交 React，确保隐藏/显示立即落到 DOM；
4. `renderElementToCanvas(stage, rasterScale=4)` 光栅化 → PNG Blob；
5. `runCapturePool` 4 路并发跑完全部分镜（`capture-pool.ts`），
   进度回调驱动 UI 的"并行捕获分镜 X/127"。

已知边界（也是当前性能瓶颈）：这一步是浏览器 DOM → PNG，19 页
127 分镜约 2-4 分钟（NVENC 流水线本身只有 91 秒）。它捕获的是
**状态帧**而不是逐帧动画：成片里动画表现为状态之间的平滑过渡
（服务端 `transitionMs` 交叉淡化），不逐帧复刻 PowerPoint 的运动路径。
这是 `docs/storyboard-video/README.zh-CN.md` 里明确写的产品边界。

### 2.7 第七步：服务端按同一套毫秒出片

manifest 是前后端的时间戳合同（`storyboard-job-client.ts` 的
`buildStoryboardManifest`，纯函数有单测）：

```jsonc
{
  "version": 1,
  "fps": 30,
  "shots": [{ "id": "...", "startMs": 0, "durationMs": 2500,
              "startFrame": 0, "frameCount": 75,
              "transitionMs": 600,          // 动画分镜：min(1200, max(150, 事件时长))
              "previousFrameFile": "frames/00000.png" }],
  "narrationClips": [{ "id": "...", "startMs": 2500,
                       "startSample": 120000,      // = startMs/1000*48000
                       "binding": {...},           // 绑定回执（可无）
                       "resolvedStartMs": 2500 }],
  "bindingRevision": 3
}
```

服务端 `demos/demo-react/storyboard-server/render/`：

- `timing.ts` `compileRenderTiming`：把 manifest 毫秒换算成采样点
  （`startSample = round(startMs/1000 * 48000)`）与分片边界；
- `video-renderer.ts`：每个 shot 一段 `segment-XXXXX.mp4`（8 路
  NVENC 并行，帧 PNG + `transitionMs` 交叉淡化），concat 出
  `storyboard-video.mp4`（无音轨中间产物），再按 `adelay={startSample}S`
  把每段配音精确放到它在时间轴上的位置，混流出 `storyboard.mp4`
  （**最终产物，receipt 的 SHA 指向它**）；
- `output-verifier.ts`：ffprobe 流信息 + 完整解码 + 时长校验，
  任何一项失败任务即 `failed`。

**音画同步为什么天然成立**：画面分片的边界和配音的延迟都由同一个
manifest 的同一批 `startMs` 推导（画面用帧号 `startFrame = ms*30/1000`，
配音用采样点 `startSample = ms*48/1000`），没有两套时钟。

### 2.8 时间戳相关的验收清单（改代码后必做）

```bash
ffprobe -v error -show_streams -show_format storyboard.mp4   # 流完整
ffmpeg -v error -i storyboard.mp4 -f null -                  # 完整解码零错误
sha256sum storyboard.mp4                                      # 与 job.json execution.outputSha256 一致
# 旁白锚点：manifest 里每条 narration.startMs 应等于对应视觉事件 startMs
# SRT：单调递增、无重叠（验证脚本见 /tmp/verify-storyboard-output.py 的思路）
```

仅凭 HTTP 200、任务 `completed` 或 MP4 存在不算成功。

---

## 3. 其他关键模块（速览）

### 3.1 绑定模型（2026-09-11 落地）

- `timeline/binding.ts`：`TimelineBinding { anchorType:'animation-event',
anchorId, mode: before|with|after, offsetMs, locked }`。绑定是唯一
  事实源，`startMs` 是派生值；`applyNarrationBindings` 在每次编辑后
  把绑定旁白吸回解析位置。NaN 在写入路径被拒绝（防时间轴污染），
  锁定在模型层收口（UI 守护只是体验层）。
- `timeline-drag-controller.ts`：拖拽状态机。拖动中悬置绑定（每帧先
  detach 再 move，防止 Studio 的 `applyNarrationBindings` 把卡片弹回
  锚点）；松手按 `resolveNarrationDrop` 决策：8px 磁吸内绑定、自由落点
  解绑；亚阈值抖动（≤3px）不产生任何帧提交；pointercancel 按原绑定回弹。
- `NarrationBindingEditor.tsx`：点击即绑定入口之一；建议规则
  `defaultBindingForNarration` = 同分镜内"首个有文本的进入动画"，
  跨分镜不建议（单一事实源，右键菜单共用）。
- 已知边界：静态分镜（本页无动画）不能绑定本分镜锚点；跨分镜绑定
  模型允许但入口在"高级"折叠区。

### 3.2 讲稿与 TTS

- `script-planner/`：确定性本地讲稿（不依赖 LLM）。规则化消除重复
  话术（`polish.ts`），只讲"当前动画组新增内容"；退出/无文本动画
  默认静音。DeepSeek 仅在用户显式点击"生成讲稿"时使用。
- `storyboard-server/tts/`：Edge 神经语音（免凭据，含超时/取消/有界
  重试）、腾讯云 TC3 签名客户端（需最小权限 CAM 密钥）、本地 espeak
  兜底。4 路并发。

### 3.3 任务系统

- `jobs/`：job-id + `manifest.json` 输入合同 + 子任务状态机
  （tts 83 + render 127 + mux 1）+ `execution.outputSha256` 产物回执；
  仅监听 127.0.0.1，带 `X-Storyboard-Job-Token` 访问令牌。
- 前端 `use-storyboard-autosave.ts`：localStorage 项目快照
  （schema v2，含 `bindingRevision`/`bindingHistory`），300ms 防抖、
  卸载前 flush、写失败转 `error` 态可重试。

---

## 4. 版本管理与提交记录

trunk-based，直接提交 main。Conventional Commits 是承载业务的
（release 流水线按 commit type 决定各包独立版本），type 写错会错升版本。

近期主线提交（2026-09-10/11）：

```text
772f6a49 feat(react): 时间轴点击动画即绑定旁白（开关语义）
08465d94 fix(react): 修复绑定建议误导并补齐绑定面板语义解释
e497a01f feat(react): 优化分镜静音节奏与动画锚点标签可读性
3a0fa0c5 docs(storyboard): 标记动画绑定审计的实施状态
c250bc21 feat(react): 实现分镜旁白与原生动画的显式绑定交互
b6cb8762 docs(storyboard): 定义动画事件绑定交互
```

本次交接动作：`VERSION` 0.1.1 → 0.2.0（绑定交互是 feature 级），
`CHANGELOG.md` 增补 0.2.0 条目，打 annotated tag
`storyboard-video-v0.2.0`。回滚参照工程手册：`git show
storyboard-video-v0.2.0` 查看、从 bundle/tag 建分支比较，
**不要在有用户改动的工作区直接回退**。

---

## 5. 如何跑 / 如何验收 / 已知坑

### 启动（分镜生成需要这些环境变量）

```bash
cd /home/ming/data/Project/NodeProject/chap5/pptx-viewer
STORYBOARD_TTS_EDGE=1 STORYBOARD_GPU_ENCODING=1 \
STORYBOARD_RENDER_CONCURRENCY=8 STORYBOARD_TTS_CONCURRENCY=4 \
bun run demo -- --host 127.0.0.1 --port 4173
```

建议放 tmux（`tmux new-session -d -s pptx-demo ...`），日志 `tee`
到 `/tmp/pptx-demo.log`。导入 PPTX → 顶部"分镜视频"→ 检查讲稿与
时间轴 →"生成视频"。任务目录：`/tmp/pptx-storyboard-jobs-v1/<job-id>/`
（`job.json` 回执 + `manifest.json` 输入合同 + `storyboard.mp4` 产物）。

### 测试与验收

```bash
cd packages/react && bunx vitest run src/viewer/components/storyboard   # 26 文件 332 测试
bun run typecheck && bunx oxlint --deny-warnings packages/react/src/viewer/components/storyboard/
```

当前实测基线（《口算乘法》19 页）：127 分镜、83 段配音、6:56 成片、
服务端流水线约 91 秒、静音总时长 75s、最长无讲解段 8.4s、SRT 零重叠、
SHA 与回执一致。

### 已知坑（都是踩过的）

1. **时间轴上的毫秒不是唯一事实源**：绑定旁白的 `startMs` 是派生值，
   `binding` 才是。手改 startMs 不改 binding 会在下一次
   `applyNarrationBindings` 被吸回去。
2. **NaN 会污染整条时间轴**：`Math.max(0, NaN) === NaN` 会经
   `timelineDuration` 传播。所有写路径已加 `Number.isFinite` 防御
   （`binding.ts`），新增写路径必须同样防御。
3. **拖拽与绑定的相互作用**：拖动中若不悬置绑定，每次 pointermove
   都会被 `applyNarrationBindings` 弹回锚点（"橡皮筋"）。逻辑在
   `timeline-drag-controller.ts`，改动前先读它的状态机注释。
4. **受控回路测试必须回灌**：测时间轴交互时 onChange 的结果要经
   `applyNarrationBindings(reconcileNarrationTiming(...))` 回灌
   props 再渲染（见 `MultiTrackTimeline.test.tsx` 的
   controlledTimeline harness），否则测不出与 Studio 集成才暴露的问题
   （P0 橡皮筋 bug 就是这么漏过的）。
5. **锚点排序依赖 sortClips**：tie-break 是码点序不是 localeCompare
   （跨 ICU 环境确定性），有判别性测试盯着（`timeline/model.test.ts`）。
6. **localStorage 快照会"复活"旧时间轴**：改了时长/节奏策略后联调，
   必须清掉 `pptx-viewer:storyboard-project:v1:*` 与 IndexedDB
   （`pptx-viewer-session`），否则恢复的旧快照盖过新策略。
7. **每次提交前确认分支**：工作树可能被并行会话共享，
   `git branch --show-current` 先看一眼。
8. **源文件 ≤ 300 行、禁止 em-dash（U+2014）**：都是 CI/评审硬规则，
   提交钩子会跑 oxfmt/oxlint。

---

## 6. 后续开发路线建议

按优先级（依据：审计文档 + 2026-09-10/11 客户反馈）：

1. **E2 真实动画帧预览**（唯一剩余的 🔴 项）：预览区接
   `PresentationStage` + `stage-web-animations.ts`（Web Animations API
   驱动已就绪），按 playhead seek 动画，让时间轴拖动时看到动画
   中间帧而不只是稳定状态。依赖：`computePlayheadState` 已就绪。
2. **捕获性能**：DOM→PNG 是全流水线瓶颈（2-4 分钟 vs 编码 91 秒）。
   方向：OffscreenCanvas + Web Worker 池、或按页缓存已捕获状态
   （内容没变就跳过）。
3. **逐帧运动路径**（⚪ 已确认延后）：当前是状态间平滑过渡；若客户
   要求 fly-in 路径逐帧复刻，需要在服务端对 `motionPath` 做参数化
   插值渲染，成本高，先确认需求再动。
4. **多人协作编辑时间轴**（⚪ 延后）：绑定 schema（v2）稳定后再接
   Yjs 协作层，`bindingHistory` 天然适合做冲突审计。
5. **腾讯云 TTS 正式切换**：适配器已就绪，等专用最小权限 CAM 密钥；
   切换前按 memory 惯例做 canary 与最终 MP4 音画抽验。

---

## 7. 交接自检清单

- [ ] 跑通一次全流程（本文件第 5 节命令）
- [ ] 跑通 `bunx vitest run src/viewer/components/storyboard`（332 测试）
- [ ] 读完第 2 章，能在代码里指出 `startOffsetMs` 的出生地
      （`storyboard-animation-groups.ts` nativeGroups）与消费地
      （`storyboard-timeline-adapter.ts` buildStoryboardTimeline）
- [ ] 理解"事件时间戳是原生值、分镜时长是启发式下限"这条边界
- [ ] 读一遍 `docs/storyboard-video/README.zh-CN.md` 工程手册
