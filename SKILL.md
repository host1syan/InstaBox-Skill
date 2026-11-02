---
name: instabox
description: 通过 InstaBox REST API 完全控制云端沙箱机器——开机/关机/挂起、执行命令、读写文件、发布端口、快照与回滚、保活续租、监控磁盘与日志。纯 bash+curl+node 实现，无需官方 CLI。
when_to_use: 操作 InstaBox 沙箱（开机关机、跑命令、传文件、开端口、拍快照、看状态），排查机器为什么没起来，续 activity lease 防止自动挂起，或需要一套可脚本化的云端机器控制接口
user-invocable: true
arguments:
  - action
argument-hint: "ls | start | stop | exec | put | getfile | ports | publish | snap | keepalive | help"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# InstaBox Skill

用 `scripts/ibx` 控制云端沙箱。所有操作走 REST API，不需要装官方 CLI。

## 执行策略

- **直接做，不问确认**——除了删除机器/快照这类不可逆操作，先说明再执行。
- **命令找不到就报错，不要编造结果**。`ibx` 的非零退出码表示失败。
- **先看状态再操作**：`ibx ls` → 确认 `state`/`ready`，再 exec 或发布端口。
- **不要用替代方案糊弄**。做不到就直说（用户明确讨厌凑合方案）。

## 配置

```bash
IBX=~/.claude/skills/instabox/scripts/ibx   # 或用绝对路径

# 一次性配置
mkdir -p ~/.instabox
printf '%s' '<API_KEY>' > ~/.instabox/key && chmod 600 ~/.instabox/key
printf '%s' '<MACHINE_ID>' > ~/.instabox/machine
```

优先级：环境变量 `IBX_API_KEY` / `IBX_MACHINE` > `~/.instabox/key` / `~/.instabox/machine` > 自动取唯一一台机器。

- API 基址 `https://api.instabox.sh/v1`（注意不是 `instabox.sh/api/v1`，那会 404）
- 认证头 `X-API-Key: <key>`
- 写操作需要 `Idempotency-Key` 头（`ibx` 自动生成 UUID）
- 生命周期操作是异步的，返回 `operation`，`ibx` 自动轮询到 `succeeded`

## 常用命令

```bash
$IBX ls                                    # 机器列表：id / name / state / ready / 规格
$IBX get                                   # 机器完整 JSON（spec、storage、runtime、cooldownUntil…）
$IBX start                                 # 启动（suspended/stopped → running），轮询到 ready
$IBX stop                                  # 关机（进程结束，文件保留）
$IBX suspend                               # 挂起（保留进程，可 resume）
$IBX resume                                # 从挂起恢复
$IBX wake                                  # 记录活动 / 等空闲挂起结束（无 Idempotency-Key）

$IBX exec 'docker ps'                      # 沙箱内 bash -lc，cwd 默认 /data/home
$IBX exec 'sudo systemctl status cloudflared'
$IBX exec m_xxx 'ls -la /data'             # 指定机器

$IBX lsfile /data                          # 列目录（目录优先，带 mode/size）
$IBX put /tmp/x.txt ./local.txt            # 上传（5 GiB 上限）
echo hi | $IBX put /tmp/x.txt -            # 从 stdin
$IBX getfile /tmp/x.txt ./out.txt          # 下载

$IBX ports                                 # 已发布端口
$IBX publish 3000 msedge                   # 发布 3000 → 返回 https URL（public）
$IBX publish 3456 claude-cn private        # 私有端口，返回 tokenUrl
$IBX unpublish 3000

$IBX snap list
$IBX snap create mysnap "说明"             # 运行中为 live snapshot（202 pending）
$IBX snap rm sn_xxx
$IBX restore sn_xxx                        # 就地回滚磁盘

$IBX logs | $IBX metrics | $IBX disk | $IBX history | $IBX procs
$IBX api GET /v1/me                        # 任意端点（路径相对 /v1）
$IBX api POST /machines '{"templateId":"agent-browser"}'
```

## 保活

free 计划机器空闲 30 分钟自动挂起，连续运行 8 小时（`maxRunMinutes: 480`）被强制挂起并进入 `cooldownUntil`。保活脚本做两件事：每 780s 续 `activity lease`（ttl 900s），并检查 state，非 running 就 `POST /start`。

```bash
$IBX keepalive start      # setsid 后台，pid 写 ~/.instabox/keepalive.pid
$IBX keepalive status     # 是否在跑 + 最近 6 行日志
$IBX keepalive stop
```

日志在 `~/.instabox/keepalive.log`。**本机（/data/php 沙箱）自身可能重启**，重启后进程丢失，需要重新 `keepalive start`。

注意：`cooldownUntil` 未过时 `start` 会返回 `409 machine_cooldown`，这是预期行为，等 cooldown 结束再拉起。若 `start` 一直失败，用 `$IBX logs` 看 boot 日志和 `lastError`。

## 关键约束

| 项 | 说明 |
|---|---|
| 默认规格 | 4 vCPU / 8 GiB，持久盘 `/data` 20 GiB |
| free 计划 | 空闲 30 min 挂起；`maxRunMinutes` 480 |
| `/data` 属主 | root，`user` 需 `sudo` 才能写 |
| exec 上限 | cmd 64 KiB，输出有上限；大批量数据走 `put` |
| 端口范围 | 1024-65535，5901（desktop）和 6768（Orca）保留 |
| 快照名 | 1-63 字符 `a-z0-9-`，字母或数字开头 |
| 幂等 | 生命周期/PATCH/DELETE 类必须带 `Idempotency-Key` |

## 排错顺序

机器没起来或连不上：

1. `$IBX get` — 看 `state`、`runtime.ready`、`lastError`、`cooldownUntil`
2. `$IBX logs` — 控制台启动日志 + 最近 operation
3. `$IBX metrics` — CPU/内存/网络，判断是否 OOM（`oomKills`）
4. `$IBX disk` — `/` 或 `/data` 是否接近满（>=90% 会告警）
5. `$IBX exec 'systemctl status <svc>'` — 机器起来了但服务没起

错误码含义见 `references/api.md` 末尾。

## 参考

- `references/api.md` — 完整端点表、请求/响应 schema、错误码
- `references/patterns.md` — 常见任务配方（部署服务、开隧道、拍快照、迁移）
