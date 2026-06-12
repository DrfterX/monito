# Stripe Checkout 集成技术架构

**作者**: Werner Vogels (CTO)
**日期**: 2026-06-12
**状态**: 待评审
**项目**: monito — API Health Check Monitoring

---

> **Everything fails, all the time.** 设计 Stripe 集成的核心原则：支付可能失败、Webhook 可能重复、网络可能中断。你的架构必须对每一层失败有假设并容错。

---

## 1. 集成方式选择

### 决定: Stripe Checkout (托管支付页面)

| 方案 | 优点 | 缺点 | Workers 兼容性 |
|------|------|------|---------------|
| **Stripe Checkout** | 零 PCI 风险、Stripe 处理所有合规、开发量最小、支持多语言 | UI 不可定制跳转、不支持部分自定义字段 | **完全兼容** — 仅需 server-side API 调用 |
| Payment Elements | 可嵌入自有 UI 的定制化 | 需前端 JS SDK、额外的 CSS/JS 维护、PCI SAQ A 仍需要 | Workers 无法运行客户端 JS SDK，需要额外 Pages 托管 |

**理由:**
1. monito 当前是无前端产品（CLI + API + 产品页面），不需要在 Pages 上构建完整 dashboard 的支付 UI
2. Checkout 的托管页面把 PCI DSS 合规责任完全转移给 Stripe — 我们不需要 SAQ
3. 开发时间估算：Checkout 约 2-3 天 vs Payment Elements 约 5-7 天
4. Workers 环境下无法合理运行 Stripe.js 客户端 SDK

### SDK 选择: **Raw fetch API (不用 stripe-node SDK)**

| 对比项 | stripe-node SDK | Raw fetch API |
|--------|----------------|---------------|
| Workers 兼容 | 不完全 — SDK 使用 `http.Agent` keep-alive 连接 | **完全兼容** — fetch API 是 Workers 原生 |
| 包体积 | ~500KB (gzip ~120KB) | 0 依赖 |
| 类型安全 | 自带全类型定义 | 需手动定义 Stripe 响应类型 |
| 维护成本 | 自动更新 API 参数 | 需手动跟进 API 变更 |

**stripe-node SDK 在 Workers 中的已知问题:**
- SDK 内部使用 `http` / `https` 模块，`nodejs_compat` 中仅部分兼容
- `keep-alive` 连接池在 Workers 无意义 — 每个请求冷启动
- SDK 的自动重试逻辑与 Workers CPU 时间限制(<10ms)冲突
- 构建时 SDK 的 dynamic require 会导致 esbuild 打包失败

**结论**: 使用 `fetch()` 直接调用 `https://api.stripe.com/v1/`。所有 Stripe API 调用是 POST with form-encoded body，封装在 `src/billing.ts` 中。

---

## 2. 端点设计

### 2.1 `POST /api/create-checkout-session`

**请求:**
```json
{
  "price_id": "price_pro_monthly",
  "success_url": "https://monito.dev/dashboard?session_id={CHECKOUT_SESSION_ID}",
  "cancel_url": "https://monito.dev/pricing"
}
```
*注意: `success_url` 和 `cancel_url` 可选，默认使用环境变量配置*

**响应 (成功 200):**
```json
{
  "session_id": "cs_test_xxx",
  "url": "https://checkout.stripe.com/c/pay/cs_test_xxx"
}
```

**实现逻辑:**
1. 验证用户认证 (requireAuth middleware)
2. 检查用户当前 plan — 已经是 pro/team 则返回冲突 409
3. 根据 price_id 映射到内部 plan + 对应 limits
4. 调用 Stripe API 创建 Checkout Session
5. 在 KV 中记录 session → user_id 映射（用于 webhook lookup）
6. 返回 session URL

**端到端数据流 (Happy Path):**
```
┌──────────┐   POST /api/create-checkout-session    ┌──────────┐
│  Client  │ ────────────────────────────────────→   │ monito   │
│ (CLI/CLI)│                                         │ (Worker) │
└──────────┘                                         └─────┬────┘
      ↑                                                   │
      │    { url: "https://checkout.stripe.com/..." }      │ POST /v1/checkout/sessions
      │ ←──────────────────────────────────────────       │
      │                                                    ↓
      │                                              ┌──────────┐
      │                                              │  Stripe  │
      │                                              │   API    │
      │                                              └──────────┘
      │                                                    │
      │  用户浏览器跳转到 Stripe 托管页面                      │
      │ ←────────────────────────────────────────────      │
      │                                                    │
      ├── 用户填写卡信息 ─────→                             │
      ├── Stripe 验证支付 ────→                             │
      │                                                    │
      │  重定向到 success_url                               │
      │ ←────────────────────────────────────────────      │
      │                                                    │
      │  Stripe 异步发送 checkout.session.completed         │
      │  ─────────────────→ POST /api/stripe-webhook       │
      │                                    ↓               │
      │                             更新 users.plan        │
      │                             更新 subscriptions     │
      │                             发送成功邮件             │
```

### 2.2 `POST /api/stripe-webhook`

**请求:** Stripe 发送的原始 HTTP POST（无 JSON 检验需要）

**响应:**
```json
{
  "received": true
}
```
始终返回 200 给 Stripe（即使处理失败 — 避免 Stripe 重试标记为失败的事件）

**Webhook 处理步骤:**
1. 读取 raw body (用 `c.req.text()` 取得原始字符串，非 JSON)
2. 从 `Stripe-Signature` header 提取签名
3. 用 `STRIPE_WEBHOOK_SECRET` + raw body + 签名进行验证 (手动 HMAC-SHA256)
4. 解析 event 类型
5. 检查 KV 中是否已处理过该 event id (idempotency)
6. 按事件类型分发处理

**支持的事件类型:**
| Event | 操作 |
|-------|------|
| `checkout.session.completed` | 标记 session 完成，等待 subscription 激活 |
| `checkout.session.async_payment_succeeded` | 异步支付成功（如 SEPA 延迟到账）|
| `checkout.session.async_payment_failed` | 异步支付失败，保留 free plan |
| `customer.subscription.updated` | 订阅变更（升级/降级/续期）|
| `customer.subscription.deleted` | 取消订阅 → plan 回到 free |
| `invoice.paid` | 发票支付成功 — 额外确认 |
| `invoice.payment_failed` | 发票支付失败 — 发送通知 |

### 2.3 Protected Billing 辅助端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/billing/portal` | POST | 创建 Stripe Customer Portal session（用于管理订阅/取消） |
| `/api/billing/subscription` | GET | 获取当前用户订阅状态和信息 |

---

## 3. 数据流 — 完整流程图

### Happy Path (完整序列)

```
时间线:
┌──────────────────────────────────────────────────────────────────────────┐
│ CLI/Dashboard                         Stripe              monito Worker │
│    │                                   │                     │          │
│    │ POST /api/create-checkout-session │                     │          │
│    │──────────────────────────────────→│                     │          │
│    │            ← { url: "..." }       │                     │          │
│    │                                   │                     │          │
│    │ Redirect browser to Stripe        │                     │          │
│    │──────────────────────────────────→│                     │          │
│    │                                   │                     │          │
│    │         User fills card           │                     │          │
│    │         Card authorized           │                     │          │
│    │         Redirect to success_url   │                     │          │
│    │←──────────────────────────────────│                     │          │
│    │                                   │                     │          │
│    │         WEBHOOK: checkout.session.completed              │          │
│    │                                   │────────────────────→│          │
│    │                                   │                     │ KV: cache│
│    │                                   │                     │ event_id │
│    │                                   │                     │ D1: add  │
│    │                                   │                     │ pending_  │
│    │                                   │                     │ upgrade  │
│    │                                   │                     │          │
│    │         WEBHOOK: invoice.paid     │                     │          │
│    │                                   │────────────────────→│          │
│    │                                   │                     │ D1:      │
│    │                                   │                     │ update   │
│    │                                   │                     │ users.   │
│    │                                   │                     │ plan →   │
│    │                                   │                     │ 'pro'    │
│    │                                   │                     │          │
│    │         WEBHOOK: customer.        │                     │          │
│    │         subscription.updated      │                     │          │
│    │                                   │────────────────────→│          │
│    │                                   │                     │ D1: sync │
│    │                                   │                     │ sub end  │
│    │                                   │                     │ date,    │
│    │                                   │                     │ status   │
│    │                                   │                     │          │
│    │ 用户登录 → GET /api/protected     │                     │          │
│    │──────────────────────────────────→│                     │          │
│    │←── { plan: "pro", max_monitors: 20 }                   │          │
│    │                                   │                     │          │
│    │ 可创建 20 个 monitor, 1min 间隔    │                     │          │
│──────────────────────────────────────────────────────────────────────────┘
```

### 取消流程

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Customer Portal → 用户点击 Cancel                                      │
│ Stripe 标记订阅为 "canceled_at_period_end"                              │
│                                                                        │
│ WEBHOOK: customer.subscription.updated                                  │
│   → D1: subscriptions.cancel_at_period_end = true                       │
│   → 用户 Plan 仍在有效期内                                               │
│                                                                        │
│ 当前计费周期结束时:                                                      │
│ WEBHOOK: customer.subscription.deleted                                  │
│   → D1: users.plan = 'free'                                            │
│   → D1: subscriptions.status = 'canceled'                              │
│   → 发送邮件: "Your Pro plan has ended. You've been moved to Free."     │
│   → KV: 缓存取消通知（避免重复发送）                                      │
│                                                                        │
│ 降级影响:                                                                │
│   - 超出的 monitors 不会被删除，但会被标记为 inactive (status='paused')    │
│   - 用户可重新激活已暂停 monitor（在限制范围内）                            │
│   - 更短的 check_interval 会回退到 free 的 5min                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 支付失败流程

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 用户填写卡信息 → Stripe 扣费失败                                         │
│                                                                        │
│ 1. Stripe 自动重试 (dunning):                                           │
│    - 第 1 天: 自动重试                                                  │
│    - 第 3 天: 自动重试 + 发送 Stripe 邮件                                │
│    - 第 7 天: 自动重试                                                  │
│    - 第 14 天: 自动重试 — 最后一次                                      │
│    - 第 21 天: 自动取消订阅                                              │
│                                                                        │
│ 2. 每次失败: invoice.payment_failed webhook                             │
│    → D1: subscriptions.payment_failures++                               │
│    → 不改变 plan — 用户仍然是 pro（服务不中断）                           │
│    → 发送通知邮件: "Payment failed, Stripe will retry"                   │
│                                                                        │
│ 3. 如果最终取消: customer.subscription.deleted                          │
│    → plan → free                                                       │
│    → 同上降级影响                                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Webhook 幂等性设计

### 问题
Stripe 保证至少一次交付，意味着同一事件可能被多次发送。如果客户端返回 5xx，Stripe 会以指数退避重试最多 3 天。

### 解决方案: KV-based event id 去重

```typescript
// 在 handleWebhook 中的幂等性检查
async function isEventProcessed(env: Env, eventId: string): Promise<boolean> {
  const key = `stripe_event:${eventId}`
  const existing = await env.MONITO_STATE.get(key)
  if (existing) return true

  // TTL: 7 天（Stripe 重试窗口最长为 3 天, 留有余量）
  await env.MONITO_STATE.put(key, '1', { expirationTtl: 604800 })
  return false
}
```

### 事件顺序问题

| 场景 | 可能出现顺序 | 处理策略 |
|------|------------|---------|
| 正常支付 | `checkout.session.completed` → `invoice.paid` → `customer.subscription.updated` | 仅在 `invoice.paid` 时更新 plan |
| 异步支付 | `checkout.session.completed` → `checkout.session.async_payment_succeeded` | 第一个事件标记 pending，第二个事件更新 plan |
| 手动更新卡 | `invoice.paid` (无 `checkout.session.completed`) | `invoice.paid` 能独立处理 plan 升级 |

**核心原则**: 只有 `invoice.paid` 和 `customer.subscription.deleted` 两个事件会真正修改 `users.plan`。其他事件只更新 `subscriptions` 表的元数据。

---

## 5. 数据结构设计

### 5.1 新 Migration: `0004_billing.sql`

```sql
-- Monito — Billing Schema (Stripe Checkout)
-- 
-- Tracks Stripe subscription state for plan management.
-- subscriptions.status is the source of truth for billing state;
-- users.plan is derived and updated only on confirmed payment events.

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  TEXT PRIMARY KEY,             -- monito internal id
  user_id             TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,      -- sub_xxx
  stripe_customer_id  TEXT NOT NULL,                -- cus_xxx
  plan                TEXT NOT NULL CHECK(plan IN ('pro', 'team')),
  status              TEXT NOT NULL DEFAULT 'incomplete'
                      CHECK(status IN (
                        'incomplete', 'active', 'past_due',
                        'canceled', 'unpaid', 'incomplete_expired'
                      )),
  current_period_start TEXT,                        -- ISO 8601
  current_period_end   TEXT,                        -- ISO 8601
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,  -- boolean
  payment_failures    INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- Track Stripe checkout sessions for webhook correlation
CREATE TABLE IF NOT EXISTS checkout_sessions (
  id                  TEXT PRIMARY KEY,             -- monito internal id
  user_id             TEXT NOT NULL,
  stripe_session_id   TEXT NOT NULL UNIQUE,         -- cs_test_xxx
  plan                TEXT NOT NULL CHECK(plan IN ('pro', 'team')),
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending', 'completed', 'expired', 'failed')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_checkout_sessions_user ON checkout_sessions(user_id);
CREATE INDEX idx_checkout_sessions_stripe ON checkout_sessions(stripe_session_id);
```

### 5.2 types.ts 新增类型

```typescript
// ═══════════════════════════════════════════════════════════════════
// Billing Types (Step 4 — Stripe Checkout)
// ═══════════════════════════════════════════════════════════════════

/** Stripe subscription status from API */
export type StripeSubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'

/** Local subscription record */
export interface Subscription {
  id: string
  user_id: string
  stripe_subscription_id: string
  stripe_customer_id: string
  plan: 'pro' | 'team'
  status: StripeSubscriptionStatus
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: number
  payment_failures: number
  created_at: string
  updated_at: string
}

/** Checkout session record */
export interface CheckoutSession {
  id: string
  user_id: string
  stripe_session_id: string
  plan: 'pro' | 'team'
  status: 'pending' | 'completed' | 'expired' | 'failed'
  created_at: string
}

/** Request body for create-checkout-session */
export interface CreateCheckoutSessionRequest {
  price_id: string
  success_url?: string
  cancel_url?: string
}

/** Response from create-checkout-session */
export interface CreateCheckoutSessionResponse {
  session_id: string
  url: string
}

/** Billing portal session response */
export interface BillingPortalResponse {
  url: string
}

/** Subscription info (for GET /api/billing/subscription) */
export interface SubscriptionInfo {
  plan: 'free' | 'pro' | 'team'
  status: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  max_monitors: number
}

// Pricing config (environment variables or constants)
export const PRICING: Record<string, {
  plan: 'free' | 'pro' | 'team'
  price: number
  monitors: number
  interval_seconds: number
  features: string[]
}> = {
  free: {
    plan: 'free',
    price: 0,
    monitors: 5,
    interval_seconds: 300,
    features: ['5 monitors', '5min interval', 'Email alerts'],
  },
  pro: {
    plan: 'pro',
    price: 500,  // $5.00 in cents
    monitors: 20,
    interval_seconds: 60,
    features: ['20 monitors', '1min interval', 'Email + Slack alerts'],
  },
  team: {
    plan: 'team',
    price: 1200,  // $12.00 in cents
    monitors: 50,
    interval_seconds: 30,
    features: ['50 monitors', '30s interval', 'All alert channels'],
  },
}
```

---

## 6. Webhook 签名验证实现

Worker 中没有 `stripe.webhooks.constructEvent()` SDK 方法，需手动实现：

```typescript
// src/billing.ts — Webhook 签名验证

import { subtle } from 'crypto'

/**
 * Verify Stripe webhook signature manually.
 *
 * Stripe signature format:
 *   t=<timestamp>,v1=<signature>
 *
 * Stripe signs: `${timestamp}.${rawBody}`
 * Using HMAC-SHA256 with the webhook secret.
 *
 * This replaces stripe.webhooks.constructEvent() which
 * is part of stripe-node SDK and not available in Workers.
 */
async function verifyStripeWebhook(
  rawBody: string,
  sigHeader: string | null,
  webhookSecret: string
): Promise<{ timestamp: number; valid: boolean }> {
  if (!sigHeader) {
    throw new Error('Missing Stripe-Signature header')
  }

  // Parse signature components
  const parts = sigHeader.split(',').reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.split('=')
    acc[key.trim()] = value.trim()
    return acc
  }, {})

  const timestamp = parts['t']
  const signature = parts['v1']

  if (!timestamp || !signature) {
    throw new Error('Invalid signature format')
  }

  // Rebuild signed payload: timestamp + '.' + raw body
  const signedPayload = `${timestamp}.${rawBody}`

  // Compute HMAC-SHA256
  const encoder = new TextEncoder()
  const key = await subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const expectedSig = await subtle.sign('HMAC', key, encoder.encode(signedPayload))
  const expectedHex = Array.from(new Uint8Array(expectedSig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time comparison
  const valid = constantTimeCompare(signature, expectedHex)

  return { timestamp: parseInt(timestamp, 10), valid }
}
```

> **注意**: `constantTimeCompare` 函数已存在于 `index.ts`，可以提取到独立 helper 文件或 `billing.ts` 中复制一份。

---

## 7. 文件改动清单

### 新文件

| 文件 | 内容 |
|------|------|
| `src/billing.ts` | Stripe 所有逻辑: createCheckoutSession, handleWebhook, verifyStripeWebhook, pricing constants, subscription CRUD |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/index.ts` | 添加 3 个新路由: `POST /api/create-checkout-session`, `POST /api/stripe-webhook`, `GET /api/billing/subscription`, `POST /api/billing/portal` |
| `src/types.ts` | 添加 Billing 类型: `Subscription`, `CheckoutSession`, `SubscriptionInfo`, `PRICING`, `CreateCheckoutSessionRequest`, `CreateCheckoutSessionResponse`, `BillingPortalResponse` |
| `src/user.ts` | `updateUserPlan()` 已覆盖 plan+maxMonitors，无需改动；添加 `downgradeToFree()` 函数处理降级时的 monitor 暂停逻辑 |
| `wrangler.toml` | 添加环境变量声明: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_TEAM_MONTHLY`, `BILLING_SUCCESS_URL`, `BILLING_CANCEL_URL` |
| `package.json` | 无需新增依赖 — 使用内置 fetch API |

### 新迁移

| 文件 | 内容 |
|------|------|
| `migrations/0004_billing.sql` | 创建 `subscriptions` 和 `checkout_sessions` 表 |

---

## 8. src/billing.ts 核心模块设计

### 模块结构

```typescript
// src/billing.ts — Stripe Integration Module
//
// All Stripe API communication uses raw fetch() — no stripe-node SDK.
// This is intentional: Workers cannot use Node.js http.Agent keep-alive,
// and the SDK's auto-retry interferes with Workers CPU time limits.
//
// Design principle: every function that calls Stripe API must handle
// 4xx (client error), 5xx (Stripe error), and timeout (network error).

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

// ─── Exported Functions ──────────────────────────────────────────

export async function createCheckoutSession(
  env: Env,
  userId: string,
  priceId: string,
  successUrl?: string,
  cancelUrl?: string
): Promise<CreateCheckoutSessionResponse>

export async function handleStripeWebhook(
  env: Env,
  rawBody: string,
  signatureHeader: string | null
): Promise<{ received: boolean }>

export async function createBillingPortalSession(
  env: Env,
  customerId: string
): Promise<BillingPortalResponse>

export async function getCustomerId(
  db: D1Database,
  userId: string
): Promise<string | null>

// ─── Internal Helper Functions ───────────────────────────────────

async function stripeRequest(
  method: string,
  path: string,
  secretKey: string,
  body?: Record<string, string>
): Promise<any>

async function verifyStripeWebhook(
  rawBody: string,
  sigHeader: string | null,
  webhookSecret: string
): Promise<{ timestamp: number; valid: boolean }>

async function handleCheckoutCompleted(
  env: Env,
  session: StripeCheckoutSession
): Promise<void>

async function handleInvoicePaid(
  env: Env,
  invoice: StripeInvoice
): Promise<void>

async function handleSubscriptionDeleted(
  env: Env,
  subscription: StripeSubscription
): Promise<void>

// ─── Stripe API Types (manual, minimal) ──────────────────────────

interface StripeCheckoutSession {
  id: string
  customer: string
  subscription: string
  mode: 'setup' | 'payment' | 'subscription'
  status: 'open' | 'complete' | 'expired'
  metadata: Record<string, string>
}

interface StripeSubscription {
  id: string
  customer: string
  status: string
  current_period_start: number
  current_period_end: number
  cancel_at_period_end: boolean
  items: { data: Array<{ price: { id: string } }> }
  metadata: Record<string, string>
}

interface StripeInvoice {
  id: string
  subscription: string
  customer: string
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void'
  paid: boolean
  lines: { data: Array<{ price: { id: string } }> }
}
```

### Stripe API 调用封装

```typescript
async function stripeRequest(
  method: string,
  path: string,
  secretKey: string,
  body?: Record<string, string>
): Promise<any> {
  const url = `${STRIPE_API_BASE}${path}`
  
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  let requestBody: string | undefined
  if (body) {
    requestBody = new URLSearchParams(body).toString()
  }

  const response = await fetch(url, {
    method,
    headers,
    body: requestBody,
  })

  const data = await response.json()

  if (!response.ok) {
    // Stripe 错误格式: { error: { type, code, message } }
    const stripeError = data.error
    console.error(`[billing] Stripe API error ${response.status}:`, stripeError)
    
    // 映射 Stripe 错误到业务错误
    if (response.status === 401) throw new Error('Stripe auth failed')
    if (response.status === 429) throw new Error('Stripe rate limited')
    throw new Error(stripeError?.message || `Stripe error ${response.status}`)
  }

  return data
}
```

---

## 9. 环境变量与配置

### wrangler.toml 变更

```toml
# === Stripe Secrets (set via wrangler secret put) ===
# STRIPE_SECRET_KEY        — sk_test_xxx or sk_live_xxx
# STRIPE_WEBHOOK_SECRET    — whsec_xxx

[vars]
# Stripe Price IDs (set to your test/live price IDs)
STRIPE_PRICE_PRO_MONTHLY  = "price_pro_monthly"
STRIPE_PRICE_TEAM_MONTHLY = "price_team_monthly"
BILLING_SUCCESS_URL       = "https://monito.dev/dashboard"
BILLING_CANCEL_URL        = "https://monito.dev/pricing"
```

### Wrangler 命令

```bash
# 设置 Stripe 密钥
wrangler secret put STRIPE_SECRET_KEY
# > 输入: sk_test_xxx

wrangler secret put STRIPE_WEBHOOK_SECRET
# > 输入: whsec_xxx

# 迁移数据库
wrangler d1 migrations apply monito-db --remote

# 本地测试 Webhook
stripe listen --forward-to localhost:8788/api/stripe-webhook
```

---

## 10. 路由注册 (index.ts)

```typescript
// ─── Billing Routes (Step 4 — Stripe Checkout) ──────────────────

/** POST /api/create-checkout-session — Initiate Stripe Checkout */
app.post('/api/create-checkout-session', requireAuth, async (c) => {
  // 1. 获取用户
  // 2. 验证用户不是已经是 pro/team
  // 3. 调用 billing.ts createCheckoutSession
  // 4. 写入 checkout_sessions 表
  // 5. 返回 session URL
})

/** POST /api/stripe-webhook — Stripe event processing */
app.post('/api/stripe-webhook', async (c) => {
  // 1. 获取 raw body (不要用 req.json() — 用 req.text())
  // 2. 获取 Stripe-Signature header
  // 3. 调用 billing.ts handleStripeWebhook
  // 4. 始终返回 200
})

/** GET /api/billing/subscription — Current plan info */
app.get('/api/billing/subscription', requireAuth, async (c) => {
  // 返回当前 plan, 订阅状态, 周期结束日期等
})

/** POST /api/billing/portal — Customer Portal session */
app.post('/api/billing/portal', requireAuth, async (c) => {
  // 1. 查找用户 stripe_customer_id
  // 2. 调用 Stripe Billing Portal API
  // 3. 返回 portal URL
})

// ⚠️ 注意: webhook 路由需要在 requireAuth 之外,
// 它使用 Stripe 签名验证而非 API key 验证
```

**webhook 路由必须在 `requireAuth` 之外的关键原因:**
- webhook 请求来自 Stripe 服务器，不携带 `x-api-key` header
- webhook 的认证机制是 `Stripe-Signature` header 签名验证
- 如果用 `requireAuth` 中间件，所有 webhook 请求都会返回 401

---

## 11. 升级后逻辑

### Webhook 处理后的操作

```typescript
async function handleInvoicePaid(env: Env, invoice: StripeInvoice): Promise<void> {
  // 1. 幂等检查 — 避免重复处理
  if (await isEventProcessed(env, invoice.id)) return

  // 2. 确定 plan (根据 price_id)
  const plan = invoice.lines.data[0]?.price?.id === env.STRIPE_PRICE_TEAM_MONTHLY
    ? 'team' : 'pro'

  // 3. 更新用户 plan 和 max_monitors
  const userId = await getUserIdBySubscription(env.DB, invoice.subscription)
  if (!userId) {
    console.error(`[billing] No user found for subscription ${invoice.subscription}`)
    return
  }

  await updateUserPlan(env.DB, userId, plan)
  
  // 4. 更新 subscriptions 表
  await updateSubscriptionPeriod(env.DB, invoice.subscription, {
    status: 'active',
    currentPeriodStart: new Date(invoice.lines.data[0].period.start * 1000).toISOString(),
    currentPeriodEnd: new Date(invoice.lines.data[0].period.end * 1000).toISOString(),
  })

  // 5. 发送欢迎邮件 (ctx.waitUntil)
  // 注意: 使用 ctx.executionCtx.waitUntil 异步发送
  ctx.executionCtx.waitUntil(sendUpgradeEmail(env, userId, plan))
}
```

### 欢迎邮件

```typescript
async function sendUpgradeEmail(env: Env, userId: string, plan: string): Promise<void> {
  const user = await getUser(env.DB, userId)
  if (!user?.email) return

  // 使用现有 alerter.ts 的模式 — 直接调用 Resend API
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.DEFAULT_ALERT_FROM || 'Monito <billing@monito.dev>',
      to: user.email,
      subject: `Welcome to monito ${plan}! Your ${plan} plan is now active`,
      html: `<h2>Welcome to monito ${plan}!</h2>
        <p>Your upgrade has been activated. Here's what's new:</p>
        <ul>
          <li>Up to ${plan === 'team' ? '50' : '20'} monitors</li>
          <li>${plan === 'team' ? '30-second' : '1-minute'} check intervals</li>
          <li>All alert channels</li>
        </ul>
        <p>Get started: <a href="https://monito.dev/dashboard">Dashboard</a></p>`,
    }),
  })
}
```

### Monitor 上限处理

升级时:
- `max_monitors` 从 5 → 20 (pro) 或 5 → 50 (team)
- 用户已有的 monitors 不受影响 — 立即解锁创建更多 monitor 的能力
- check_interval 下限从 300s → 60s (pro) 或 30s (team) — 需要在下一次 cron check 遍历时应用

降级时:
- `max_monitors` 从 20 → 5 (pro→free) 或 50 → 5 (team→free)
- **不自动删除 monitors** — 标记超出的 monitors 为 `paused` 状态
- 需要新增状态 `paused` 或使用 `status='deleted'` 的变体
- 当用户重新升级时，`paused` monitors 可以恢复

**推荐方式**: 不引入新状态。降级时 `max_monitors` 降低，用户可以在 dashboard 中看到 "You have N monitors but your plan only allows 5" 的提示。create monitor 时会阻止创建，但已有的 remain active 直到下一个计费周期。所有 monitors 继续被检查 — 这是友好的做法。

---

## 12. 安全性

| 风险 | 措施 |
|------|------|
| **PCI 合规** | Stripe Checkout 处理所有卡数据，我们不存储/传输卡号。无需 SAQ。 |
| **Webhook 伪造** | 每个 webhook 请求必须通过 HMAC-SHA256 签名验证 |
| **重放攻击** | Webhook timestamp 检查: 拒绝超过 5 分钟的旧事件 |
| **重复事件** | KV 存储已处理 event ID，TTL 7 天 |
| **API 滥用** | `/api/create-checkout-session` 添加速率限制: 每个用户每分钟 5 次 |
| **密钥泄露** | `STRIPE_SECRET_KEY` 存储在 `wrangler secret` 中，非 `vars` |

### 速率限制实现 (index.ts)

```typescript
// 对 create-checkout-session 加速率限制
async function rateLimitCheckout(c: any): Promise<boolean> {
  const userId = c.get('userId')
  const key = `rate_limit:checkout:${userId}`
  const current = parseInt(await c.env.MONITO_STATE.get(key) || '0', 10)
  if (current >= 5) return false // 已超过限制
  
  await c.env.MONITO_STATE.put(key, String(current + 1), {
    expirationTtl: 60 // 1 分钟后重置
  })
  return true
}
```

---

## 13. Workers 环境特殊考量

### 限制 1: 100ms CPU 时间
- Stripe API 调用是网络 I/O，I/O 等待**不计入** CPU 时间
- 实际 CPU 消耗: 签名验证的 HMAC 计算 (< 1ms)
- **安全**: Stripe 集成不会触发 CPU 时间限制

### 限制 2: 无 keep-alive 连接
- 每次 `fetch()` 到 Stripe API 都是新的 TCP 连接
- 增加约 50-100ms 的 TLS 握手延迟
- **影响**: Checkout Session 创建在 Workers 端增加约 200-300ms 延迟
- **接受**: 用户侧的体验延迟是 Stripe 托管页面跳转，Worker 的 300ms 可忽略

### 限制 3: `ctx.waitUntil` 异步处理
- 升级邮件发送等非关键操作在 `ctx.waitUntil()` 中执行
- 这不会增加 webhook 响应延迟

### 测试策略

**本地测试:**
```bash
# 1. 启动本地 Worker
npm run dev

# 2. Stripe CLI 转发 webhook 到本地
stripe listen --forward-to localhost:8788/api/stripe-webhook \
  --events checkout.session.completed,invoice.paid,\
customer.subscription.updated,customer.subscription.deleted

# 3. Stripe CLI 触发测试事件
stripe trigger checkout.session.completed
stripe trigger invoice.paid
stripe trigger customer.subscription.deleted

# 4. 检查 D1 本地数据
wrangler d1 execute monito-db --local \
  --command "SELECT * FROM subscriptions"
```

**生产部署步骤:**
1. 在 Stripe Dashboard 创建产品和价格 → 获取 price IDs
2. 配置 Stripe Webhook 端点: `https://monito.workers.dev/api/stripe-webhook`
3. 设置 webhook 事件: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`
4. 以 test mode 运行 48 小时验证流程
5. 切换到 live mode

---

## 14. 边界场景和错误处理

| 场景 | 行为 |
|------|------|
| 用户重复点击 "Upgrade" | 检查 `checkout_sessions` 中是否有 pending session，返回已存在的 session URL |
| 用户关闭 Stripe 页面未支付 | Checkout Session 会在 24h 后过期，plan 不变 |
| Webhook 在 plan 升级前到达 | 始终使用 invoice 的 `subscription` 字段反查 user_id（通过 subscriptions 表）|
| Stripe 返回 5xx | `stripeRequest` 捕获错误，返回 502 给客户端 |
| Webhook 处理异常 | 记录错误日志，返回 200 给 Stripe（避免重试死循环）|
| 用户从未创建 checkout session 但收到 invoice.paid | 查找 `checkout_sessions` 表，如果找不到对应的 session 但 subscription 不存，创建 subscription 记录 |
| Worker 在 webhook 处理中途崩溃 | 下次 Stripe 重试时会通过 KV 幂等检查跳过已处理的事件 |
| 用户删除账户 | Stripe subscription 需要单独取消（通过 Customer Portal 或在 Stripe Dashboard 手动操作）|

---

## 15. 运营检查清单

- [ ] 在 Stripe Dashboard 创建产品和价格 (pro $5/mo, team $12/mo)
- [ ] 配置 Stripe Webhook 端点指向 Worker URL
- [ ] `wrangler secret put STRIPE_SECRET_KEY`
- [ ] `wrangler secret put STRIPE_WEBHOOK_SECRET`
- [ ] `wrangler d1 migrations apply monito-db --remote` (0004_billing.sql)
- [ ] 本地测试: `stripe listen --forward-to localhost:8788/api/stripe-webhook`
- [ ] 验证端到端: CLI → `/api/create-checkout-session` → Stripe checkout → 支付 → webhook → plan 升级
- [ ] 验证降级: Customer Portal → 取消 → webhook → plan 降级
- [ ] 验证幂等性: 向 webhook 端点发送重复事件
- [ ] 配置 Cloudflare Dashboard 告警监控 Worker 错误率
- [ ] 测试 mode 运行 48h 后切 live keys
- [ ] 更新 `.env.example` 添加 Stripe 相关变量
- [ ] 更新 CLI 文档说明 billing 端点用法

---

## 附录: 定价常量映射

| 环境变量 | Stripe Price ID (Test) | Plan | 金额 |
|---------|----------------------|------|------|
| `STRIPE_PRICE_PRO_MONTHLY` | `price_1RrXXX...` | pro | $5.00/月 |
| `STRIPE_PRICE_TEAM_MONTHLY` | `price_1RrYYY...` | team | $12.00/月 |

这些 price IDs 在 `PRICING` 常量中配置，通过 `price_id` 参数在 `create-checkout-session` 请求中选择。