# 独立站部署手册（Cloudflare Pages）

> 站点目录：`north-china-metal-sourcing/site/`
> 纯静态 HTML + 一个 Pages Function 接收询盘。无框架、无构建步骤，改完直接推。

---

## 一、目录结构

```
site/
├── index.html            主页（单页承载全部内容：是什么 / 为什么 / 产品范围 / 流程 / 费用）
├── inquiry.html          询盘表单（唯一转化页）
├── privacy.html          隐私声明
├── 404.html              错误页（Pages 自动使用）
├── robots.txt
├── sitemap.xml
├── _headers              安全响应头与缓存策略
├── schema.sql            D1 建表语句
├── images/               配图（放入即自动显示，见 images/README.md）
├── assets/
│   ├── style.css         全站样式（浅色 + 深蓝点缀）
│   ├── config.js         ★ 联系方式的唯一修改点
│   └── site.js           导航、配置注入、表单提交
└── functions/
    ├── api/inquiry.js    POST /api/inquiry —— 收询盘
    └── api/leads.js      GET  /api/leads   —— 导出 CSV（带密钥）

_v1-text-only/ _v2-multipage/   历史版本备份，部署时可整个排除（不上传）
```

页面地址（Pages 会自动去掉 `.html`）：
`/` · `/inquiry` · `/privacy`

---

## 二、上线前必须做的两件事

### 1. 替换品牌名 / 域名 / WhatsApp / 邮箱（一条命令）

```bash
cd north-china-metal-sourcing/site
python ../tools/apply_brand.py \
  --brand "你的品牌名" \
  --domain "https://yourdomain.com" \
  --whatsapp "8613812345678" \
  --email "you@yourdomain.com"
```

会自动改所有 HTML、sitemap、robots 和 `assets/config.js`，并在改动前留 `.bak` 备份。改完搜索一下确认没有残留：

```bash
grep -rn "example.com\|North China Buying Office" . --include=*.html --include=*.js --include=*.xml --include=*.txt
```

### 2. WhatsApp 号码格式

`assets/config.js` 里的 `whatsapp` 必须是**纯数字的国际格式**（带国家码，无 `+`、无空格）。
中国号码示例：`8613812345678`。

> 想临时改一个联系方式，直接改 `assets/config.js` 即可，全站的 WhatsApp 按钮和邮箱链接会同步更新。

---

## 三、本地预览

```bash
cd north-china-metal-sourcing/site
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

本地静态服务器不会执行 `functions/`，表单提交会失败——这是正常的。表单要在 `npx wrangler pages dev .` 下才能测。

---

## 四、部署到 Cloudflare Pages

### 方式 A：Git 连接（推荐，推代码即自动部署）

1. 把 `site/` 目录作为一个仓库推到 GitHub/GitLab
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. 选择仓库，构建设置：
   - **Framework preset**: `None`
   - **Build command**: 留空
   - **Build output directory**: `/`（仓库根就是站点根）
4. **Save and Deploy**

### 方式 B：直接用 Wrangler 上传（不走 Git）

```bash
cd north-china-metal-sourcing/site
npx wrangler pages deploy . --project-name=ncm-sourcing
```

---

## 五、数据库（D1）与询盘存储

```bash
# 1. 建库
npx wrangler d1 create ncm-sourcing
#    命令会返回 database_id，记下来

# 2. 建表（把 schema.sql 推到线上库）
npx wrangler d1 execute ncm-sourcing --remote --file=schema.sql
```

然后在 Cloudflare Dashboard 绑定到 Pages 项目：

**Pages 项目 → Settings → Functions → D1 database bindings**
- Variable name: **`DB`**（必须叫这个名字，代码里用 `env.DB`）
- D1 database: `ncm-sourcing`
- 改完 **重新部署一次** 才生效

> 没绑 D1 也能上线，但询盘不会被存储，只在配置了邮件的情况下发一封通知。

---

## 六、环境变量

**Pages 项目 → Settings → Environment variables**（Production 和 Preview 都要加）

| 变量 | 必填 | 说明 |
|---|---|---|
| `DB` | 建议 | 上一步的 D1 绑定，不是普通变量 |
| `NOTIFY_TO` | 建议 | 收到询盘后通知发到哪个邮箱 |
| `RESEND_API_KEY` | 可选 | 邮件服务密钥。不填则只存 D1、不发邮件 |
| `RESEND_FROM` | 可选 | 发信人，如 `Inquiries <inquiries@yourdomain.com>`，需在邮件服务里验证过域名 |
| `LEAD_EXPORT_KEY` | 可选 | 导出 CSV 的口令，设了才开放 `/api/leads` |

**邮件通知用的是 Resend**（`api.resend.com`）。注册后拿到 API Key，按其指引在 DNS 里加一条 TXT 验证域名即可。不配置也不影响网站和存储，只是你不会即时收到提醒——那就每天打开一次导出链接看新询盘。

---

## 七、自定义域名

**Pages 项目 → Custom domains → Set up a domain**

- 域名在 Cloudflare 托管：点一下自动加记录，1 分钟生效
- 域名在别处：按提示在 DNS 加 CNAME 指向 `<project>.pages.dev`
- SSL 自动签发，并把 `http` 强制跳 `https`

上线后验证：
```bash
curl -I https://yourdomain.com
curl -I https://yourdomain.com/inquiry
curl -X POST https://yourdomain.com/api/inquiry -H "Content-Type: application/json" -d '{}'
# 最后一条应返回 422 与缺字段提示 —— 说明 Functions 已生效
```

---

## 八、上线后第一天要做完的三件事

1. **提交 Google Search Console** —— 验证域名所有权，提交 `https://yourdomain.com/sitemap.xml`
2. **加 Cloudflare Web Analytics** —— Dashboard → Analytics → Web Analytics，加站点，把给的 JS 片段贴到每个页面 `</body>` 前。
   它是**无 cookie 的聚合统计**，与隐私声明里"不设 cookie、不做跨站追踪"的说法一致，不要换成 GA4。
3. **完整走一遍自己的表单** —— 用另一个邮箱提交一次真实询盘，确认：收到通知邮件、D1 里有记录、页面上显示成功提示。

**要盯的五个数（全部来自上面的 Analytics + D1）：**

| 指标 | 判断什么 |
|---|---|
| 月均**完整规格询盘**数 | ★ 唯一核心指标 |
| 询盘来源国 | 肯尼亚 vs 尼日利亚，谁先跑通 |
| 询盘 → 报价 → 成交的转化 | 3%–7% 这个定价能不能成交 |
| 追问费率细节的比例 | 量级写得偏高还是偏低 |
| 询盘 → 首单的天数 | "4–8 周周期"的假设对不对 |

---

## 九、导出询盘

浏览器直接打开（记得换密钥）：

```
https://yourdomain.com/api/leads?key=你的LEAD_EXPORT_KEY
```

会下载一份 Excel 能直接打开的 CSV（带 UTF-8 BOM，中文不乱码）。只看未处理的：

```
https://yourdomain.com/api/leads?key=你的LEAD_EXPORT_KEY&status=new
```

---

## 十、日常维护

| 要改什么 | 改哪里 |
|---|---|
| 联系方式（WhatsApp / 邮箱） | `assets/config.js` |
| 品牌名、域名 | 跑一次 `tools/apply_brand.py` |
| 文案 | 对应 `.html` 文件 |
| 配色、字号 | `assets/style.css` 顶部的 `:root` 变量 |
| 询盘表单字段 | `inquiry.html` + `functions/api/inquiry.js` 的 `MAX` / `REQUIRED` + `schema.sql` |

**改完记得推一次 Git（或重跑一次 deploy 命令），Pages 才会更新。**

---

## 十一、几个容易踩的坑

| 现象 | 原因 |
|---|---|
| 打开 `/inquiry` 报 404 | 文件名必须是 `inquiry.html`，且与 `index.html` 同级 |
| 表单提交报 405 / 404 | `functions/api/inquiry.js` 路径错了；Cloudflare Pages 里目录必须是 `functions/api/` |
| 表单成功但 D1 没数据 | D1 绑定名不是 `DB`，或绑定后没重新部署 |
| 收不到通知邮件 | 没设 `RESEND_API_KEY` / `NOTIFY_TO`；或 `RESEND_FROM` 用了未验证的域名 |
| WhatsApp 按钮点了没反应 | `config.js` 里的号码带了 `+`、空格或括号 |
| 改了 `config.js` 但页面没变 | 浏览器缓存；`assets/*` 缓存 1 小时，强刷一次（Ctrl+F5） |
