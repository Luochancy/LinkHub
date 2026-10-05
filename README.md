# LinkHub

一个以 **WordPress 友情链接为数据源**、运行在 **Cloudflare Workers** 上的友链展示与管理站。

LinkHub 提供公开友链目录、GitHub OAuth 登录、友链申请、管理员审核、WordPress 导入与双向同步，以及“管理员主动分配归属后，用户自助修改自己的友链”等功能。前端与 API 由同一个 Worker 提供，友链业务状态保存在 Workers KV，正式友链同步回 WordPress。

> 在线示例：[linkhub.luochancy.com](https://linkhub.luochancy.com/)

![LinkHub 公开友链页面](docs/images/linkhub-home.png)

![LinkHub 管理后台](docs/images/linkhub-admin.png)

## 功能

- 公开展示状态为“已审核通过”的友情链接
- GitHub OAuth 登录与签名会话
- 登录用户提交友链申请
- 管理员审核、编辑、隐藏、恢复和删除友链
- 从 WordPress 一键导入现有友情链接
- 管理员通过 GitHub 数字 ID 主动分配旧友链归属
- 已获分配的用户在“我的友链”中自助修改
- 用户修改已公开友链后自动下架并进入待审核状态
- Cloudflare Workers KV 持久化，一条友链一个 Key
- WordPress REST API 同步
- Cloudflare Worker 后端与静态前端一体部署

## 使用流程

### 新友链申请

1. 用户通过 GitHub 登录。
2. 用户提交站点名称、URL、描述和头像。
3. 申请进入待审核状态。
4. 管理员审核通过后，LinkHub 将友链写入 WordPress 并公开展示。

### 旧友链分配与自助修改

本项目**不允许普通用户自行认领任意旧友链**：

1. 管理员从 WordPress 导入旧友链。
2. 用户把登录后页面显示的 GitHub 数字 ID 告诉管理员。
3. 管理员在管理后台编辑该友链，填写用户的 GitHub ID，主动完成分配。
4. 被分配的友链自动出现在该用户的“我的友链”页面。
5. 用户可自行修改名称、URL、描述和头像。
6. 已公开友链被用户修改后会暂时下架，等待管理员重新审核；审核通过后同步回 WordPress。

这样既支持用户自助维护，又避免任意用户冒领他人站点。

## 技术栈

- 前端：Vue 3、Vue Router、Vuetify 4、Vite
- API：Elysia、TypeScript
- 生产运行时：Cloudflare Workers
- 生产存储：Cloudflare Workers KV
- 本地运行时：Node.js、本地 JSON 文件
- 登录：GitHub OAuth
- 内容数据源：WordPress Links Manager + 配套 REST API 插件

## 目录结构

```text
.
├── index.html
├── static/                         # 前端静态源文件
├── src/
│   ├── client/                     # Vue 前端
│   └── server/                     # Elysia API、OAuth、存储和 WP 同步
├── scripts/                        # 图标生成及回归验证脚本
├── link-manager-api/
│   ├── link-manager-api.php        # WordPress 插件源码
│   └── readme.txt                  # WordPress 插件说明
├── link-manager-api-flat.zip       # 可直接上传的单文件插件包
├── docs/images/                    # README 截图
├── wrangler.toml                   # 当前项目的 Cloudflare 部署配置
├── wrangler.toml.example           # 可供 Fork 使用的配置模板
└── .env.example                    # 本地环境变量模板
```

`public/` 是 `npm run build` 生成的前端产物，不应手工修改或提交。

---

# 部署到 Cloudflare Workers

## 1. 准备条件

部署前需要：

- Cloudflare 账号
- GitHub OAuth App
- 一个安装了配套插件的 WordPress 站点
- Node.js 20 或更高版本
- 一个 Workers KV Namespace
- 可选：托管在 Cloudflare 的自定义域名

## 2. Fork 或克隆项目

```bash
git clone https://github.com/Luochancy/LinkHub.git
cd LinkHub
npm install
```

如果部署自己的 Fork，请修改 `wrangler.toml` 中的项目名、域名和 KV Namespace ID。

## 3. 创建 Workers KV

使用 Wrangler 创建：

```bash
npx wrangler login
npx wrangler kv namespace create LINKS_KV
```

命令会返回 Namespace ID。写入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "LINKS_KV"
id = "你的 KV Namespace ID"
```

也可以在 Cloudflare 控制台创建 KV Namespace，再把它作为变量名为 `LINKS_KV` 的 KV Namespace Binding 绑定到 Worker。

> `LINKS_KV` 是资源绑定，不是文本环境变量，也不是 Secret。

## 4. 配置 `wrangler.toml`

生产部署必须保留 Worker 入口和静态资源绑定，否则 Cloudflare 可能把项目识别为“只有静态资产的 Worker”，造成 `/api/*`、GitHub 登录和友链读取全部失效。

最小配置：

```toml
name = "linkhub"
main = "src/server/worker.ts"
compatibility_date = "2025-06-01"
compatibility_flags = ["nodejs_compat"]
keep_vars = true

[assets]
directory = "public"
binding = "ASSETS"

[[kv_namespaces]]
binding = "LINKS_KV"
id = "你的 KV Namespace ID"
```

使用自定义域名时增加：

```toml
[[routes]]
pattern = "linkhub.example.com"
custom_domain = true
```

如只使用 `*.workers.dev` 地址，可以删除整个 `[[routes]]` 段。

### 重要：不要在配置文件中添加 `[vars]`

本项目约定所有运行时变量都在 Cloudflare 控制台维护。不要把以下内容写进 `wrangler.toml`：

```toml
# 不要这样做
[vars]
APP_URL = "..."
```

即使设置了 `keep_vars = true`，`wrangler.toml` 中声明的同名 `[vars]` 仍可能覆盖控制台值。当前验证脚本会在发现正式配置或模板含 `[vars]` 时直接失败。

## 5. 创建 GitHub OAuth App

前往：

**GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**

填写：

```text
Application name: LinkHub
Homepage URL: https://linkhub.example.com
Authorization callback URL: https://linkhub.example.com/api/auth/callback
```

创建后保存：

- Client ID
- Client Secret

Cloudflare 中的 `GITHUB_CLIENT_ID` 与 `GITHUB_CLIENT_SECRET` 必须来自同一个 OAuth App。

## 6. 配置 Cloudflare 变量与 Secret

进入：

**Cloudflare Dashboard → Workers & Pages → 你的 Worker → Settings → Variables and Secrets**

### 必填变量

| 名称 | 类型 | 示例 | 说明 |
|---|---|---|---|
| `APP_URL` | 普通变量 | `https://linkhub.example.com` | LinkHub 对外地址，不带末尾 `/` |
| `GITHUB_CLIENT_ID` | 普通变量 | GitHub 提供的 Client ID | OAuth 客户端 ID |
| `GITHUB_CLIENT_SECRET` | **Secret** | GitHub 提供的 Client Secret | OAuth 客户端密钥 |
| `SESSION_SECRET` | **Secret** | 随机字符串 | Cookie HMAC 签名密钥，至少 16 字符，建议 32 字节以上 |

生成 `SESSION_SECRET`：

```bash
openssl rand -base64 32
```

更换 `SESSION_SECRET` 会使现有登录会话全部失效，这是预期行为。

### WordPress 同步变量

如果需要 WordPress 导入、审核同步、编辑同步和删除同步，还需填写：

| 名称 | 类型 | 示例 | 说明 |
|---|---|---|---|
| `WP_LINKS_URL` | 普通变量 | `https://example.com/wp-json/link-manager/v1/links` | 配套插件的 REST 地址 |
| `WP_USERNAME` | 普通变量 | `admin` | 有管理友链权限的 WP 用户名 |
| `WP_APPLICATION_PASSWORD` | **Secret** | WordPress 生成的应用程序密码 | 使用 Basic Auth 调用写接口 |

请使用 WordPress 的“应用程序密码”，不要填写账号登录密码。

### 管理员变量

至少配置下列一种：

| 名称 | 类型 | 格式 | 说明 |
|---|---|---|---|
| `ADMIN_GITHUB_IDS` | 普通变量 | `12345678,87654321` | 推荐；GitHub 数字用户 ID，不会随用户名修改而变化 |
| `ADMIN_GITHUB_LOGINS` | 普通变量 | `alice,bob` | GitHub 登录名，兼容或辅助配置 |

多个值使用英文逗号分隔。建议优先配置 `ADMIN_GITHUB_IDS`。

### 可选变量

| 名称 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `GITHUB_REDIRECT_URI` | 普通变量 | `${APP_URL}/api/auth/callback` | 一般无需填写；仅在 OAuth 回调地址与默认值不同时使用 |
| `SESSION_TTL` | 普通变量 | `604800` | 会话有效期，单位为秒，默认 7 天 |
| `PORT` | 本地变量 | `3000` | 只影响本地 Node 服务，Worker 不使用 |
| `NODE_ENV` | 本地/构建变量 | 无 | 本地 Node 入口在值为 `production` 时强制要求显式 `SESSION_SECRET`；Cloudflare 控制台通常无需配置 |
| `ALLOW_EPHEMERAL_SESSION_SECRET` | 本地变量 | 无 | 仅限明确的本地开发；生产环境不要配置 |

项目不使用 `WP_AUTH_MODE`，无需配置。

### Cloudflare 配置检查表

- [ ] Worker 不是纯静态资产项目，存在 `src/server/worker.ts` 脚本入口
- [ ] `ASSETS` 静态资源 binding 存在
- [ ] `LINKS_KV` KV binding 存在
- [ ] `APP_URL` 与实际域名完全一致
- [ ] GitHub OAuth 回调地址为 `/api/auth/callback`
- [ ] `SESSION_SECRET` 已设置为 Secret
- [ ] GitHub Client Secret 已设置为 Secret
- [ ] WordPress 应用程序密码已设置为 Secret
- [ ] 管理员 ID 或登录名已配置

## 7. 配置 Cloudflare Git 自动部署

在 Cloudflare 中连接 GitHub 仓库，并设置：

```text
Build command: npm run build
Deploy command: npx wrangler deploy
```

不要只运行 Vite 构建并让 Cloudflare自动识别静态目录；那样可能部署成 assets-only Worker，API 不会运行。

如果需要指定生产分支，请在 Cloudflare 项目设置中选择 `main` 或你的部署分支。

## 8. 手动部署

```bash
npm install
npm run verify
npm run build
npx wrangler deploy
```

`npm run build` 会先生成按需 SVG 图标，再执行 Vite 构建和 TypeScript 类型检查。

## 9. 部署后验证

按顺序检查：

```text
https://linkhub.example.com/
https://linkhub.example.com/api/links
https://linkhub.example.com/api/auth/me
```

预期：

- 首页正常显示；
- `/api/links` 返回 JSON，而不是 HTML；
- `/api/auth/me` 未登录时返回 `{"user":null,"isAdmin":false}`；
- GitHub 登录后能够回到 LinkHub；
- 管理员可以进入审核页；
- 从 WordPress 导入能够读到友链。

---

# WordPress 配套插件

## 插件作用

`link-manager-api` 将 WordPress 原生 Links Manager（`wp_links`）以受控 REST API 的形式提供给 LinkHub。它负责：

- 读取 WordPress 友情链接；
- 创建、更新和删除友情链接；
- 控制友情链接是否可见；
- 将 LinkHub 所有权信息存入友链备注；
- 使用 WordPress 权限系统和应用程序密码保护写操作。

插件不会处理 GitHub 登录、LinkHub 会话、KV 状态或审核界面；这些属于 Cloudflare Worker 应用。

## 安装插件

### 方式一：上传 ZIP

1. 下载仓库中的 `link-manager-api-flat.zip`；
2. WordPress 后台进入 **插件 → 安装插件 → 上传插件**；
3. 上传 ZIP 并启用；
4. 确认当前 WordPress 版本仍启用了 Links Manager 功能。

### 方式二：手动安装源码

将 `link-manager-api/` 整个目录复制到：

```text
wp-content/plugins/link-manager-api/
```

然后在 WordPress 后台启用 **Link Manager REST API**。

## 创建 WordPress 应用程序密码

1. 登录 WordPress 后台；
2. 进入 **用户 → 个人资料**；
3. 找到“应用程序密码”；
4. 新建一个名为 `LinkHub Worker` 的密码；
5. 把生成值保存为 Cloudflare Secret `WP_APPLICATION_PASSWORD`；
6. 把该用户的登录名填写为 `WP_USERNAME`。

该用户需要具备 `manage_links` 或 `manage_options` 权限。建议创建权限最小化的专用用户，不要复用日常管理员密码。

## REST API 定义

基础地址：

```text
https://你的 WordPress 域名/wp-json/link-manager/v1
```

### `GET /links`

读取友链列表。

- 权限：`manage_links` 或 `manage_options`
- 鉴权：WordPress Application Password
- 查询参数：`visible=Y` 只返回公开链接，`visible=N` 只返回隐藏链接；不传时返回全部
- LinkHub 管理员导入功能会携带 WordPress 凭据读取完整列表

返回字段：

| 字段 | 类型 | WordPress 来源 | 说明 |
|---|---|---|---|
| `id` | number | `link_id` | WordPress 友链 ID |
| `name` | string | `link_name` | 站点名称 |
| `url` | string | `link_url` | 站点 URL |
| `description` | string | `link_description` | 描述 |
| `avatar` | string | `link_image` | 头像或 Logo URL |
| `visible` | boolean | `link_visible` | 是否公开 |
| `link_visible` | string | `link_visible` | 原始值：`Y` 或 `N` |
| `notes` | string | `link_notes` | WordPress 备注及 LinkHub 所有权标记 |
| `link_notes` | string | `link_notes` | 与 `notes` 相同的兼容字段 |
| `owner` | number | `link_owner` | WordPress 链接创建者 ID |

### `GET /links/{id}`

读取单条友链，权限和鉴权要求与列表接口相同；不存在时返回 404。

### `POST /links`

创建友链。

- 权限：`manage_links` 或 `manage_options`
- 鉴权：WordPress Application Password
- 必填：`name`、`url`
- 可选：`description`、`avatar`、`visible`、`notes`

### `PUT /links/{id}`

更新友链。

- 权限：`manage_links` 或 `manage_options`
- 鉴权：WordPress Application Password
- 可更新：`name`、`url`、`description`、`avatar`、`visible`、`notes`

### `DELETE /links/{id}`

删除友链。

- 权限：`manage_links` 或 `manage_options`
- 鉴权：WordPress Application Password

## 所有权标记

管理员将旧友链分配给 GitHub 用户后，LinkHub 会把以下两行标记写入 WordPress 的 `link_notes`：

```text
link-manager:github:<GitHub 数字 ID>
link-manager:login:<GitHub 登录名>
```

例如：

```text
link-manager:github:86495643
link-manager:login:luochancy
```

其中：

- 数字 ID 是稳定的所有权判断依据；
- 登录名用于后台和公开卡片展示；
- 从 WordPress 导入时，LinkHub 会分别识别两行标记并恢复 `ownerGithubId` 与 `ownerLogin`；
- 没有 GitHub ID 标记的旧链接会显示为“无主站点”，只能由管理员主动分配，普通用户不能发起认领。

> **备注字段限制：**当前 LinkHub 在分配、取消分配或同步编辑时会用上述所有权标记重写 `link_notes`，WordPress 中原有的普通备注不会自动合并保留。若普通备注很重要，请先备份，或不要把它与 LinkHub 所有权元数据共用。

## 字段限制与清洗

配套插件会：

- 使用 `esc_url_raw()` 清洗 `url` 与 `avatar`；
- 使用 `sanitize_text_field()` 清洗名称；
- 使用 `sanitize_textarea_field()` 清洗描述和备注；
- 只接受带有效主机名的 `http://` 或 `https://` URL；
- 将可见状态标准化为 `Y` 或 `N`；
- 使用 PHP `strlen()` 检查原始输入：名称超过 600 字节、描述超过 3000 字节时拒绝。插件错误提示分别按约 200/1000 个中文字符描述；英文和其他 UTF-8 字符的实际字符数会因字节长度不同而变化；
- 当前插件没有单独为 `avatar` 或 `notes` 设置长度上限，最终还会受到 WordPress 数据库字段限制。

---

# 本地开发

## 环境变量

```bash
cp .env.example .env
```

编辑 `.env`。最小开发配置：

```dotenv
APP_URL=http://localhost:3000
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=http://localhost:3000/api/auth/callback
SESSION_SECRET=replace-with-a-random-secret-at-least-16-characters
SESSION_TTL=604800
ADMIN_GITHUB_IDS=
ADMIN_GITHUB_LOGINS=
WP_LINKS_URL=https://example.com/wp-json/link-manager/v1/links
WP_USERNAME=
WP_APPLICATION_PASSWORD=
PORT=3000
```

本地开发建议单独创建一个 GitHub OAuth App，并把它的回调地址设置为：

```text
http://localhost:3000/api/auth/callback
```

GitHub OAuth App 通常只配置一个回调地址；不要为了本地调试覆盖正在使用的生产回调。

## 启动

```bash
npm install
npm run dev
```

访问：<http://localhost:3000/>

本地数据保存在 `data/links.json`。该文件不应提交。

## 常用命令

```bash
npm run dev          # 启动前端监听和 Node API
npm run icons        # 重新扫描并生成按需 SVG 图标
npm run typecheck    # TypeScript 类型检查
npm run verify       # 回归、安全和部署配置检查
npm run build        # 生成生产前端并执行类型检查
npm run e2e:live     # 对已运行的本地服务执行真实 HTTP E2E
npm run start        # 运行已构建的本地 Node 服务
```

`src/client/icons.ts` 是生成文件，不要手工修改。模板中加入新的 `mdi-*` 图标后，`npm run icons` 或 `npm run build` 会自动更新它；未知图标会让构建失败，避免生产环境静默显示空白图标。

---

# API 与权限概览

| 路径 | 方法 | 权限 | 作用 |
|---|---|---|---|
| `/api/links` | GET | 公开 | 读取公开友链白名单字段 |
| `/api/links` | POST | 已登录 | 提交友链申请 |
| `/api/links/mine` | GET | 已登录 | 查看本人友链 |
| `/api/links/:id` | PUT | 所有者 | 修改本人友链并进入复审 |
| `/api/links/:id` | DELETE | 所有者 | 删除本人友链 |
| `/api/auth/github` | GET | 公开 | 发起 GitHub OAuth |
| `/api/auth/callback` | GET | OAuth | GitHub 回调 |
| `/api/auth/me` | GET | 公开 | 当前会话和管理员状态 |
| `/api/auth/logout` | POST | 已登录 | 退出登录 |
| `/api/admin/links` | GET | 管理员 | 获取全部记录 |
| `/api/admin/import` | POST | 管理员 | 从 WordPress 导入 |
| `/api/admin/:id` | PUT | 管理员 | 审核、编辑和分配归属 |
| `/api/admin/:id/visibility` | POST | 管理员 | 隐藏或恢复 |
| `/api/admin/:id` | DELETE | 管理员 | 删除记录并同步 WordPress |
| `/api/admin/storage` | GET | 管理员 | 查看旧存储迁移状态 |
| `/api/admin/migrate` | POST | 管理员 | 执行旧版 KV 结构迁移 |

公开接口不会返回 `ownerGithubId`、`wpId`、`syncError` 等内部字段。

# 常见问题

## Cloudflare 提示“不能将变量添加到只有静态资产的 Worker”

说明部署没有包含 Worker 脚本入口。检查：

- 仓库中有真正的 `wrangler.toml`，而不只有 `.example`；
- 配置包含 `main = "src/server/worker.ts"`；
- 配置包含 `[assets]` 与 `binding = "ASSETS"`；
- Deploy command 是 `npx wrangler deploy`；
- 不要只部署 `public/` 静态目录。

## 首页能打开，但不能登录、也没有友情链接

这通常仍是 assets-only 部署。访问 `/api/auth/me`：如果返回 HTML 而不是 JSON，后端 Worker 没有运行。也请检查 `LINKS_KV`、GitHub OAuth 和 `SESSION_SECRET`。

## GitHub 登录后显示 `oauth_state` 或回到首页仍未登录

检查：

- `APP_URL` 是否与浏览器地址完全一致；
- `GITHUB_REDIRECT_URI` 是否与 GitHub OAuth App 回调一致；
- HTTPS 站点是否使用 HTTPS 回调；
- `SESSION_SECRET` 是否存在且部署期间未改变；
- 浏览器是否允许该站点写入 Cookie。

## WordPress 导入失败

检查：

- 插件已启用；
- `WP_LINKS_URL` 可访问；
- WordPress 用户具有 `manage_links` 或 `manage_options`；
- 使用的是应用程序密码，不是登录密码；
- WordPress、WAF 或安全插件没有拦截 REST API/Basic Auth；
- `/wp-json/link-manager/v1/links` 返回 JSON。

## 部署后控制台变量消失或被覆盖

- 不要在 `wrangler.toml` 添加 `[vars]`；
- 保留 `keep_vars = true`；
- 所有运行时变量和 Secret 都在 Cloudflare 控制台维护；
- Secret 保存后不能查看原值，只能覆盖；
- 部署前运行 `npm run verify`。

## 用户看不到管理员分配的友链

管理员必须填写用户登录后显示的 **GitHub 数字 ID**。仅填写登录名不足以建立所有权。分配完成后刷新“我的友链”；如仍不可见，检查管理后台该记录的 GitHub ID 是否与 `/api/auth/me` 返回的用户 ID 一致。

# 安全说明

- 不要提交 `.env`、API Token、Client Secret、应用程序密码或 `SESSION_SECRET`。
- Cloudflare Secret 原值保存后不可读取，请在密码管理器中保留备份。
- 管理员身份优先使用不可变的 GitHub 数字 ID。
- 生产环境必须显式配置随机 `SESSION_SECRET`。
- WordPress 建议使用专用、最小权限账号和独立应用程序密码。
- Workers KV 是最终一致存储；项目已避免单个 JSON blob 的常规并发丢写，但极强一致业务仍应考虑 Durable Objects 或 D1。

# License

请根据仓库中的许可证文件使用本项目；如果仓库尚未提供许可证，默认保留全部权利。