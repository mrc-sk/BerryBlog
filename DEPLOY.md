# Cloudflare 部署清单

照抄执行，每步都有说明。当前环境：wrangler `3.114.17`，Node 22。

---

## 第 1 步：登录（只需一次）

```bash
cd blog
npx wrangler login
```

浏览器会弹出授权页，点「Allow」。终端会显示登录成功。

**无浏览器/服务器场景**（可选，用 API Token）：

```bash
# Cloudflare Dashboard → My Profile → API Tokens → Create Token
# 权限：Account > Workers Scripts > Edit，再加 Account > D1 > Edit
npx wrangler login   # 或者用下面这条直接写配置
```

如果用 token，wrangler 会引导你粘贴。**token 不要写进任何提交的文件。**

---

## 第 2 步：创建 D1 数据库

```bash
npx wrangler d1 create blog
```

输出示例：

```
🌀 Creating Cloudflare D1 database blog...
✨ Success! Created your new D1 database blog with the ID: xxxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
📅 Mentioned in your wrangler.toml:
	[[d1_databases]]
	binding = "DB"
	database_name = "blog"
	database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**把那个 UUID 记下来**，下一步要用。

---

## 第 3 步：填进配置

仓库里不含 `wrangler.jsonc`（它含与个人账号绑定的 D1 ID），先从模板复制：

```bash
cp wrangler.example.jsonc wrangler.jsonc      # Windows PowerShell: Copy-Item
```

编辑 `wrangler.jsonc`，把 `database_id` 换成刚才的 UUID：

```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "blog",
      "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "migrations_dir": "schema"
    }
  ],
```

`vars` 里的个人信息也可以在这里改（也可以部署后在后台 `/admin/settings` 改站名/简介/关于/页脚）。

---

## 第 4 步：初始化线上数据库

```bash
npm run db:init:remote
npm run db:seed:remote
```

第一条建 6 张表（posts / tags / post_tags / comments / users / sessions + rate_limits + settings），第二条灌示例文章和默认管理员。

**两条都必须跑**，否则部署后页面会因为查不到表而报错。

---

## 第 5 步：部署

```bash
npm run deploy
```

完成后终端给出地址：

```
https://nova-blog.<你的子域>.workers.dev
```

浏览器打开验证首页和 `/admin`。

---

## 第 6 步（必做）：改默认密码

默认账号 **admin / admin123**。两种改法任选：

**A. 后台改（推荐）**

打开 `/admin/settings` → 修改密码 → 至少 8 位。

**B. 命令行改**

```bash
node test/gen-hash.mjs '你的新密码'
# 复制输出的 pbkdf2_sha256$... 整串

npx wrangler d1 execute blog --remote --command \
  "UPDATE users SET password_hash='pbkdf2_sha256\$100000\$你的salt\$你的hash' WHERE username='admin';"
```

---

## 第 7 步（可选）：自定义域名

```bash
npx wrangler domains add blog.example.com
```

或者 Cloudflare Dashboard → Workers → 你的 Worker → Settings → Domains。

要求该域名已经托管在 Cloudflare（NS 指向 CF）。

---

## 第 8 步（可选）：清空示例文章

```bash
npx wrangler d1 execute blog --remote --command \
  "DELETE FROM post_tags; DELETE FROM posts; DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM post_tags);"
```

保留站点结构和后台，清空示例内容。

---

## 第 9 步（可选）：填个人信息

编辑 `wrangler.jsonc` 的 `vars`：

```jsonc
  "vars": {
    "SITE_NAME": "你的博客名",
    "SITE_TAGLINE": "一句话简介",
    "AUTHOR_NAME": "你的名字",
    "AUTHOR_BIO": "自我介绍",
    "AUTHOR_AVATAR": "https://.../avatar.png",
    "GITHUB_URL": "https://github.com/xxx",
    "X_URL": "",
    "EMAIL": "you@example.com",
    "COMMENT_ENABLED": "1",
    "ITEMS_PER_PAGE": "8"
  }
```

然后 `npm run deploy` 生效。

> 站名、副标题、关于、页脚也可以在后台 `/admin/settings` 改，那几个存数据库、优先级高于 `vars`。

---

## 以后更新代码

```bash
git pull
npm install          # 如果 package.json 变了
npm run deploy
```

**只有代码改动**时不需要重跑 `db:init:remote` / `db:seed:remote`。

---

## 加新表/改表结构

```bash
# 1. 改 schema/schema.sql（或新建 schema/0002_xxx.sql）
# 2. 推到线上
npx wrangler d1 execute blog --remote --file=./schema/0002_add_xxx.sql
```

注意 `db:init:remote` 用的是 `CREATE TABLE IF NOT EXISTS`，重复跑安全；但它**不含 `ALTER`**，改字段得单独写迁移文件。

---

## 命令速查

`package.json` 里已经封装好了常用命令，直接 `npm run xxx`：

| 目的 | 命令 |
| --- | --- |
| 登录 Cloudflare | `npm run login` |
| 看当前登录状态 | `npm run whoami` |
| 本地开发 | `npm run dev` |
| 部署 | `npm run deploy` |
| 建表（线上） | `npm run db:init:remote` |
| 灌种子（线上） | `npm run db:seed:remote` |
| 查线上数据 | `npm run db:query -- "SELECT * FROM posts;"` |
| 看所有 D1 | `npm run db:list` |
| 看线上实时日志 | `npm run tail` |
| 类型检查 | `npm run typecheck` |
| 端到端测试（需先跑 dev） | `npm test` |
| 批量截图 | `npm run screenshot` |
| 生成密码哈希 | `npm run hash -- '你的新密码'` |

`npm run db:query` 是带 `--remote` 的，所以执行时要再加一个 `--` 传给脚本后面的 SQL。

---

## 可能遇到的错

**`Database not found` / 404**
第 3 步的 `database_id` 没填对，或者第 4 步没跑。

**`no such table: posts`**
第 4 步的建表命令没跑，或者忘了 `--remote`（不加 `--remote` 是操作本地模拟库）。

**`Page not found` 但 D1 正常**
Worker 没部署成功，看 `npm run deploy` 的完整输出。

**推送/命令卡住不动**
这台机器有企业代理，wrangler 会识别并使用它。如果某条命令卡超过 1 分钟，Ctrl+C 后重试；反复卡就检查 `HTTPS_PROXY` 环境变量。

**想确认线上到底有什么数据**
```bash
npm run db:query -- "SELECT slug, title, status FROM posts;"
```

**改示例文章的内容**

`schema/seed.sql` 由 `test/gen-seed.mjs` 生成，**不要手改**（手写很容易把markdown 里的真实换行写进 SQL 字符串，导致线上静默插入 0 行）。改内容请改生成器：

```bash
node test/gen-seed.mjs --verify    # 重新生成并真实跑 SQLite 验证
npm run db:seed:remote             # 灌线上
```