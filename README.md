# Link Hub

一个「前后端同仓、单端口运行」的友情链接申请与审核系统。

- 普通用户：使用 GitHub 登录后提交和管理自己的友链
- 管理员：审核、公开/隐藏、编辑、删除、导入 WordPress 历史链接、绑定所有者
- 数据源：通过项目内 WordPress 插件暴露的 REST API 与 WordPress 链接进行双向同步

## 技术栈

- 前端：Vue 3 + Vite + Vuetify 4
- 后端：Elysia（Web Standard Adapter）
- 认证：GitHub OAuth
- 存储：
  - 本地开发：data/links.json
  - Cloudflare Workers：KV（LINKS_KV）
- 部署：Cloudflare Workers + 静态资源目录 public/

## 项目结构

```text
src/
  client/          # Vue 前端页面与组件
  server/          # Elysia API、认证、WordPress 同步逻辑
wordpress-plugin/  # WordPress 插件源码
link-manager-api-flat.zip
                    # 可直接上传到 WordPress 的插件压缩包
data/             # 本地开发数据（JSON）
public/           # 前端构建产物，部署时由 Worker 提供静态资源
```

## 核心功能

### 用户侧

- 首页展示已公开友链
- 登录后提交新的友链申请
- 查看并删除自己名下的友链

### 管理侧

- 查看全部、待审核、无主友链
- 审核通过或隐藏链接
- 编辑链接内容并同步回 WordPress
- 从 WordPress 批量导入历史链接
- 删除链接并同步删除 WordPress 中的记录

## WordPress 插件与接口

本项目依赖内置插件提供 WordPress 侧接口。请先在 WordPress 后台安装插件：

1. 直接上传根目录下的 link-manager-api-flat.zip 并启用
2. 或使用 wordpress-plugin/link-manager-api.php 自行打包部署

接口基地址示例：

```text
https://example.com/wp-json/link-manager/v1/links
```

该接口要求使用拥有 manage_links（或管理员）权限的账户的 Application Password。

### 所有权标记约定

系统会把 GitHub 身份写入 WordPress 备注字段：

```text
link-manager:github:<github-user-id>
link-manager:login:<github-login>
```

后续“我的友链”与管理员认领能力都依赖这些标记。

## 环境变量

复制 .env.example 为 .env，然后按需填写：

```env
APP_URL=http://localhost:3000
PORT=3000
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=http://localhost:3000/api/auth/callback
WP_LINKS_URL=https://example.com/wp-json/link-manager/v1/links
WP_USERNAME=
WP_APPLICATION_PASSWORD=
ADMIN_GITHUB_IDS=
ADMIN_GITHUB_LOGINS=
SESSION_SECRET=change-me
```

说明：

- ADMIN_GITHUB_IDS / ADMIN_GITHUB_LOGINS 支持逗号分隔多个管理员
- WP_USERNAME + WP_APPLICATION_PASSWORD 用于服务端同步 WordPress
- SESSION_SECRET 建议使用高强度随机字符串

## 本地开发

```bash
npm install
copy .env.example .env
npm run dev
```

在本地启动后，访问：

```text
http://localhost:3000
```

npm run dev 会同时启动：

- vite build --watch：持续输出前端构建产物到 public/
- tsx src/server/node.ts：启动本地 API 服务和静态资源服务

## 构建与部署

```bash
npm run build
npm run deploy
```

- build：执行前端构建并进行 TypeScript 检查
- deploy：在 build 完成后使用 Wrangler 发布到 Cloudflare Workers

## Cloudflare 配置要点

项目的 Worker 入口是 src/server/worker.ts，正式配置文件是 wrangler.toml。仓库里同时提供了 wrangler.toml.example，作用是给你一个可直接复制后修改的模板，便于在不同环境中快速部署。

### 需要配置的内容

- Worker 入口：src/server/worker.ts
- Worker 配置：wrangler.toml（可先从 wrangler.toml.example 复制）
- KV 绑定：LINKS_KV
- 静态资源目录：public/

### Cloudflare Dashboard 里建议填写的变量

位置：Cloudflare Dashboard → Workers & Pages → 你的 Worker → Settings → Variables

其中可分为 Environment Variables（普通变量）和 Secrets（敏感变量）。

| 字段名 | 放在哪里 | 说明 | 示例 |
|---|---|---|---|
| APP_URL | Environment Variable | 线上站点访问地址（协议 + 域名） | https://linkhub.example.com |
| GITHUB_REDIRECT_URI | Environment Variable | GitHub OAuth 回调地址，必须与 GitHub OAuth App 配置一致 | https://linkhub.example.com/api/auth/callback |
| WP_LINKS_URL | Environment Variable | WordPress 插件接口完整地址 | https://www.example.com/wp-json/link-manager/v1/links |
| ADMIN_GITHUB_IDS | Environment Variable（可选） | 管理员 GitHub 用户 ID，多个逗号分隔 | 12345678,87654321 |
| ADMIN_GITHUB_LOGINS | Environment Variable（可选） | 管理员 GitHub 登录名，多个逗号分隔 | luochancy,teammate |
| SESSION_TTL | Environment Variable（可选） | 登录态有效期（秒） | 604800 |
| GITHUB_CLIENT_ID | Secret | GitHub OAuth App 的 Client ID | Ov23li... |
| GITHUB_CLIENT_SECRET | Secret | GitHub OAuth App 的 Client Secret | xxxxxxxx |
| WP_USERNAME | Secret | WordPress 中用于管理友情链接的用户名 | admin |
| WP_APPLICATION_PASSWORD | Secret | 上述 WP 用户的 Application Password | abcd efgh ijkl mnop ... |
| SESSION_SECRET | Secret | 会话签名密钥，建议使用高强度随机字符串 | a-long-random-secret |

## 备注

- 本地开发默认使用 data/links.json 作为数据存储；线上部署会使用 Cloudflare KV。
- 如果你只想先跑通前端和后端流程，可以先不配置 WordPress 同步，接口仍可正常使用。
- 由于前端资产会被构建到 public/，首次启动前请确保已经执行过构建或使用 npm run dev。


