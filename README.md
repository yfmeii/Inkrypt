<div align="center">

# 🔐 Inkrypt

**Your notes. Your keys. Zero knowledge.**

一款基于 Passkey 的端到端加密笔记应用<br>
你的笔记，永远只属于你

[![Built with Cloudflare](https://img.shields.io/badge/Built%20with-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://www.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![BlockNote](https://img.shields.io/badge/BlockNote-0.45-8B5CF6?logo=notion&logoColor=white)](https://www.blocknotejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[快速开始](#quick-start) · [部署指南](DEPLOYMENT.md) · [使用说明](USAGE_ZH.md)

</div>

---

## 🔄 Fork 改动说明

本项目基于 [VrianCao/Inkrypt](https://github.com/VrianCao/Inkrypt) 进行了修改。

### ✅ 改进

| 改动 | 说明 |
|------|------|
| **BlockNote 富文本编辑器** | 替换原有 Markdown 编辑器，所见即所得，支持 Markdown 快捷输入 |
| **代码块语法高亮** | 使用 `@blocknote/code-block` + Shiki，支持 50+ 种编程语言 |
| **Yjs CRDT 同步** | 基于 Yjs 的协作框架，多设备编辑自动合并，无需手动处理冲突 |
| **Shadcn/UI 组件库** | 现代化 UI 组件，统一视觉风格，深色/浅色主题支持 |
| **多主题支持** | 6 款内置主题（Graphite、Supabase、Mocha Mousse 等） |
| **全文搜索** | 标题/内容/标签搜索，带高亮预览，快速定位笔记 |
| **模糊块功能** | 选中文本后可快速应用模糊样式，隐藏敏感信息，点击可临时显示 |
| **UI 设计风格** | 参考 [linux-do/credit](https://github.com/linux-do/credit) 项目的设计风格 |

### ⚠️ 代价与局限

| 改动 | 代价 |
|------|------|
| **BlockNote 编辑器** | 包体积增大（主 JS 约 600KB gzip），不再支持原生 Markdown 源码编辑 |
| **Yjs 同步** | 每次同步传输完整快照（非增量），大文档同步较慢 |
| **Shadcn/UI** | 依赖 Radix UI，包体积增加 |
| **移除的功能** | 移除了 Mermaid 图表、KaTeX 数学公式等 Markdown 扩展功能 |
| **AI 辅助开发** | 本次改动大量使用 AI 辅助编写，代码质量无法完全保证，可能存在潜在问题 |
| **未针对移动端适配** | 未针对移动端做良好优化，手机/平板体验可能不佳 |

---

## 为什么选择 Inkrypt？

> 💡 **问题**：想要一个能同步、能多设备、还能真正端到端加密的笔记应用，但市面上的方案要么要你信任服务商，要么用起来太折腾。

**Inkrypt 的答案**：用 Passkey 做身份验证和密钥派生，真正做到端到端加密——你的笔记只有你能看。

<table>
<tr>
<td width="50%">

### 🛡️ 真正的端到端加密
- 笔记经过 AES-256-GCM 加密
- 密钥由 WebAuthn PRF 派生，只存在你的设备上
- 没有密钥，谁也解不开

</td>
<td width="50%">

### 🔑 无密码体验
- 用 Passkey（指纹/面容/安全钥匙）登录
- 告别"又忘密码了"的烦恼
- 设备丢了？用恢复码兜底

</td>
</tr>
<tr>
<td width="50%">

### 📱 多设备同步
- 基于 Yjs CRDT 的自动冲突解决
- 本地 IndexedDB 缓存 + 云端同步
- ECDH-SAS 安全配对新设备

</td>
<td width="50%">

### ✍️ 舒适的写作体验
- 基于 BlockNote 的富文本编辑器
- 支持 Markdown 快捷输入
- 附件加密同步，图片自动压缩

</td>
</tr>
</table>

---

## 🏗️ 技术架构

```
+-----------------------------------------------------------------+
|                           Your Browser                          |
|  +-------------+  +-------------+  +-------------+              |
|  |  WebAuthn   |  |  IndexedDB  |  |   React +   |              |
|  |    PRF      |  |   (cache)   |  |   Zustand   |              |
|  +------|------+  +------|------+  +------|------+              |
|         |                |                |                     |
|         +----------------+----------------+                     |
|                          |  Encrypt/decrypt happens here        |
+--------------------------+--------------------------------------+
                           | HTTPS (ciphertext)
                           v
+-----------------------------------------------------------------+
|                         Cloudflare Edge                         |
|  +-------------+  +-------------+  +-------------+              |
|  |   Workers   |  |     D1      |  |   Durable   |              |
|  |   (Hono)    |  |  (storage)  |  |   Objects   |              |
|  +-------------+  +-------------+  +-------------+              |
|                                                                 |
|                      Ciphertext stored here                     |
+-----------------------------------------------------------------+
```

| 组件 | 技术栈 | 职责 |
|------|--------|------|
| **前端** | Vite + React + Zustand + BlockNote + Yjs | UI、富文本编辑、加解密、本地缓存 |
| **后端** | Hono on Cloudflare Workers | 认证、同步、CRUD |
| **存储** | Cloudflare D1 | 笔记和元数据 |
| **限流** | Durable Objects | 全局请求限流 |

---

<a id="quick-start"></a>

## 🚀 快速开始

推荐使用 **GitHub Actions 一键部署（无需本地 clone）**。

**你需要准备：**

- `DOMAIN`：你的自定义域名（例如 `notes.example.com`，必须已托管到 Cloudflare）
- GitHub 仓库 Secret：`CLOUDFLARE_API_TOKEN`

### 1) 创建你的仓库

在 GitHub 点击 **Use this template**（或 Fork）创建你的仓库。

### 2) 配置 Secrets

进入仓库 → Settings → Secrets and variables → Actions：

- 新增 Repository secret：`CLOUDFLARE_API_TOKEN`
- （可选）新增 Repository secret：`INKRYPT_SESSION_SECRET`（不填会自动生成）

Token 最小权限建议：

- Zone：`Zone:Read`、`DNS:Edit`、`Workers Routes:Edit`
- Account：`Pages:Edit`、`Workers Scripts:Edit`、`D1:Edit`

### 3) 运行部署工作流

进入仓库 → Actions → `Deploy Inkrypt` → Run workflow：

- 必填：`domain`
- 选填：`rp_name`、`cors_origin`、`pages_project_name`、`worker_name`、`d1_name`、`d1_location`

安全开关（默认谨慎）：

- `force_takeover_dns=true`：允许覆盖已存在但不匹配的 DNS 记录
- `force_takeover_routes=true`：允许接管已被其他 Worker 占用的 Routes
- `wait_for_tls=false`：不等待 HTTPS 就绪（默认会等待）

该工作流会自动完成：

- Pages 项目创建与部署（Direct Upload）
- Worker 部署（含 D1/DO）
- D1 创建与 migrations
- Pages 自定义域名绑定 + DNS CNAME 自动配置
- Worker Routes 自动配置（`/api/*`、`/auth/*`、`/healthz*`）
- Smoke test：访问 `https://<DOMAIN>/healthz`

### 4) 部署完成后

- 打开 `https://<DOMAIN>` 访问
- 建议保持域名不变：`RP_ID/ORIGIN` 依赖域名，上线后改域名会导致已注册 Passkey 失效
- 新部署默认使用 SQLite 后端的 Durable Objects（对免费账号更兼容）

👉 **完整部署说明（含排错）**：[DEPLOYMENT.md](DEPLOYMENT.md)

---

## 📖 使用指南

首次使用流程：

1. **创建保险库** — 完成 Passkey 注册，生成主密钥
2. **备份恢复码** — 这是你数据的最后保险，务必离线保管
3. **开始写作** — 富文本编辑器，支持 Markdown 快捷输入
4. **同步与上传** — `Ctrl/Cmd + S` 上传，自动实时同步

👉 **详细说明**：[USAGE_ZH.md](USAGE_ZH.md)

---

## ⚠️ 安全须知

<table>
<tr>
<td>🔑</td>
<td><strong>恢复码 = 主密钥</strong></td>
<td>任何人拿到它都能解密你的所有笔记。离线保管，不要截图发给自己。</td>
</tr>
<tr>
<td>💾</td>
<td><strong>"记住解锁"有风险</strong></td>
<td>开启后会在本地缓存解密材料，XSS、恶意扩展等可能趁虚而入。</td>
</tr>
<tr>
<td>🌐</td>
<td><strong>浏览器要求</strong></td>
<td>必须支持 WebAuthn PRF 扩展和 CompressionStream API。</td>
</tr>
</table>

---

## 🤝 参与贡献

欢迎 Issue 和 PR！

---

## 📄 License

[MIT](LICENSE)

---

<div align="center">

**Made with 🔒 by [VrianCao](https://github.com/VrianCao)**

*Your data, encrypted. Your keys, yours.*

</div>
