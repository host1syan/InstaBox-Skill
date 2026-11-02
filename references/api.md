# InstaBox API 参考

基址：`https://api.instabox.sh/v1`
认证：`X-API-Key: <key>`（或 `Authorization: Bearer <key>`）
OpenAPI：`GET /v1/openapi.json`

写操作需 `Idempotency-Key` 头（任意 UUID）。返回 `202` + operation，用 `GET /v1/operations/{id}` 轮询到 `state` 为 `succeeded`/`failed`。

## 机器生命周期

| 方法 | 路径 | 幂等 | 说明 |
|---|---|---|---|
| GET | `/machines` | — | 列表，支持 `limit`/`cursor`/`metadata` |
| POST | `/machines` | ✓ | 创建。body: `templateId` 或 `snapshotId`（二选一）、`vcpus`、`memMiB`、`persistentDiskGiB`、`env`、`desiredState`、`autoSuspendAfterSeconds`、`maxRunMinutes`、`deleteAfterSeconds`、`archiveSeconds` |
| GET | `/machines/{id}` | — | 详情 |
| PATCH | `/machines/{id}` | ✓ | 改名、改规格（仅 stopped）、改 `autoSuspendAfterSeconds`、`metadata` |
| DELETE | `/machines/{id}` | ✓ | 删除机器+存储+系统文件。新 key 必须带 `X-Confirm-Delete: <id或name>` |
| POST | `/machines/{id}/start` | ✓ | 启动/从挂起恢复。body 可选 `{}`/`vcpus`/`memMiB`/`vault` |
| POST | `/machines/{id}/stop` | ✓ | 关机，文件保留 |
| POST | `/machines/{id}/suspend` | ✓ | 挂起，保留进程 |
| POST | `/machines/{id}/resume` | ✓ | 恢复挂起 |
| POST | `/machines/{id}/wake` | — | 记录活动；空闲挂起时最多等 45s。不需要 Idempotency-Key |
| POST | `/machines/{id}/fork` | ✓ | 同主机复制，不产生快照 |

## 执行

`POST /machines/{id}/exec`

```json
{ "cmd": "bash -lc 的字符串", "argv": ["prog","arg"], "cwd": "/data", "envs": {"K":"V"}, "stdin": "...", "noHistory": true }
```

`cmd` 与 `argv` 二选一（`cmd` 优先，空串视为无）。`cmd` 上限 64 KiB。`cwd` 默认 `/data/home`，不存在则 exit 1。`argv` 无 shell 展开。

响应 `ExecResult`：`stdout`、`stderr`、`exitCode`（128+N 表示信号 N，124 表示超时）、`invalidUtf8`、`oomKilled`/`oomKill`、`diskWarning`、`signal`。

`GET /machines/{id}/history` — 历史命令；`GET /machines/{id}/history/{execId}` — 单条含输出。

## 文件

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/machines/{id}/files?path=/abs` | 目录返回 entries；普通文件返回 `content`。以 root 读（sudo） |
| PUT | `/machines/{id}/files?path=/abs` | 请求体原始字节写入，上限 5 GiB。可选 `mode`、`parents` |
| GET | `/machines/{id}/files/content?path=/abs` | 原始字节下载 |
| POST | `/machines/{id}/files/upload-url` | 取签名上传 URL |

`path` 必须绝对路径，≤4096 字节。目录列举最多 5000 项。

## 端口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/machines/{id}/ports` | 已发布端口 |
| POST | `/machines/{id}/ports` | `{port, protocol, access, name, rotateToken}`。`protocol`: `http`(默认)/`tcp`；`access`: `public`(默认)/`private`(仅 http) |
| DELETE | `/machines/{id}/ports/{port}` | 撤销发布，断开连接 |
| GET | `/ports` | 全账号的已发布端口 |

`port` 必须 1024-65535，5901（desktop）与 6768（Orca）保留。`tcp` 仅付费计划。

响应含 `url`；私有端口返回 `tokenUrl`（带 token 才能访问）。

## 快照

| 方法 | 路径 | 幂等 | 说明 |
|---|---|---|---|
| GET | `/snapshots` | — | 列表 |
| POST | `/machines/{id}/snapshots` | ✓ | `{name, description, rootOnly}`。stopped → 同步 201；running → live 202 pending |
| GET | `/snapshots/{id}` | — | 详情 |
| DELETE | `/snapshots/{id}` | ✓ | 删除 |
| GET | `/snapshots/{id}/files?path=` | — | 读快照系统文件 |
| POST | `/machines/{id}/restore` | ✓ | `{snapshotId}` 就地回滚磁盘 |

快照名 1-63 字符 `[a-z0-9-]`，字母或数字开头，全局唯一。

## 观测

| 路径 | 说明 |
|---|---|
| `/machines/{id}/logs` | 控制台启动日志 + 最近 operation |
| `/machines/{id}/metrics` | CPU/内存/网络/磁盘 IO，30s 一个采样 |
| `/machines/{id}/disk` | `/data` 与 `/` 用量、`usedPct`、`level`(ok/high/critical) |
| `/machines/{id}/processes` | 进程列表 |
| `/machines/{id}/usage` | 计费用量 |
| `/machines/{id}/history` | exec 历史 |

## 保活 / 租约

`PUT /machines/{id}/activity-leases/{leaseID}`

```json
{ "ttlSeconds": 900 }
```

30-3600 秒，0 或缺省为 300。会先唤醒空闲挂起的机器。不需要 Idempotency-Key。到期后开始完整空闲计时。显式生命周期操作会使租约失效。每机最多 128 个活跃租约。

`DELETE /machines/{id}/activity-leases/{leaseID}` — 释放，不唤醒。

## 其他

| 路径 | 说明 |
|---|---|
| `/me` | 当前用户与可用规格 |
| `/orgs`、`/orgs/{id}` | 组织、限额、本月用量、`allowedSpecs` |
| `/templates` | 可用模板 |
| `/usage` | 存储用量、本月费用、余额 |
| `/operations/{id}` | 异步操作进度 |
| `/machines/{id}/access` | Terminal/VNC 连接 URL + 短时票据 |
| `/machines/{id}/desktop`、`/desktop/stream` | 桌面状态与浏览器串流链接 |
| `/machines/{id}/ssh-tokens` | 免密 SSH token |
| `/machines/{id}/connection-info` | SSH 连接方式 |
| `/vault`、`/orgs/{id}/secrets` | 密钥注入（会话态专用） |
| `/orgs/{id}/webhooks` | webhook 管理 |

## 错误码

`error.code` 与 HTTP 状态一一对应：

| code | HTTP | 处理 |
|---|---|---|
| `missing_key` / `invalid_key` / `expired_key` / `revoked_key` | 401 | 换 key |
| `missing_scope` / `insufficient_scope` | 403 | key 权限不足 |
| `permission_denied` | 403 | 越权（如改 `host`） |
| `not_found` | 404 | 资源不存在 |
| `bad_request` / `unknown_field` | 400 | 参数错，检查 body 字段名 |
| `operation_conflict` | 409 | 有操作在进行，响应带 `operationId` |
| `machine_cooldown` | 409 | maxRun 后冷却期，等 `cooldownUntil` |
| `machine_not_running` | 409 | 机器没跑 |
| `idempotency_conflict` | 409 | 同一 Idempotency-Key 复用了不同 body |
| `quota_exceeded` / `concurrency_limit` / `rate_limited` | 429 | 退避重试 |
| `spec_not_allowed` | 400 | 规格不在计划允许范围 |
| `early_allowance_ended` / `credit_exhausted` / `spend_limit_reached` | 402 | 额度用尽 |
| `no_space` / `too_large` | 413/507 | 文件太大或磁盘满 |
| `no_capacity` / `host_unavailable` | 503 | 暂时没资源，重试 |
| `internal` | 500 | 服务端错误 |

每个错误响应带 `docs_url`（`https://instabox.sh/docs/errors#<code>`，下划线转连字符）。
