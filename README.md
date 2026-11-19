# Wallet · 共享记账

Wallet 支持个人和共享账本、可选分摊、还款、预算和成员权限。Render Static Site 托管前端，Supabase Auth 提供邮箱验证码登录，Edge Function `wallet` 使用 PostgreSQL 管理账本。账本数据位于私有 `wallet` schema，每次请求都验证用户身份和账本权限。

## 部署到 Supabase 和 Render

1. 在要部署 Wallet 的 Supabase 项目中启用 Email 登录和新用户注册。将 [邮箱验证码模板](supabase/templates/email-code.html) 用于 **Confirm signup** 和 **Magic Link / OTP** 两封邮件。共享给项目团队以外的用户时，配置[自定义 SMTP](https://supabase.com/docs/guides/auth/auth-smtp)。
2. 在 Render 选择 **New → Blueprint**，连接本仓库的 `main` 分支。`render.yaml` 会建立 Static Site，并提示填写下列构建变量。

   | 变量 | 值 |
   | --- | --- |
   | `WALLET_SUPABASE_URL` | Supabase 项目 URL，例如 `https://<project-ref>.supabase.co` |
   | `WALLET_SUPABASE_PUBLISHABLE_KEY` | 项目 Publishable key，兼容本地或旧项目的 `anon` key |

   前端变量会打包进公开的 JavaScript。数据库连接由 Edge Function 读取 Supabase 注入的 `SUPABASE_DB_URL`。
3. 登录 Supabase CLI，从仓库根目录运行下列命令，将 `<project-ref>` 替换为目标项目的 Reference ID。将 `WALLET_ALLOWED_ORIGINS` 设为 Render 分配的实际站点源。如果同时使用自定义域名，用逗号分隔两个源。填写源时省略末尾斜杠。

   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push --linked
   supabase secrets set WALLET_ALLOWED_ORIGINS=https://<your-site>.onrender.com
   supabase functions deploy wallet --project-ref <project-ref> --use-api
   ```

4. 打开 Render 的站点地址，用两个不同的邮箱测试登录、创建共享账本、生成邀请和加入账本，再在两端检查记账同步。

部署会初始化新的账本数据库。从旧 Sites 迁移真实账本需要单独导出数据，并将旧成员 ID 映射到 Supabase 用户。

## 本地开发

- `npm run dev` 启动旧 Sites 兼容模式，使用本地 SQLite 与模拟账号。`npm test` 运行记账规则和旧 Sites API 的回归测试。
- 使用 Supabase 本地栈时，在 `supabase/functions/.env` 中写入 `WALLET_ALLOWED_ORIGINS=http://127.0.0.1:5173`，随后运行 `supabase start` 和 `supabase functions serve wallet --env-file supabase/functions/.env`。从 `supabase status` 取得本地 API URL 和公开密钥，设置对应的构建变量后运行 `npm ci` 和 `npm run build:render`。用 `python3 -m http.server 5173 --bind 127.0.0.1 --directory dist/render` 提供前端，在 `supabase status` 列出的本地邮件面板读取验证码。
