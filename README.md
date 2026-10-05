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
link-manager-api/  # WordPress 插件源码
link-manager-api-flat.zip
                    # 可直接上传到 WordPress 的插件压缩包
data/             # 本地开发数据（JSON，未提交）
scripts/          # 验证脚本
public/           # 前端构建产物（由 npm run build / dev 生成，未提交）
wrangler.toml.example  # 部署配置模板（wrangler.toml 本身不提交）
```

## 核心功能

### 用户侧

- 首页展示已公开友链
- 登录后提交新的友链申请
- 查看、编辑和删除自己名下的友链（编辑已通过的友链会重新进入待审核，并在 WordPress 上先下架）

### 管理侧

- 查看全部、待审核、无主友链
- 审核通过或隐藏链接
- 编辑链接内容并同步回 WordPress
- 从 WordPress 批量导入历史链接（跳过本地有未同步改动的记录，避免被旧数据覆盖）
- 删除链接并同步删除 WordPress 中的记录

## WordPress 插件与接口

本项目依赖内置插件提供 WordPress 侧接口。请先在 WordPress 后台安装插件：

1. 直接上传根目录下的 link-manager-api-flat.zip 并启用
2. 或使用 link-manager-api/link-manager-api.php 自行打包部署

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
SESSION_SECRET=
```

说明：

- ADMIN_GITHUB_IDS / ADMIN_GITHUB_LOGINS 支持逗号分隔多个管理员
- WP_USERNAME + WP_APPLICATION_PASSWORD 用于服务端同步 WordPress
- SESSION_SECRET 用于签名会话与 OAuth state。**未配置时服务会直接报错**（fail-closed），
  不会回退到公开的默认密钥；密钥至少 16 个字符，且不能使用默认开发值。
  生成方式：`openssl rand -base64 32`。
  本地开发可以不配置：Node 入口会自动改用内置开发密钥，而 Cloudflare Worker 入口没有这段
  回退逻辑，因此生产环境必须显式配置。这样就不存在「一个环境变量开关配错就导致线上可用
  公开密钥伪造会话」的风险。
- 生产环境请在 Cloudflare 用 Secret 配置 SESSION_SECRET、GITHUB_CLIENT_SECRET、
  WP_APPLICATION_PASSWORD 等敏感项。

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
npm run typecheck   # TypeScript 检查
npm run verify      # 加固项 + 图标流水线验证（无需启动服务）
npm run build
npm run deploy
```

- build 前会自动执行 `npm run icons`，重新生成 `src/client/icons.ts`

验证真实服务（需先 `npm run dev`）：

```bash
npm run e2e:live    # 打真实 HTTP 接口，校验鉴权边界与字段白名单
```

- build：执行前端构建并进行 TypeScript 检查
- deploy：在 build 完成后使用 Wrangler 发布到 Cloudflare Workers

## 图标

界面图标通过内联 SVG 渲染，不使用图标字体。

- `scripts/gen-icons.mjs` 扫描 `src/client/` 中出现的 `mdi-*` 名称，只从 `@mdi/js`
  导入这些图标，生成 `src/client/icons.ts`（**自动生成，请勿手工编辑**）。
- 生成器在遇到 `@mdi/js` 中不存在对应名称时**直接报错退出**，因此模板里写错的
  图标名会在构建阶段暴露，而不是静默渲染成空白。
- 新增图标只需在模板中使用 `mdi-xxx`，构建时会自动纳入。
- `npm run verify` 会校验：所有引用的图标都已生成、字体依赖未被重新引入、
  构建产物中不含字体文件，以及生成器确实会在未知图标名时报错。

## Cloudflare 配置要点

项目的 Worker 入口是 `src/server/worker.ts`。`wrangler.toml` 必须提交到版本库，
否则 Cloudflare Git Builds 只能看到 Vite 的 `public/` 目录，会把项目识别成“只有静态
资产的 Worker”。这种部署没有 `/api` 后端，也无法使用 GitHub 登录或读取友情链接，
并会在添加运行时变量时报“不能将变量添加到只有静态资产的 Worker”。

`wrangler.toml.example` 可作为新部署的模板。实际配置中的 Worker 入口、assets binding
和 KV binding 应保留在 `wrangler.toml`。KV namespace ID 和域名不是认证凭据，可以进入
版本控制；运行时变量、密码、OAuth Client Secret 和 SESSION_SECRET 均不写入该文件。

所有运行时变量和敏感项都由 Cloudflare Dashboard 的 Variables and Secrets 管理。
不要在 `wrangler.toml` 中添加 `[vars]`：即使启用了 `keep_vars = true`，配置文件中
明确声明的同名值仍会在部署时覆盖 Dashboard 中的值。Secret 也可以使用
`wrangler secret put` 配置。

### Cloudflare Git Builds

- Build command：`npm run build`
- Deploy command：`npx wrangler deploy`
- 不要使用只上传 `public/` 的 Pages/静态站点部署命令。
- `wrangler.toml` 中的 `main = "src/server/worker.ts"` 与 `[assets] binding = "ASSETS"`
  必须同时存在。
- `keep_vars = true` 只保留 **未在 `wrangler.toml` 声明** 的 Dashboard 变量；项目因此
  故意不使用 `[vars]`，避免自动部署覆盖控制台配置。
- 首次部署脚本后，在 Worker 的 **Settings → Variables and Secrets** 中配置所需 Secrets。
- GitHub OAuth App 的 callback URL 必须为 `${APP_URL}/api/auth/callback`。

### 需要配置的内容

- Worker 入口：src/server/worker.ts
- Worker 配置：wrangler.toml
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
