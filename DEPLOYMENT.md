# Inkrypt 部署指南

Inkrypt 是一款基于 Passkey 的端到端加密笔记应用——你的笔记，只有你能看。

本指南用于自部署 Inkrypt（基于 Cloudflare 技术栈）：

| 组件 | 技术 | 部署目标 |
|------|------|----------|
| 前端 | Vite + React | Cloudflare Pages |
| 后端 | Hono | Cloudflare Workers |
| 存储 | D1 | Cloudflare D1 |
| 限流 | Durable Objects | Cloudflare DO |

---

## 部署前必读

### 1. 推荐同域部署

前端和后端放在同一个域名下是最省心的方式：

```
https://notes.example.com/*       → Pages（静态资源）
https://notes.example.com/api/*   → Worker（API）
https://notes.example.com/auth/*  → Worker（认证）
```

这样不需要处理跨域，Cookie 和 WebAuthn 都最稳定。

### 2. 域名定了就别改

后端用 `RP_ID`（域名）和 `ORIGIN`（完整地址）验证 Passkey。上线后改域名会导致已有 Passkey 失效。

### 3. 不支持跨站部署

前端在 `*.pages.dev`、后端在 `example.com` 这种跨站组合会被 CSRF 保护拦截，不支持。

---

## 准备工作

**Cloudflare 侧**：
- Cloudflare 账号
- 一个域名（已托管到 Cloudflare）
- 开通 Workers、Pages、D1、Durable Objects

**本地**：
- Node.js 20+
- Git

---

## 步骤 1：拉代码

```bash
git clone https://github.com/YourRepo/Inkrypt.git
cd Inkrypt
npm install
npx wrangler login  # 登录 Cloudflare
```

---

## 步骤 2：配置后端

先从模板生成本地配置（仓库内提供 `apps/worker/wrangler.toml.example`）：

```bash
cp apps/worker/wrangler.toml.example apps/worker/wrangler.toml
```

Windows PowerShell：

```powershell
Copy-Item apps/worker/wrangler.toml.example apps/worker/wrangler.toml
```

然后编辑 `apps/worker/wrangler.toml`，修改 `[vars]` 部分：

```toml
RP_NAME = "Inkrypt"
RP_ID = "notes.example.com"           # 你的域名，不带 https://
ORIGIN = "https://notes.example.com"  # 完整地址，不带路径
CORS_ORIGIN = "https://notes.example.com"
COOKIE_SAMESITE = "Lax"
```

---

## 步骤 3：创建数据库

```bash
cd apps/worker

# 创建 D1 数据库
npx wrangler d1 create inkrypt
# 把输出的 database_id 填入 wrangler.toml

# 执行迁移
npx wrangler d1 migrations apply inkrypt --remote
```

---

## 步骤 4：部署后端

```bash
cd apps/worker

# 部署 Worker
npx wrangler deploy

# 设置会话密钥（必须，至少 32 字节）
npx wrangler secret put SESSION_SECRET
# 输入一个强随机字符串

# 再部署一次确保生效
npx wrangler deploy
```

---

## 步骤 5：部署前端

1. 打开 Cloudflare Dashboard → Pages → 创建项目
2. 绑定你的 Git 仓库
3. 配置构建：
   - **Build command**: `npm ci && npm --workspace apps/web run build`
   - **Output directory**: `apps/web/dist`
   - **Environment**: `NODE_VERSION=22`

---

## 步骤 6：配置路由

### 给 Pages 绑定域名

Pages 项目 → 自定义域名 → 添加 `notes.example.com`

### 给 Worker 添加路由

Worker → Triggers → Routes → 添加：
- `notes.example.com/api/*`
- `notes.example.com/auth/*`

这样 `/api` 和 `/auth` 走 Worker，其他走 Pages。

---

## 验证部署

1. 访问 `https://notes.example.com`
2. 创建保险库，完成 Passkey 注册
3. 退出后重新解锁
4. 新建笔记并上传
5. 从云端同步，确认数据正常
6. 用另一台设备测试「添加新设备」

---

## 本地开发

```bash
# 创建 apps/worker/.dev.vars
RP_NAME="Inkrypt (Local)"
RP_ID="localhost"
ORIGIN="http://localhost:5173"
CORS_ORIGIN="http://localhost:5173"
COOKIE_SAMESITE="Lax"
SESSION_SECRET="your-32-byte-random-secret-here"

# 初始化本地数据库
cd apps/worker
npx wrangler d1 migrations apply inkrypt --local

# 启动开发服务器
cd ../..
npm run dev
```

Vite 会自动代理 `/api` 和 `/auth` 到 Worker。

---

## 常见问题

### MISCONFIGURED (500)

`SESSION_SECRET` 没设置或太短。用 `npx wrangler secret put SESSION_SECRET` 设置后重新部署。

### VERIFY_FAILED / NOT_VERIFIED

检查 `RP_ID` 和 `ORIGIN` 是否与访问地址完全匹配。改过域名的话，旧 Passkey 会失效。

### CSRF_BLOCKED (403)

前后端不在同一站点。按本指南用同域路径路由部署。

### Cookie 不生效 / 一直 401

- Passkey 验证可能没通过，先检查 `RP_ID`/`ORIGIN`
- 浏览器可能禁用了 Cookie
- 跨站部署会触发 Cookie 限制

### D1 表不存在

确认 `wrangler.toml` 里的 `database_id` 正确，然后重新执行迁移。

### 不支持 PRF 扩展

更新浏览器，或换一个支持 PRF 的平台。

---

## 安全建议

| 建议 | 说明 |
|------|------|
| SESSION_SECRET 用 secret 存储 | 不要写在 wrangler.toml 里 |
| 定期轮换 SESSION_SECRET | 会让现有会话失效，但不影响数据 |
| 严格 CSP | 保持 `script-src 'self'`，`connect-src` 只放行必要 origin |
| 同域部署 | 减少跨域和 Cookie 风险 |
| 了解恢复码的重要性 | 丢了就真没了 |
