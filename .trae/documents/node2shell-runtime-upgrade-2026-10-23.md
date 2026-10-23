# 紧急安全修复计划：node2shell（CVE-2026-111497）Node.js 运行时升级

> 日期：2026-10-23 ｜ 优先级：紧急（速度第一）｜ 类型：PATCH 安全修复 → V4.1.2-beta

## 1. 摘要 (Summary)

用户指认的 NodeJS 漏洞为 **node2shell / CVE-2026-111497**：Node.js 核心 **Brotli 解码器越界写入，可远程代码执行（RCE）**。Node.js 官方 2026-10-21 安全发布仅覆盖 26.x / 24.x / 22.x 三条线（修复版本 26.12.1 / 24.22.1 / 22.23.4），**20.x 已于 2026-04 EOL，官方明示 EOL 版本受影响但无补丁**。

本站**命中**：生产服务经 `fnm exec --using 20` 跑 **v20.20.2**（EOL、无修复）；构建 shell 跑 v24.18.0（< 24.22.1，同命中）。唯一彻底修复 = 升级运行时至 24.x LTS ≥ 24.22.1。24.x 线兼容性今日已在 v24.18.0 上完整验证（448/448 测试、NATIVE_OK、生产冒烟全通过），升级风险极低。

## 2. 现状分析 (Current State)

| 项 | 实测值 | 证据 |
|---|---|---|
| 生产运行时 | Node **v20.20.2**（EOL 无补丁线） | `systemctl cat tlrphotos-backend.service` → `ExecStart=.../fnm exec --using 20 -- node --expose-gc dist/server.js`；`fnm exec --using 20 -- node -v` → v20.20.2 |
| 构建 shell 运行时 | Node v24.18.0（fnm default） | `which node` → fnm v24.18.0 |
| fnm 已装版本 | v20.20.2、v24.18.0（**均 < 修复版本**） | `ls ~/.local/share/fnm/node-versions/` |
| 使用 Node 的服务 | 仅 `tlrphotos-backend.service`（iscsi.service 为同名误匹配） | grep /etc/systemd/system |
| 代码攻击面 | backend/src **无** brotli/zlib/compression 直接调用；但 Node 核心解码器经 undici/global fetch 对 `content-encoding: br` 响应的自动解压可达——后端出站 fetch 目标：阿里云 OSS、Turnstile siteverify、EverOS、DirectMail | grep backend/src 无匹配 |
| 原生模块 | sqlite3/better-sqlite3（prebuild-install **-r napi**）、bcrypt（node-addon-api）均为 **N-API**，跨 Node 大版本 ABI 稳定；今日已在 24.18.0 rebuild + 加载验证 | 今日 NATIVE_OK |
| 24.x 兼容性 | 今日全部回归在 24.18.0 通过：tsc 0 错误、26 套件 448 用例、oxlint 0 错误、build、生产冒烟 | 本会话 V4.1.1-beta 修复记录 |

**同批官方修复附带收益**：CVE-2026-105482（DNS NUL 截断）、CVE-2026-105483（全角数字 IP 绕过 TLS 验证）等 4 项 High 随同一升级一并消除。

## 3. 变更步骤 (Proposed Changes)

> 目标版本：**24.x LTS 最新 ≥ 24.22.1**（安装时以 `fnm ls-remote` 实际可用为准，优先最新 24.x；systemd 中钉死精确版本号）。24.x 是 LTS（Krypton）且今日已验证兼容；不跨到 26.x Current（未验证、无必要）。

### 步骤 0 — 前置检查（10 秒）
```bash
sudo -n true && echo SUDO_OK        # 确认免密 sudo 可写 systemd unit
fnm ls-remote | grep '^v24\.' | tail -3   # 确认可用 24.x 最新版本号
```

### 步骤 1 — 安装修复版本（~1 分钟）
```bash
fnm install 24.22.1   # 若已有更高 24.x 则装更高者；nodejs.org 慢则降级镜像：
# fnm install 24.22.1 --node-dist-mirror=https://npmmirror.com/mirrors/node
```
完整性核验（安全任务留证）：
```bash
cd /tmp && curl -sO https://nodejs.org/dist/v24.22.1/SHASUMS256.txt \
  && grep "linux-x64.tar.xz" SHASUMS256.txt \
  && sha256sum ~/.local/share/fnm/node-versions/v24.22.1/installation/bin/node >/dev/null  # 安装产物存在性
fnm exec --using 24.22.1 -- node -v   # 必须打印 v24.22.1
```

### 步骤 2 — 原生模块新运行时预检（30 秒）
```bash
cd /opt/tlr-photos-ui/TLRphotos-UI/backend
fnm exec --using 24.22.1 -- node -e "require('sqlite3');require('better-sqlite3');require('bcrypt');require('sharp');console.log('NATIVE_OK')"
```
- 成功 → 直接进入步骤 3（N-API 免重建，符合预期）
- 失败 → `fnm exec --using 24.22.1 -- npm rebuild bcrypt better-sqlite3 sqlite3 sharp` 后重试（今日已证明 rebuild 链可用）

### 步骤 3 — 24.22.1 下全量回归（~2 分钟）
```bash
cd /opt/tlr-photos-ui/TLRphotos-UI/backend
fnm exec --using 24.22.1 -- npx vitest run   # 须 26 套件 448/448 全绿
```

### 步骤 4 — 切换生产运行时并重启（~30 秒）
1. 编辑 `/etc/systemd/system/tlrphotos-backend.service`：
   `ExecStart` 中 `--using 20` → `--using 24.22.1`（钉死精确版本，杜绝解析漂移）
   ```bash
   sudo -n sed -i 's/--using 20 /--using 24.22.1 /' /etc/systemd/system/tlrphotos-backend.service
   sudo -n systemctl daemon-reload
   sudo -n systemctl restart tlrphotos-backend.service
   ```
2. 同步构建 shell：`fnm default 24.22.1`（消除 shell 侧 v24.18.0 命中面；lts-latest 别名一并对齐）

### 步骤 5 — 部署验证（~1 分钟）
```bash
systemctl is-active tlrphotos-backend.service          # active
ps -ef | grep '[n]ode'                                  # 进程路径须含 node-versions/v24.22.1
curl -s -o /dev/null -w '%{http_code}\n' https://tlrphotos.com/api/about/stats       # 200
curl -s -o /dev/null -w '%{http_code}\n' https://tlrphotos.com/api/announcements     # 200
curl -s -o /dev/null -w '%{http_code}\n' https://tlrphotos.com/api/photos            # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://tlrphotos.com/api/photos/upload  # 401（鉴权前置）
```

### 步骤 6 — 版本三处同步 + 提交推送
安全修复 → PATCH：**V4.1.1-beta → V4.1.2-beta**
1. `package.json` version → `4.1.2-beta`；`npm install --package-lock-only` 同步 lock
2. `.ai/context.md` Changelog 顶部追加 `[fix]` 条目（含 CVE 定性、命中证据、升级动作、验证结果、残留说明）
3. `.trae/rules/版本管理规则.md`「当前版本」+ 历史表首行
4. `git add` 仅上述文件 + 本计划文档；提交：
   `[fix] 紧急安全修复：Node.js 运行时 20.20.2(EOL)→24.22.1 消除 node2shell CVE-2026-111497 Brotli RCE | V4.1.2-beta | <时间>`
   → `git push origin main`

## 4. 假设与决策 (Assumptions & Decisions)

- **决策：升 24.x LTS 而非 26.x**——24.x 今日已在本机全量验证（测试/原生模块/冒烟），速度第一原则下不引入未验证变量。
- **决策：systemd 钉精确版本 `24.22.1` 而非 `24`**——防止 fnm 别名解析漂移导致运行时静默变更。
- **假设：N-API 免重建**——sqlite3/bcrypt/better-sqlite3 均为 N-API（今日 rebuild 后同时在 Node 20 生产与 24 shell 双侧工作即为实证）；步骤 2 预检兜底。
- **不动代码**：本次纯运行时升级，无源码/API/dist 变更，无需前端重建。
- **保留 v20.20.2 不卸载**——作为即时回滚通道。
- **攻击面定性**：源码无直接 Brotli 调用，直接可达性有限；但 RCE 级核心漏洞 + EOL 运行时双红线，升级是唯一可接受处置，不做"缓解观察"。

## 5. 回滚方案 (Rollback)

```bash
sudo -n sed -i 's/--using 24.22.1 /--using 20 /' /etc/systemd/system/tlrphotos-backend.service
sudo -n systemctl daemon-reload && sudo -n systemctl restart tlrphotos-backend.service
```
（代码零变更，无数据库迁移，回滚即恢复。）

## 6. 验证清单 (Verification)

- [ ] `fnm exec --using 24.22.1 -- node -v` 输出 v24.22.1
- [ ] 24.22.1 下 NATIVE_OK（四原生模块）
- [ ] 24.22.1 下 448/448 测试全绿
- [ ] 服务 active + `ps` 进程路径含 v24.22.1
- [ ] 四个冒烟端点状态码正确（200/200/200/401）
- [ ] V4.1.2-beta 三处同步 + 提交推送成功

## 参考来源

- Node.js 官方公告：https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- 十月安全综述（CVE-2026-111497 定性）：https://dev.to/iamcanturk/october-21-security-roundup-php2shells-backstory-java-http3-node-railway-and-ovh-55m
