# InstaBox Skill

Claude Code skill：通过 InstaBox REST API 控制云端沙箱机器。纯 `bash` + `curl` + `node`，不依赖官方 CLI。

## 能做什么

- 生命周期：创建、启动、停止、挂起、恢复、改名、删除
- 执行：在沙箱内跑 `bash -lc`，读历史命令与输出
- 文件：列目录、上传（最高 5 GiB）、下载原始字节
- 网络：发布/撤销端口，拿到 HTTPS URL（公开或带 token 私有）
- 快照：创建、列表、删除、就地回滚
- 观测：控制台日志、CPU/内存/网络指标、磁盘用量、进程列表
- 保活：续 activity lease + 机器非 running 时自动拉起

## 安装

```bash
git clone https://github.com/host1syan/InstaBox-Skill.git ~/.claude/skills/instabox
chmod +x ~/.claude/skills/instabox/scripts/ibx \
         ~/.claude/skills/instabox/scripts/jq.js
```

配置（key 与默认机器）：

```bash
mkdir -p ~/.instabox && chmod 700 ~/.instabox
printf '%s' '<API_KEY>' > ~/.instabox/key   && chmod 600 ~/.instabox/key
printf '%s' '<MACHINE_ID>' > ~/.instabox/machine
```

也可以走环境变量：`IBX_API_KEY`、`IBX_MACHINE`、`IBX_API`、`IBX_CFG`。

## 用法

```bash
IBX=~/.claude/skills/instabox/scripts/ibx

$IBX ls                                # 机器列表
$IBX get                               # 机器详情 JSON
$IBX start                             # 启动并轮询到 ready
$IBX stop | suspend | resume
$IBX keepalive start|stop|status

$IBX exec 'docker ps'                  # 沙箱内执行
$IBX exec m_xxx 'df -h /data'          # 指定机器

$IBX lsfile /data
$IBX put /tmp/a.txt ./a.txt            # 上传；`-` 或省略表示读 stdin
$IBX getfile /tmp/a.txt ./a.txt        # 下载

$IBX publish 3000 web                  # → https://<port>-<machine>.instabox.tech
$IBX unpublish 3000

$IBX snap list
$IBX snap create mysnap "说明"
$IBX restore sn_xxx

$IBX logs | metrics | disk | history | procs
$IBX api GET /v1/me                    # 任意端点
```

多账号 / 多机器：

```bash
IBX_CFG=~/.instabox/m2 $IBX ls
IBX_CFG=~/.instabox/m2 $IBX exec 'docker ps'
```

## 目录结构

```
SKILL.md                  技能说明：命令、约束、排错
scripts/ibx               主命令
scripts/jq.js             JSON 渲染（列表 / exec / 文件 / 日志 / 指标）
scripts/mkjson.js         请求体构造
references/api.md         端点表、schema、错误码
references/patterns.md    常见任务配方
```

## 实现上的两个坑

- 文件端点 `?path=` 只对空格、`&`、`#`、`?`、`+`、`%` 转义。用 `encodeURIComponent` 会把 `/` 编成 `%2F`，服务端直接 400 `path must be absolute`。
- `node` 若是 bun 的符号链接，`node -e` 的 `process.argv` 拿不到额外参数。参数走环境变量或 stdin，见 `mkjson.js`。

## 前提

- API 基址 `https://api.instabox.sh/v1`，认证头 `X-API-Key`
- 生命周期与删除类请求需要 `Idempotency-Key`（`ibx` 自动生成）
- 删机器需要 `X-Confirm-Delete: <id 或 name>`
- 需要 `curl` 与 `node`（或 bun）
