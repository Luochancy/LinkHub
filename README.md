# Link Hub

一个单项目、单端口的友情链接自助申请与管理系统。

## 技术方案

- Vue 3 + Vuetify 4
- Elysia API
- GitHub OAuth
- WordPress REST API 作为友情链接唯一数据源
- Cloudflare Workers / 本地 Node 运行
- KV 可选：只用于会话、OAuth 临时状态或缓存

## WordPress 约定

需提前下载源码当中的`link-manager-api-flat.zip`通过WP的插件管理上传安装以实现WP侧的功能实现。

`WP_LINKS_URL` 需要指向项目附带的 WordPress 插件接口：

```text
https://example.com/wp-json/link-manager/v1/links
```

创建友链时，系统会在备注字段写入：

```text
link-manager:github:<github-user-id>
link-manager:login:<github-login>
```

所有权判断以服务端 GitHub OAuth 会话为准，再匹配 WordPress 的备注字段。请安装 `wordpress-plugin/link-manager-api.php`，并使用拥有友情链接管理权限的 WordPress 应用密码。

## 本地启动

```bash
npm install
copy .env.example .env
npm run dev:server
```

生产构建后的前端静态文件位于 `public`，Cloudflare 部署使用：

```bash
npm run deploy
```
