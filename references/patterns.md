# 常见任务配方

以下都用 `IBX=~/.claude/skills/instabox/scripts/ibx`。

## 开机并确认服务都活着

```bash
$IBX get | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);console.log(m.state, m.runtime.ready, m.runStartedAt)})'

# 若 state 不是 running
$IBX start

# 验证容器与服务
$IBX exec 'docker ps --format "{{.Names}} {{.Status}}"'
$IBX exec 'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3456/'
$IBX exec 'systemctl is-active cloudflared'
```

## 部署一个容器并给它公网 URL

```bash
$IBX exec 'docker run -d --name app --restart unless-stopped -p 8080:8080 myimage:latest'
$IBX exec 'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/'
$IBX publish 8080 app          # → https://8080-<machine>.instabox.tech
```

`instabox.tech` 的 URL 不带认证，谁拿到都能访问。需要认证时用容器自带的密码层，或用 `access: private` 拿 `tokenUrl`。

## 用 Cloudflare 固定域名暴露服务

机器上装 cloudflared 并作为 systemd 服务常驻，隧道 ingress 指向 `localhost:<port>`：

```bash
$IBX exec 'sudo cloudflared service install <TUNNEL_TOKEN>'   # token 是位置参数
$IBX exec 'sudo systemctl enable --now cloudflared && systemctl is-active cloudflared'
```

同一隧道 ID 只能有一台机器同时在线。从快照克隆的新机器会自动重连同一隧道，但**两台不能同时连着**。

## 拍快照固化环境

```bash
$IBX exec 'docker ps'                       # 确认服务起来了再拍
$IBX snap create mysnap-$(date -u +%m%d)    # running → live snapshot (202)
$IBX snap list                              # 等 status 变 ready

# 从快照起新机
$IBX api POST /machines '{"snapshotId":"sn_xxx","desiredState":"running"}'
```

快照在 running 机器上是 live 的：文件会短暂冻结，`status` 先 `pending` 后 `ready`。**快照不含运行时状态的东西**，比如 quick tunnel 的随机 URL、临时文件——恢复后要重开。

## 回滚磁盘到某个快照

```bash
$IBX exec 'docker ps'          # 先看清当前状态
$IBX restore sn_xxx            # 就地回滚 /data 和系统文件
$IBX exec 'docker ps'          # 确认容器按快照里的状态恢复
```

回滚是破坏性的。先确认快照 ID 对，再执行。

## 大文件传输

exec 的 cmd 和输出都有上限，别用 base64 硬塞。

```bash
$IBX put /data/big.tar ./big.tar            # 5 GiB 上限，流式
$IBX getfile /data/big.tar ./big.tar
$IBX exec 'cd /data && tar xf big.tar'
```

## 让机器长期不掉线

```bash
$IBX keepalive start
$IBX keepalive status
```

free 计划：空闲 30 min 挂起，最大连续运行 480 min。挂起后 `start` 能立刻拉起；maxRun 触发的挂起会进 `cooldownUntil`，期间 `start` 返回 409 `machine_cooldown`，只能等。

保活进程跑在**本机**（not /data/php 沙箱）。本机重启后进程丢失：

```bash
pgrep -f "ibx keepalive" || $IBX keepalive start
```

## 从快照克隆一台新机

```bash
$IBX api POST /machines "$(node -e 'process.stdout.write(JSON.stringify({snapshotId:"sn_xxx",name:"newbox",desiredState:"running"}))')"
# 返回 operation，machineId 是新机器
$IBX wait <operationId>
echo -n <newMachineId> > ~/.instabox/machine
```

从快照创建的新机拿**你自己的计划默认规格**，不是源机器的规格。

## 排查机器起不来

```bash
$IBX get                                    # state / ready / lastError / cooldownUntil / earlyAllowanceEnded
$IBX logs                                   # boot 日志 + 最近的 operation
$IBX metrics                                # CPU/内存趋势，配合 oomKills 判断 OOM
$IBX disk                                   # / 或 /data 满了吗
```

`earlyAllowanceEnded: true` 表示 free 额度用尽，需要先暂停或删掉别的 free 机器。`lastError` 通常直接给出原因。

## 清理

```bash
$IBX unpublish 8080
$IBX snap rm sn_xxx
$IBX rm m_xxx                                  # 删机器，不可逆（自动带 X-Confirm-Delete）
```

删机器会同时删除持久盘和系统文件。动手前把需要的东西 `getfile` 拉下来。
