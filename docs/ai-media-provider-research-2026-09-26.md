# AI 媒体生成服务初步研究

日期：2026-09-26。基于第一方 API 文档；未进行付费生成或效果实测。本文件配套 [项目可行性方案](ai-media-feasibility-2026-09-26.md)。

## 首版推荐

采用 **DashScope 图像 + ElevenLabs 音效**，人物关键姿势复用图像服务。推荐依据是公开接口覆盖需求和接入范围可控，不代表已完成跨模型画质、听感或网络可用性评测。具体模型 ID、地区端点与账号权限在接入验证时锁定。

| 场景 | 候选 | 已核实能力 | 接入处理 |
| --- | --- | --- | --- |
| 卡面与角色姿势 | DashScope Wan 图像，例如 wan2.6-image | 文生图、参考图编辑，同步与异步接口 | 异步任务保存远端 ID；下载候选，保留原图和处理版本 |
| 可选图像路线 | DashScope Qwen Image | 官方提供图像生成与编辑模型 | 选定具体版本后再实现其请求结构，不能按聊天接口处理 |
| 短打击音效 | ElevenLabs Sound Effects | POST /v1/sound-generation，描述生成音频，可配置时长等参数 | 按音频二进制流接收；试听、裁切、转换和绑定事件 |
| 角色动作 | 图像关键姿势与本地帧处理 | 生成姿势可作为中间素材 | 透明背景、对齐、角色一致性与状态机需要额外处理和验收 |

DashScope Wan 提供参考图编辑和主体一致性相关能力；不同模式的参考图、格式与数量限制不同。异步结果有有效期，成功后应立即下载到项目，不把远端临时 URL 当持久素材引用。[Wan 图像 API](https://help.aliyun.com/en/model-studio/wan-image-generation-api-reference)

阿里云的图像服务还提供 Qwen Image 生成与编辑，可在阶段 0 用同一组卡面与角色参考需求评估候选模型；首版只实现最终选定的一条图像接口。[图像生成与编辑概览](https://www.alibabacloud.com/help/en/model-studio/image-model)

ElevenLabs 有独立 Sound Effects 接口，默认返回 MP3，并提供其他输出格式；部分格式受套餐约束。研究时接口页和能力页的最短时长描述不一致，实施应按选定模型的接口约束验证，不能用能力宣传页覆盖 API 校验。它与 TTS、音乐生成是不同能力。[Sound Effects API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)、[能力文档](https://elevenlabs.io/docs/overview/capabilities/sound-effects)

## 人物动作的边界

首版流程建议为：参考角色 → 生成关键姿势 → 去背景与脚底锚点对齐 → 人工挑选 → 姿势切换或短帧序列 → 游戏状态绑定。

Wan 视频输出是视频媒体，例如 H.264 MP4；输出规格没有提供可直接替代 Spine 骨骼、蒙皮或 Godot 动画资源的承诺。视频可作参考或抽帧来源，但抽帧后仍需处理背景、轮廓漂移、武器一致性与循环衔接。这是基于输出格式和游戏需求作出的工程判断。[视频生成文档](https://www.alibabacloud.com/help/en/model-studio/use-video-generation)

## 费用与验证

不在初步方案写死生成单价。供应商有模型、地区、套餐和积分换算差异，实际接入时对选定账号核验。ElevenLabs 的计费帮助区分网页与 API，用量预算需要对应实际调用渠道。[计费帮助](https://help.elevenlabs.io/hc/en-us/articles/25735337678481-How-much-does-it-cost-to-generate-sound-effects)、[API 定价](https://elevenlabs.io/pricing/api)

成本估算包括所有候选与重试；用户只采用一张图，也可能已经产生多张候选的费用。默认限制候选数量，下载失败只重试下载，不重新发起生成；结果未知时不静默自动重试付费请求。

接入前验证三件事：账号与网络能否使用；同一角色多姿势是否可接受；生成音效的起音与尾音经处理后能否满足命中反馈。OpenAI 和 MiniMax 未完成本轮对比，不作优劣排名。
