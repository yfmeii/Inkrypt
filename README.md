<div align="center">

# 🔐 Inkrypt

**Your notes. Your keys. Zero knowledge.**

一款基于 Passkey 的端到端加密笔记应用<br>
你的笔记，永远只属于你

[![Built with Cloudflare](https://img.shields.io/badge/Built%20with-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://www.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[快速开始](#-快速开始) · [部署指南](DEPLOYMENT.md) · [使用说明](USAGE_ZH.md)

</div>

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
- 增量同步 + 本地 IndexedDB 缓存
- 乐观锁 + 冲突合并 UI
- ECDH-SAS 安全配对新设备

</td>
<td width="50%">

### ✍️ 舒适的写作体验
- Markdown 原生支持（GFM）
- 数学公式（KaTeX）+ 流程图（Mermaid）
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
| **前端** | Vite + React + Zustand | UI、加解密、本地缓存 |
| **后端** | Hono on Cloudflare Workers | 认证、同步、CRUD |
| **存储** | Cloudflare D1 | 笔记和元数据 |
| **限流** | Durable Objects | 全局请求限流 |

---

## ☁️ 部署到 Cloudflare

Inkrypt 专为 Cloudflare 生态设计，部署简单：

| 步骤 | 操作 |
|------|------|
| **1** | 创建 D1 数据库并执行迁移 |
| **2** | 从 `apps/worker/wrangler.toml.example` 生成 `apps/worker/wrangler.toml` 并配置（域名、RP_ID、ORIGIN） |
| **3** | 设置 `SESSION_SECRET`（32+ 字节随机串） |
| **4** | 部署 Worker：`npx wrangler deploy` |
| **5** | 部署 Pages：绑定 Git 仓库，构建前端 |
| **6** | 配置路由：`/api/*` 和 `/auth/*` 指向 Worker |

👉 **完整指南**：[DEPLOYMENT.md](DEPLOYMENT.md)

---

## 📖 使用指南

首次使用流程：

1. **创建保险库** — 完成 Passkey 注册，生成主密钥
2. **备份恢复码** — 这是你数据的最后保险，务必离线保管
3. **开始写作** — 支持 Markdown、数学公式、Mermaid 图
4. **同步与上传** — `Ctrl/Cmd + S` 上传，设置菜单拉取云端

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
