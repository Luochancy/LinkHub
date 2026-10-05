# LinkHub 点对点友链交换协议规划

> **状态：设计草案，当前尚未实现。**
>
> 本文只记录未来可能实现的协议边界、交互流程与安全约束，不代表当前 LinkHub 已提供自动发现、跨实例交换、实例签名或互链同步功能。字段、端点和状态名称在实现前均可调整。

## 1. 目标与非目标

LinkHub 计划提供一种没有中心服务器的点对点友链交换机制。每个实例独立托管自己的发现文档、身份公钥、管理员列表、接受策略和关系状态。A 实例与 B 实例直接通信，不经过官方目录、中央账号系统、中央公钥服务或统一关系数据库。

目标：

- 通过实例 URL 自动发现站点资料；
- 复用现有 GitHub OAuth，验证申请人是否为申请站点公开的管理员；
- 使用实例签名验证跨实例事件的来源与完整性；
- 由每个实例自行决定手动确认或自动接受；
- A 批准后先添加 B，再通知 B 完成反向添加；
- 双方分别使用自己的凭据同步自己的 WordPress；
- 使用现有 Workers KV 保存规划中的协议状态，不强制引入 D1；
- 允许单向友链长期存在，不把“本地已添加”与“双方互链完成”混为一谈。

第一版不计划：

- 建立中心注册表或中心中继服务；
- 允许未审核请求直接公开；
- 向远端提供 WordPress、GitHub、Cloudflare 或会话凭据；
- 允许远端直接调用本地 WordPress；
- 为本来公开的名称、URL、头像和描述额外做端到端加密；
- 将签名解释为远端代码可信或远端一定诚实；
- 自动删除本地已有友链。

## 2. 角色与信任模型

以 B 申请加入 A 的友情链接为例：

- **applicant（B）**：申请方实例；
- **reviewer（A）**：接收并审核申请的实例；
- **B 站长**：在 A 使用 GitHub OAuth 登录并提交 B 的实例 URL；
- **A 管理员**：决定 A 是否添加 B；
- **B 管理员**：当 B 使用手动策略时，决定 B 是否反向添加 A。

协议将四种证明分开：

1. **GitHub OAuth 会话**证明当前在 A 操作的 GitHub 用户是谁；
2. **B 的发现文档**声明哪些 GitHub 数字 ID 可以代表 B；
3. **实例数字签名**证明跨实例事件由持有对应实例私钥的一方发出，且传输内容未被篡改；
4. **本地接受策略与人工审核**决定本站是否信任远端的声明并修改本站数据。

签名不能证明远端运行的是未修改的官方代码，也不能从密码学上证明远端真的执行了 GitHub OAuth。B 开启自动接受，表示 B 主动选择信任签名有效的远端实例所作出的 OAuth 验证声明。默认策略应为手动确认。

## 3. 自动发现

每个支持协议的实例计划公开：

```http
GET /.well-known/linkhub.json
```

示例：

```json
{
  "protocol": "linkhub-exchange",
  "version": "1.0",
  "instance": "https://links-b.example.com",
  "site": {
    "id": "site_b",
    "name": "B 的博客",
    "url": "https://blog-b.example.com",
    "description": "站点描述",
    "avatar": "https://blog-b.example.com/avatar.png"
  },
  "operators": {
    "github": [
      {
        "id": "12345678",
        "login": "owner-b",
        "role": "owner"
      }
    ]
  },
  "exchangePolicy": {
    "enabled": true,
    "githubOperatorSubmission": true,
    "remoteApprovalBehavior": "manual"
  },
  "endpoints": {
    "events": "https://links-b.example.com/api/federation/events"
  },
  "publicKeys": [
    {
      "id": "key-2026-01",
      "algorithm": "ECDSA-P256-SHA256",
      "publicKeyJwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "...",
        "y": "..."
      }
    }
  ]
}
```

约束：

- 权限判断使用不可变的 GitHub 数字 ID，`login` 仅供展示；
- `instance`、事件端点和站点 URL 必须为 HTTPS；
- 接收方必须从来源实例自己的域名重新取得公钥，不能信任事件正文临时附带的公钥；
- 发现文档只能包含公开资料，绝不能暴露私钥或任何部署凭据。

### 3.1 接受策略

`remoteApprovalBehavior` 规划三个值：

- `manual`：远端批准后进入本站待确认列表；默认值；
- `trusted`：仅来自本站信任列表的实例可自动接受；
- `auto`：所有通过签名、身份和幂等校验的兼容实例均可自动接受。

`enabled: false` 表示实例可被发现，但不接受协议事件。管理界面必须说明 `auto` 的信任边界，并优先推荐 `manual` 或 `trusted`。

## 4. 申请与交换流程

### 4.1 身份校验与待审核申请

1. B 站长在 A 使用 GitHub OAuth 登录；
2. B 站长向 A 提交 B 的 LinkHub URL；
3. A 服务端直接读取 B 的发现文档；
4. A 校验 URL、协议版本、实例地址、接受策略和资料格式；
5. A 将服务端会话中的 GitHub 数字 ID 与 B 的 `operators.github` 比对；
6. 仅 `owner` 或 `admin` 角色允许代表 B 提交；
7. 匹配成功后，A 写入 `verified_pending_review`；
8. 此时不公开链接、不写 WordPress，也不创建已激活关系。

浏览器提交的 GitHub ID 永远不能作为身份依据。A 必须使用自己 OAuth 回调得到并封入服务端会话的身份。

### 4.2 A 批准并先行添加 B

A 管理员批准后：

1. A 创建 B 的本地友链；
2. A 使用自己的 WordPress 凭据同步；
3. 本地成功后，A 向 B 发送签名的 `exchange.approved` 事件；
4. 若通知失败，A 保留已添加的 B，并显示可重试状态；
5. A 不应因 B 拒绝或超时而自动删除本地链接。

这意味着本地友链和互链关系是两个独立概念：

- `linkStatus` 表示本站是否已保存/公开对方；
- `exchangeStatus` 表示双方互链协商进行到哪一步。

### 4.3 B 的处理

B 收到 `exchange.approved` 后必须：

1. 从 A 的 `source` 域名重新读取发现文档；
2. 取得指定 `keyId` 的公钥并验证签名；
3. 验证正文摘要、目标实例、时间窗口、nonce 和事件 ID；
4. 使用 B 自己的本地 operator 配置核对 `submittedBy.githubId`；
5. 检查 A 是否被屏蔽、关系是否重复以及当前策略；
6. 按 `manual`、`trusted` 或 `auto` 决定待确认或自动处理。

手动模式下，B 写入 `remote_approved_pending_local_review`，管理员确认后才添加 A。自动模式下，B 可直接添加 A。B 必须先完成自己的本地保存和 WordPress 同步，才能返回 `exchange.activated`。

如果 B 不接受，A 已添加的 B 可以继续作为单向友链存在。

## 5. 事件模型

规划中的批准事件：

```json
{
  "protocol": "linkhub-exchange",
  "version": "1.0",
  "type": "exchange.approved",
  "eventId": "evt_...",
  "requestId": "req_...",
  "relationshipId": "rel_...",
  "source": "https://links-a.example.com",
  "target": "https://links-b.example.com",
  "createdAt": "2026-10-06T04:10:00Z",
  "expiresAt": "2026-10-06T04:15:00Z",
  "nonce": "...",
  "submittedBy": {
    "provider": "github",
    "id": "12345678",
    "login": "owner-b"
  },
  "identityVerification": {
    "method": "github-oauth",
    "verifiedBy": "https://links-a.example.com",
    "verifiedAt": "2026-10-06T04:05:00Z"
  },
  "site": {
    "id": "site_a",
    "name": "A 的博客",
    "url": "https://blog-a.example.com",
    "description": "A 的站点描述",
    "avatar": "https://blog-a.example.com/avatar.png"
  }
}
```

最低事件类型规划：

- `exchange.approved`：A 已添加 B，并邀请 B 完成反向添加；
- `exchange.activated`：B 已添加 A，双方关系已激活；
- `exchange.rejected`：本地拒绝反向添加；
- `relationship.removed`：一方声明不再维持互链；不授权远端删除本地数据；
- `profile.updated`：未来可选的资料变更通知，默认仍需本地审核。

未知事件类型必须拒绝或安全忽略，不能触发默认写操作。

## 6. 实例签名

计划使用 Cloudflare Workers Web Crypto 可支持的非对称签名算法，首选 `ECDSA P-256 + SHA-256`。协议、算法、实现和公钥均可公开；安全性依赖私钥不泄露，而不依赖隐藏代码或请求格式。

私钥要求：

- 只保存在 Cloudflare Secret；
- 不写入 Git、`wrangler.toml`、KV 普通记录或前端资源；
- 不发送给远端实例；
- 不打印到日志；
- 所有签名只能在服务端执行。

签名规范字符串至少覆盖：

```text
LINKHUB-EXCHANGE/1.0
HTTP_METHOD
REQUEST_PATH
SOURCE_INSTANCE
TARGET_INSTANCE
EVENT_ID
TIMESTAMP
NONCE
SHA256(CANONICAL_BODY)
```

计划请求头：

```http
LinkHub-Instance: https://links-a.example.com
LinkHub-Key-Id: key-2026-01
LinkHub-Timestamp: 2026-10-06T04:10:00Z
LinkHub-Nonce: ...
LinkHub-Content-Digest: sha-256=:...:
LinkHub-Signature: ...
```

接收方必须验证目标、路径和方法，防止把一条给 B 的批准事件重放到 C 或其他 API。

## 7. 防重放、幂等与 KV

规划继续使用现有 Workers KV，不要求 D1。建议 key：

```text
link-hub:federation:settings
link-hub:federation:request:<requestId>
link-hub:federation:relationship:<relationshipId>
link-hub:federation:event:<eventId>
link-hub:federation:peer:<instanceHash>
link-hub:federation:nonce:<instanceHash>:<nonce>
link-hub:federation:block:<instanceHash>
```

KV 是最终一致存储，因此不能只依赖“先查 nonce、再写 nonce”实现强一致防重放。需要多层保护：

- 时间戳只接受短窗口，例如前后 5 分钟；
- nonce 保存短 TTL，例如 10 分钟；
- `eventId`、`requestId`、`relationshipId` 稳定且不可随重试变化；
- 相同事件重复投递返回原结果；
- 同一关系和规范化 URL 做业务级去重；
- 状态转换只能沿显式允许的方向前进；
- 重复批准不能创建第二条友链；
- 管理员审核是自动公开前的最后边界。

如果未来真实负载证明 KV 无法满足并发一致性，再评估 Durable Objects、Queues 或 D1，而不是在第一版提前引入。

## 8. 状态规划

A（审核方）可能状态：

```text
verified_pending_review
  ├─ rejected
  └─ approving
       ├─ local_sync_failed
       └─ local_active
            ├─ remote_notify_failed
            ├─ waiting_remote_review
            └─ active
```

B（申请方）手动模式可能状态：

```text
remote_approved_pending_local_review
  ├─ locally_rejected
  └─ local_syncing
       ├─ local_sync_failed
       └─ active
```

B 自动模式可能状态：

```text
remote_approved
  └─ local_syncing
       ├─ local_sync_failed
       └─ active
```

迟到或重复事件不能让 `active` 回退成待审核状态。同步失败与业务拒绝必须分开，以便安全重试。

## 9. 公钥固定与轮换

首次成功验证远端时保存实例、公钥 ID 和公钥指纹（TOFU）。同一实例的公钥突然变化时：

- 暂停自动接受；
- 显示密钥变化警告；
- 要求管理员重新确认；
- 不从未签名事件中接受新公钥。

未来轮换可让发现文档在过渡期同时发布 active 与 retiring 密钥。域名、Cloudflare 账号或私钥被攻破不属于签名协议能完全解决的问题，部署者仍需启用账号 2FA、保护域名并提供关系冻结能力。

## 10. SSRF、输入和滥用防护

自动发现允许服务器请求用户给出的 URL，必须：

- 仅允许 HTTPS；
- 拒绝 localhost、IP 字面量、私有/回环/链路本地地址和 URL 用户信息；
- 使用手动重定向，并对每一跳重新验证；
- 限制重定向次数、响应体大小和请求时间；
- 不携带 Cookie、Authorization 或 WordPress 凭据；
- 只接受预期 JSON Content-Type 和 Schema；
- 对发现、申请和签名失败按用户、IP 与来源实例限流；
- 支持实例屏蔽和全局关闭协议入口。

所有远端文本只能作为数据展示，不能作为 HTML 或指令执行。

## 11. WordPress 同步边界

远端永远不能直接调用本站 WordPress。正确数据路径：

```text
远端 LinkHub
  → HTTPS + 签名事件
本地 LinkHub
  → 本地保存与审核
本地 LinkHub
  → 使用本地 Secret 同步本地 WordPress
```

以下内容禁止进入发现文档和跨实例事件：

- `GITHUB_CLIENT_SECRET`；
- `SESSION_SECRET`；
- WordPress 用户名和应用程序密码；
- Cloudflare API Token；
- 实例私钥；
- 管理员会话 Cookie；
- KV 内部记录。

在实现该协议前，应先确保 LinkHub 更新所有权标记时只修改自己管理的 `link_notes` 行，并保留 WordPress 用户的普通备注。

## 12. 计划实施阶段

### 阶段 0：实现前准备

- 固化站点公开资料结构；
- 保留 WordPress 普通备注；
- 明确规范化 URL 和去重规则；
- 加入本地联邦设置、operators 与接受策略；
- 定义 JSON Schema、规范化 JSON 和签名测试向量。

### 阶段 1：只读发现

- 提供 `/.well-known/linkhub.json`；
- 管理端输入 URL 后预览站点资料；
- 完成 SSRF、超时、大小和重定向防护；
- 不发送跨实例写请求。

### 阶段 2：申请与手动互链

- GitHub operator 匹配；
- A 的审核队列；
- A 先行添加 B；
- 签名的 `exchange.approved` 与 `exchange.activated`；
- B 默认手动确认；
- KV 幂等记录、失败展示和人工重试。

### 阶段 3：受信任实例自动接受

- `trusted`/`auto` 策略；
- 公钥指纹固定和变更告警；
- 实例信任列表、屏蔽和更完整的事件日志；
- 经过实际部署验证后再考虑自动重试调度。

### 阶段 4：关系维护

- 资料更新通知；
- 解除关系；
- 密钥轮换；
- 单向友链与互链状态展示；
- 如实际一致性或查询需求出现，再评估额外 Cloudflare 存储组件。

## 13. 实现前必须完成的测试设计

至少覆盖：

- 合法发现、版本不兼容、超时、超大响应和恶意重定向；
- GitHub 数字 ID 匹配与浏览器伪造 ID；
- 正确签名、错误签名、正文篡改、错误目标和未知 key ID；
- 过期时间戳、重复 nonce、重复事件和并发重复批准；
- 公钥变化、屏蔽实例与接受策略切换；
- A 成功而 B 拒绝的单向友链；
- A/B WordPress 分别失败及安全重试；
- 普通用户越权审批；
- 远端事件尝试修改非联邦链接；
- 任何远端输入都不能泄露或调用本地 Secret。

## 14. 待决事项

在开始编码前仍需确定：

- 协议规范化 JSON 的精确定义；
- `site.id`、稳定 request/event/relationship ID 的生成规则；
- P-256 JWK 私钥的初始化、备份与轮换体验；
- `trusted` 的实例信任建立方式；
- 拒绝、撤销和单向保留的 UI 文案；
- WordPress 普通备注与 LinkHub 标记的合并格式；
- 协议版本兼容和第三方实现的测试向量。

本文在这些事项确定且实现、测试、部署完成前，始终只是一份规划文档。

## 15. License

本文档作为 LinkHub 项目的一部分，采用 `GPL-3.0-or-later` 许可，完整条款见仓库根目录 `LICENSE`。
