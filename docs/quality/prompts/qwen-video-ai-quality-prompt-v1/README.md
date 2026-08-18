# 千问视频五维质检提示词

提示词版本：`qwen_video_qc_prompt_v2`
适配规则：`video_qc_v1`
输出结构：`video_qc_v1`
推荐模型：`qwen3.7-plus`
复核模型：`qwen3.7-flash`

> 本目录是"当前提示词"的独立存储，目录名 `qwen-video-ai-quality-prompt-v1` 为仓库内标识；逻辑版本见 `manifest.json` 的 `promptVersion`（当前 v2）。新增提示词时复制目录并按版本号命名。

## 文件结构

本目录是单个提示词的独立存储，代码只解析以下三个文件，不再依赖正则提取：

| 文件 | 作用 | 修改方式 |
| --- | --- | --- |
| `manifest.json` | 版本、规则、模型与文件引用等元数据 | 极少修改；格式错误会直接报错 |
| `system.txt` | 系统提示词正文（发给模型的 system message） | 随意修改正文，**不会因格式问题解析失败** |
| `output-example.json` | 标准输出结构（output_contract，用于校验与修复轮） | 修改字段结构时需同步更新后端校验逻辑 |

新增提示词：复制本目录为 `qwen-video-ai-quality-prompt-v2/` 等，修改 `manifest.json` 中的版本号与 `system.txt`。

## 使用说明

`system.txt` 作为千问调用的 system message。调用时还必须提供：

1. 视频或问题片段；
2. “用户输入模板”中的结构化数据（见下）；
3. 后端计算的库存和相似度快照。

模型会计算候选五维分数，并识别语义性的无效计费片段和有效等待片段；生产系统必须按同一规则再次复算分数、合并无效区间并计算结算结果。模型缺少库存或相似度数据时，不得自行猜测第五维，也不得伪造最终分数、计费时长或结算金额。

## 用户输入模板（video_qc_input_v1）

```json
{
  "schema_version": "video_qc_input_v1",
  "video_id": "{{VIDEO_ID}}",
  "analysis_duration_ms": 0,
  "video_input_present": true,
  "media_metadata": {
    "display_width": 0,
    "display_height": 0,
    "display_aspect_ratio": 0,
    "duration_ms": 0,
    "nominal_fps": 0,
    "effective_fps": 0,
    "codec": "",
    "bitrate_bps": 0,
    "file_size_bytes": 0,
    "rotation_degrees": 0
  },
  "technical_metrics": {
    "decodable": true,
    "decoded_duration_ms": 0,
    "black_ratio": 0,
    "freeze_ratio": 0,
    "blur_ratio": 0,
    "underexposure_ratio": 0,
    "overexposure_ratio": 0,
    "timestamp_discontinuity_ratio": 0,
    "detector_windows": []
  },
  "task_context": {
    "submitted_task_name": "",
    "expected_scene_id": "",
    "expected_task_id": "",
    "expected_variant_id": "",
    "prohibited_content_policy": []
  },
  "inventory_context": {
    "snapshot_id": "",
    "mode": "cold_start",
    "authoritative_coefficient": 1,
    "c_scene": 1,
    "c_standard_task": 1,
    "c_variant": 1,
    "current_video_excluded": true
  },
  "similarity_context": {
    "snapshot_id": "",
    "file_hash_exact": false,
    "confirmed_duplicate": false,
    "authoritative_coefficient": 1,
    "s_video": 0,
    "s_segment": 0,
    "s_semantic": 0,
    "matched_duration_ratio": 0,
    "temporal_order_similarity": 0,
    "top_candidates": []
  },
  "previous_model_observations": [],
  "requested_output_schema": "video_qc_v1"
}
```

## 后端校验要求

模型结果写入正式评分前，规则引擎必须再次检查（见 `backend/src/video-quality/video-qc-rule-engine.ts`）：

1. 五个分项分是否等于对应系数乘以 20；
2. 总分是否等于五个未舍入分项之和；
3. 所有时间区间是否在视频时长内；
4. 区间是否重复计时；
5. `C_inventory` 是否来自有效库存快照；
6. `C_unique` 是否与相似度阈值一致；
7. 硬性否决是否满足置信度和时长条件；
8. 模型是否错误地产生通过状态、结算比例或结算金额；
9. 是否存在没有证据时间点的扣分；
10. 是否发生同一根因跨维度重复扣分。
11. 无效计费片段是否与确定性检测区间合并并去重；
12. 必要等待是否被错误剔除；
13. L0～L3 真实操作是否仅因低价值被错误剔除；
14. 手部贴边、局部裁切或自然换手是否被错误认定为无效时长；
15. `billable_duration_ms` 是否等于分析时长减去无效片段并集时长；
16. `scored` 状态是否按最终得分正确匹配 `1.00 / 0.80 / 0.60 / 0.40`；
17. `hard_reject` 是否强制零结算，待处理状态是否保持暂不结算。

任一校验失败时，结果进入 `system_failed` 或人工复核，不能静默采用模型分数。
