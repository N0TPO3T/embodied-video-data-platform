# AI 快速开发人天工作簿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成一份基于现有代码复用和 AI 辅助开发的一期、二期人天规划 Excel，并量化相对原供应商报价可压减的人天。

**Architecture:** 使用一个临时 JavaScript 构建脚本，通过 `@oai/artifact-tool` 创建四张工作表。明细只保留一个“估算人天”字段，所有阶段、工作包和压减金额使用 Excel 公式汇总；生成后逐表检查公式、数值和渲染效果。

**Tech Stack:** Bundled Node.js、`@oai/artifact-tool`、Excel `.xlsx`、Codex 工作区依赖运行时。

## Global Constraints

- 由 1 名全栈开发者使用 AI 辅助，按单人有效开发日估算。
- 复用现有约 9,500 行前端、领域计算、测试和账号权限实现。
- AI 模型或外部服务接口已就绪；不计算模型训练和算法研发。
- 一期基准必须合计 27.0 人天；风险预留 3.0 人天单独列示，不进入基准开发量。
- 二期建议项必须合计 12.5 人天；当前不做条目人天为 0。
- 当前范围合计必须为 39.5 人天；相对原报价 130.1 人天压减 90.6 人天。
- 原报价文件 `/Users/edy/Downloads/视频采集与分销平台工时评估.xlsx` 保持不变。
- 最终文件保存到 `outputs/019fcabc-e414-7b02-addb-e06f9e8ba4e3/具身智能视频数据平台_AI快速开发人天评估.xlsx`。

---

### Task 1: 固化精简 WBS 和估算数据

**Files:**
- Create: `.codex_tmp_build_ai_effort_workbook.mjs`
- Read: `docs/superpowers/specs/2026-08-04-development-effort-workbook-design.md`
- Read: `README.md`
- Read: `/Users/edy/Downloads/视频采集与分销平台工时评估.xlsx`

**Interfaces:**
- Consumes: 现有代码复用范围、原报价 130.1 人天和已确认的 AI 快速开发口径。
- Produces: `phase1Rows`、`phase2Rows`、`quoteRows` 三组数据；明细统一包含工作包、模块、开发内容、现有基础、AI 实现方式、估算人天、范围状态和验收说明。

- [ ] **Step 1: 写入一期 27.0 人天明细**

一期工作包和人天必须为：账号权限与真实数据层 4.5、团队与成员接口 1.5、上传与媒体处理 5.5、AI 队列与质检接入 6.0、复核资产与统计 2.5、结算余额与人工提现 4.0、部署测试与试运行修复 3.0。

```js
const expectedPhase1ByPackage = new Map([
  ["M0 账号权限与真实数据层", 4.5],
  ["M1 团队与成员接口", 1.5],
  ["M2 上传、对象存储与媒体处理", 5.5],
  ["M3 AI 队列、质检与重复检测接入", 6.0],
  ["M4 人工复核、资产与统计", 2.5],
  ["M5 计价、日结算、余额与人工提现", 4.0],
  ["M6 部署、核心测试与试运行修复", 3.0],
]);
```

- [ ] **Step 2: 写入二期建议项和当前不做项**

二期建议项覆盖采集活动、站内通知、申诉反馈、导出、采购商简易账号与目录、样本申请、交付包、授权记录、规则配置增强和运营统计，总计 12.5 人天。实名、自动支付、发票税费、客服 IM、段位、团队差价、小程序、视频广场、多模态和自建模型平台写入同表，范围状态为“当前不做”，人天为 0。

- [ ] **Step 3: 写入原报价压减对照**

对照表写入原报价的 15 个后台模块和 9 个小程序模块，保留原报价人天。每项标记“一期保留并复用”“二期可选”或“当前删除”，并写明压减原因。表尾用公式汇总原报价 130.1、当前范围 39.5 和压减 90.6 人天。

- [ ] **Step 4: 加入构建前断言**

```js
function assertClose(actual, expected, label) {
  if (Math.abs(actual - expected) > 0.001) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

assertClose(sumDays(phase1Rows), 27.0, "一期基准");
assertClose(sumDays(phase2Rows.filter((row) => row.status === "二期建议")), 12.5, "二期建议");
assertClose(sumDays(phase2Rows.filter((row) => row.status === "当前不做")), 0, "当前不做");
```

- [ ] **Step 5: 运行数据校验**

Run: bundled Node.js 执行 `.codex_tmp_build_ai_effort_workbook.mjs --validate-data`

Expected: 输出 `phase1=27.0 phase2=12.5 current=39.5 reduction=90.6`，退出码为 0。

### Task 2: 创建公式化工作簿

**Files:**
- Modify: `.codex_tmp_build_ai_effort_workbook.mjs`
- Create: `outputs/019fcabc-e414-7b02-addb-e06f9e8ba4e3/具身智能视频数据平台_AI快速开发人天评估.xlsx`

**Interfaces:**
- Consumes: Task 1 的三组数据。
- Produces: `总览`、`一期明细`、`二期明细`、`原报价压减` 四张工作表。

- [ ] **Step 1: 创建工作簿和四张表**

```js
const workbook = Workbook.create();
const overview = workbook.worksheets.add("总览");
const phase1 = workbook.worksheets.add("一期明细");
const phase2 = workbook.worksheets.add("二期明细");
const quote = workbook.worksheets.add("原报价压减");
```

- [ ] **Step 2: 创建一期和二期明细表**

统一列顺序为工作包、模块、开发内容、现有基础、AI 快速实现方式、估算人天、范围状态、验收说明。首条明细位于第 5 行，表尾对 F 列使用 `SUM`；二期另用 `SUMIF` 分别汇总“二期建议”和“当前不做”。

- [ ] **Step 3: 创建原报价压减表公式**

原报价压减表列为原报价区域、原模块、原报价人天、当前判断、当前对应人天、可压减人天、原因。F 列公式为 `=C5-E5`；表尾分别对 C、E、F 列使用 `SUM`。

- [ ] **Step 4: 创建总览公式**

总览使用跨表公式读取一期 27.0、二期 12.5、当前范围 39.5、原报价 130.1 和压减 90.6；风险预留 3.0 放在独立橙色指标卡，不加入当前范围总计。工作包汇总使用 `SUMIF` 从明细表取数。

- [ ] **Step 5: 应用样式和可用性设置**

使用深蓝 `#3370FF` 标题、浅蓝 `#DCE8FF` 表头、二期建议浅绿、当前不做浅灰、风险预留浅橙。冻结前 4 行、开启筛选、文本自动换行、数值格式 `0.0`，隐藏默认网格线并限制列宽，确保说明文字不被截断。

- [ ] **Step 6: 导出工作簿**

Run: bundled Node.js 执行 `.codex_tmp_build_ai_effort_workbook.mjs --export`

Expected: 目标 `.xlsx` 存在，压缩包结构可通过 `unzip -t` 检查。

### Task 3: 数据、公式和视觉验证

**Files:**
- Read: `outputs/019fcabc-e414-7b02-addb-e06f9e8ba4e3/具身智能视频数据平台_AI快速开发人天评估.xlsx`
- Delete: `.codex_tmp_build_ai_effort_workbook.mjs`

**Interfaces:**
- Consumes: Task 2 导出的工作簿。
- Produces: 通过数值、公式和逐表视觉检查的最终 Excel 成品。

- [ ] **Step 1: 检查关键公式和汇总**

检查总览指标、一期总计、二期建议项总计、原报价与压减总计，确认数值分别为 27.0、12.5、130.1 和 90.6，且当前范围总计为 39.5。

- [ ] **Step 2: 扫描公式错误**

使用正则 `#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A` 扫描全工作簿。

Expected: 匹配数为 0。

- [ ] **Step 3: 逐表渲染和检查**

渲染四张工作表，确认标题、指标卡、所有表头、总计和说明完整可见；不存在重叠、截断、异常黑底或空白默认工作表。

- [ ] **Step 4: 修复后重新验证并检查文件完整性**

只修复实际出现的列宽、行高、换行或颜色问题；重新导出后再次运行公式扫描、逐表渲染和 `unzip -t`。

- [ ] **Step 5: 清理辅助文件**

使用补丁删除临时构建脚本，移除临时依赖链接和检查文件；确认交付目录只保留新版 `.xlsx`，原报价文件未被修改。
