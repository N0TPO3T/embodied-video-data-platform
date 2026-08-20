# Security Policy

本仓库是公开仓库，任何人都可以查看和 fork。请负责任地处理安全问题。

## Reporting a Vulnerability

如果你发现安全漏洞（尤其是认证、授权、数据隔离、密钥处理、注入类问题），**请勿**在公开 issue、讨论或 PR 中披露，以免被恶意利用。

私密上报方式（推荐）：使用 GitHub 的 Private vulnerability reporting——

1. 打开仓库页面 → `Security` 标签 → `Report a vulnerability`；
2. 或直接访问：https://github.com/owoTomCat/embodied-video-data-platform/security/advisories/new

处理承诺：

- 确认有效漏洞后尽快处理（通常 7 天内给出处理计划）；
- 修复发布后再公开披露（responsible disclosure）；
- 披露时可注明报告者（可选）。

## Scope

- 关注范围：`NODE_ENV=production` 部署下可利用的问题。
- 已知设计（不属于漏洞）：本机联调使用可预测的本地预设账号密码，仅用于本地 bootstrap，生产环境（`compose.prod.yaml`）会拒绝使用默认凭据启动。
