---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: fa90a3ce7c42f36245ef4460c02dcf39_00aa7268e42611f19be552540024e231
    ReservedCode1: bWM3XhUbYnJYKzSYF6GdyE+ZJD1l+G/AXwhfytUPTSlYYNF/BzZnsRvG9BSwJLY962hCLcwbgML6xSD4DsVBxkTnleJDwC4Zlf43fGZC00/ldR9RCkdTGOAQLQ1maYEZc0HXeS2cqNX8HGJH6FY0GKHNzjWP55O5Yiat4cl1ux6bzNkl/UCrfuCPi6w=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: fa90a3ce7c42f36245ef4460c02dcf39_00aa7268e42611f19be552540024e231
    ReservedCode2: bWM3XhUbYnJYKzSYF6GdyE+ZJD1l+G/AXwhfytUPTSlYYNF/BzZnsRvG9BSwJLY962hCLcwbgML6xSD4DsVBxkTnleJDwC4Zlf43fGZC00/ldR9RCkdTGOAQLQ1maYEZc0HXeS2cqNX8HGJH6FY0GKHNzjWP55O5Yiat4cl1ux6bzNkl/UCrfuCPi6w=
---

# 云盘影视资源站

一个类似「玩偶哥哥 (wogg.net)」的网盘影视资源分享静态网站。纯静态单页应用，**无需构建工具**，可直接部署到 GitHub Pages 免费托管，资源数据通过 `data/resources.json` 维护，改数据即可更新网站内容。

配套 `pan-sync/` 工具目录提供「夸克网盘同步 + TMDB 自动刮削」流水线，可从夸克网盘自动拉取文件列表、刮削海报/简介/评分，生成兼容本站的 `resources.json`。

## 使用说明（双模式）

- **线上（静态模式）**：https://guabis.github.io/pan-site/ —— 纯静态托管，仅提供浏览 / 搜索 / 详情 / 转存跳转；所有依赖本地后端的管理入口（添加 / 配置 / 扫码 / 刷新）自动隐藏，不会出现动态功能报错。
- **本地（完整模式）**：在 `pan-site/` 目录执行 `python server.py` 后访问 http://127.0.0.1:8917 —— 前端探测到本地后端即自动解锁「添加 / 编辑资源」统一面板（含 TMDB 搜索）、站点配置、扫码登录夸克、一键刷新（夸克同步 + TMDB 刮削）。

### 添加 / 编辑资源（本地管理页）

1. 顶部「添加」或卡片上的「编辑 / 匹配」打开统一面板；
2. 输入片名（可加年份）→ 点「搜索 TMDB」→ 候选列表出现；
3. 点「选用」自动填充标题 / 海报 / 年份 / 评分 / 简介 / 演员，分类自动按「电影 / 剧集」归类；
4. 字段可继续手动修改（链接格式：每行 `名称|URL`，或直接粘贴 URL）；
5. 点「保存」→ 写回 `data/resources.json` → 自动 `git commit + push` 到 Guabis/pan-site → GitHub Pages 约 1 分钟后自动更新。

> 自动推送说明：保存时若本机网络可访问 GitHub 且已配置凭据（Git Credential Manager），会自动完成推送；网络不可达时本地数据仍保存成功，页面会提示推送未完成，可稍后在 `pan-site/` 目录手动执行 `git add data/resources.json && git commit -m "update" && git push origin main`。

### 隐私说明

本站静态仓库（GitHub Pages 部署内容）**不含**任何夸克 Cookie、账号、Token、鉴权头或真实身份信息。夸克 Cookie / 账号 / 扫码鉴权头只存在于本地 `pan-sync/config.json`，由 `.gitignore` 与部署清单双重排除，绝不进入线上仓库。

## 特性

- 最新资源列表：按 `updated_at` 更新时间倒序展示
- 分类切换：电影 / 剧集 / 动漫 / 综艺 / 短剧 / 音乐（可在 JSON 中自定义）
- 关键词搜索：匹配标题、简介、标签，输入即搜（带防抖）
- 资源卡片：标题、画质标签（4K / HD国语 / HD中字）、更新状态、简介、网盘转存按钮（新窗口打开外部链接）
- 海报展示：可选 `poster` 字段，有海报时左侧竖版海报 + 右侧内容，懒加载、加载失败自动回退无图布局；无海报时保持原样式
- 评分/年份：可选 `rating` / `year` 字段，展示在卡片 meta 行
- 响应式布局：移动端优先，手机 / 平板 / 电脑自适应
- 深色现代视觉风格，无任何第三方依赖

## 文件结构

```
pan-site/                      # 静态网站（可整体部署到 GitHub Pages）
├── index.html                 # 页面骨架
├── css/
│   └── style.css              # 样式（深色主题，含海报卡片布局）
├── js/
│   └── app.js                 # 渲染逻辑：数据加载 / 分类 / 搜索 / 卡片 / 海报
├── data/
│   └── resources.json         # ★ 数据文件（可手工维护，也可由 pan-sync 自动生成）
└── README.md

pan-sync/                      # 夸克同步 + TMDB 刮削流水线（Python 3，可选安装）
├── config.json                # 配置模板（凭证占位，需填写后使用）
├── quark_sync.py              # 夸克网盘文件列表获取（cookie / openapi 两种模式）
├── tmdb_scrape.py             # TMDB 刮削（标题提取 / 海报 / 简介 / 评分）
└── run_pipeline.py            # 主入口：同步 → 刮削 → 生成 resources.json
```

## 本地预览

方式一（Python，任选其一）：

```bash
cd pan-site
python -m http.server 8080
# 浏览器访问 http://localhost:8080
```

方式二：VS Code 安装 Live Server 插件，右键 `index.html` → Open with Live Server。

> 直接用浏览器双击打开 `index.html` 时，因 file:// 协议下 fetch 本地 JSON 会被浏览器拦截，建议始终用本地静态服务器预览。

## 部署到 GitHub Pages

### 方式一：项目页（gh-pages 分支）

适合「某个仓库托管该站点」的场景，站点地址为 `https://<用户名>.github.io/<仓库名>/`。

1. 将 `pan-site` 目录内容推送到 GitHub 仓库（例如 `pan-site` 仓库的默认分支）：
   ```bash
   cd pan-site
   git init
   git add .
   git commit -m "init pan site"
   git branch -M main
   git remote add origin git@github.com:<用户名>/pan-site.git
   git push -u origin main
   ```
2. 将当前版本发布到 `gh-pages` 分支：
   ```bash
   git checkout -b gh-pages
   git push origin gh-pages
   git checkout main
   ```
3. 仓库 Settings → Pages → Source 选择 **Deploy from a branch**，Branch 选 `gh-pages`，目录选 `/ (root)`，保存。
4. 等待 1~2 分钟后访问 `https://<用户名>.github.io/<仓库名>/`。

> 后续更新流程：修改 `resources.json` → commit → push main → 切到 gh-pages 分支把新内容合并/推送过去。也可在仓库 Actions 配置「main 推送时自动发布到 gh-pages」实现自动部署。

### 方式二：用户页 / 组织页（username.github.io）

适合「个人专属站点」的场景，站点地址为 `https://<用户名>.github.io/`，仓库名必须是 `<用户名>.github.io`。

1. 在 GitHub 新建仓库，仓库名固定为 `<用户名>.github.io`（用户名需小写）。
2. 将 `pan-site` 目录的全部文件放到该仓库根目录并推送：
   ```bash
   cd pan-site
   git init
   git add .
   git commit -m "init pan site"
   git branch -M main
   git remote add origin git@github.com:<用户名>/<用户名>.github.io.git
   git push -u origin main
   ```
3. 仓库 Settings → Pages → Source 选 `main` 分支、目录 `/ (root)`，保存。
4. 等待片刻后访问 `https://<用户名>.github.io/`（用户页只能由 main/master 分支发布，不能使用 gh-pages 分支）。

## resources.json 数据维护方法

所有站点数据集中在一个 JSON 文件，结构如下：

```json
{
  "site": {
    "name": "云盘影视资源站",          // 站点名称（JS 运行时会覆盖页面标题，改这里即可全站换名）
    "slogan": "精选高清影视资源 · 一键转存",
    "description": "站点描述",
    "notice": "页脚声明，如版权提示"
  },
  "categories": ["电影", "剧集", "动漫", "综艺", "短剧", "音乐"],
  "resources": [
    {
      "id": 1,                          // 唯一编号，新增时不要重复
      "title": "流浪地球3（示例）",       // 资源标题
      "category": "电影",                // 所属分类，必须存在于 categories
      "tags": ["4K", "HDR", "国语"],     // 画质/类型标签，展示在卡片上
      "status": "更新至08集",            // 更新状态，展示在卡片右上角
      "description": "一句话简介",        // 卡片简介
      "updated_at": "2026-11-18",       // 更新时间 YYYY-MM-DD，列表按此倒序
      "poster": "https://.../海报.jpg",  // [可选] 海报图 URL（图片懒加载，失败自动回退）
      "year": 2026,                     // [可选] 年份，展示在卡片 meta 行
      "rating": 8.1,                    // [可选] 评分（0-10），展示在卡片 meta 行
      "links": [                         // 网盘链接数组，可多条
        { "name": "阿里云盘", "url": "https://www.alipan.com/s/xxxx" }
      ]
    }
  ]
}
```

维护要点：

- 新增资源：在 `resources` 数组末尾追加一个对象，注意 `id` 递增、`category` 必须是 `categories` 里已有的值。
- 修改分类：直接改 `categories` 数组；新增分类后记得把对应资源对象的 `category` 改过来。
- 更新时间：写 `YYYY-MM-DD`（如 `2026-11-18`），网站会按日期倒序自动把最新资源排前面。
- 链接失效：改对应 `links[].url` 即可，无需改代码。
- 海报字段：`poster` / `year` / `rating` 均为**可选**，缺省时前端自动降级为无海报布局，不影响其他功能。
- 站点改名：只需改 `site.name` 一处，页面标题、头部名称会自动更新。
- JSON 校验：修改后务必保证逗号、引号、花括号闭合正确；可用 [jsonlint.com](https://jsonlint.com) 校验，或 `python -m json.tool data/resources.json` 检查。

## 夸克同步 + TMDB 刮削流水线（pan-sync）

> 前置：本机安装 Python 3，并安装依赖 `pip install requests`（三个 py 文件都只用标准库 + requests）。

### 1. 配置 config.json（凭证后补）

| 字段 | 说明 | 获取方式 |
|---|---|---|
| `quark_mode` | 同步模式：`cookie` 或 `openapi` | 默认 `cookie` |
| `quark_cookie` | 夸克网页版 Cookie | 浏览器登录 [pan.quark.cn](https://pan.quark.cn) → F12 打开 DevTools → Network → 刷新页面 → 任选一个请求 → 复制 Request Headers 里的 `Cookie:` 完整值 |
| `quark_client_id` | 夸克开放平台 Client ID（openapi 模式用） | [夸克开放平台](https://open.quark.cn/) 申请（当前主要面向企业用户） |
| `quark_client_secret` | 夸克开放平台 Client Secret（openapi 模式用） | 同上 |
| `quark_dir` | 要同步的网盘目录路径 | 如 `/影视资源`，与网盘内实际目录一致 |
| `tmdb_api_key` | TMDB API Key | [themoviedb.org](https://www.themoviedb.org/) 免费注册 → Settings → API → 创建 Key（v3 auth） |
| `output_path` | 生成的 resources.json 路径 | 默认 `../pan-site/data/resources.json`，即直接覆盖网站数据文件 |

### 2. 运行命令

```bash
cd pan-sync

# 试运行：只打印同步+刮削结果，不写文件（推荐先跑这个，确认凭证与目录正确）
python run_pipeline.py --dry-run

# 小批量测试：只处理前 5 个文件
python run_pipeline.py --dry-run --limit 5

# 正式运行：同步全部文件并写入 output_path（默认覆盖 pan-site/data/resources.json）
python run_pipeline.py
```

流程：读 config → `quark_sync` 获取文件列表 → 逐个 `tmdb_scrape` 刮削（失败不中断）→ 推断分类（网盘目录名 → 剧集特征 → TMDB 类型）→ 生成兼容本站结构的 `resources.json`。

### 3. 输出与网站数据的联动

- `run_pipeline.py` 生成的 JSON 结构与 `pan-site/data/resources.json` 完全一致，可直接被前端读取。
- 生成资源的 `links` 中 `name` 固定为「夸克网盘」，`url` 为占位符 `https://pan.quark.cn/s/REPLACE_WITH_SHARE_LINK`——**同步只能拿到网盘文件，公开分享链接需要你手动补充**。
- 同步生成的简介/海报来自 TMDB 自动匹配，可能存在误匹配，**发布前建议人工核对** `title` / `poster` / `description`。
- 分类推断优先级：① 网盘父目录名（如 `/影视资源/电影` → 电影）→ ② 文件名含 `SxxExx` / `第x集` → 剧集 → ③ TMDB `media_type` → 兜底电影。
- 建议把 `pan-sync` 与 `pan-site` 放同一仓库（如仓库根目录并列两个文件夹），改完数据直接走上面的 Git 部署流程。

## 示例数据说明

仓库预置了 10 条示例资源，覆盖 电影 / 剧集 / 动漫 / 综艺 / 短剧 / 音乐 六个分类：

- 均为**虚构示例数据**（标题含“示例”字样），仅用于演示页面效果
- 其中 8 条带 `poster` 字段（图片为 picsum.photos 占位图，演示海报布局与懒加载），2 条不带（演示无海报兼容）
- 网盘链接为 `alipan.com` 占位地址，点击不会进入真实资源页
- 正式使用前请：删除或替换示例条目 → 填入你自己的真实资源与链接（或用 pan-sync 自动生成后人工核对）→ 重新部署

## 注意事项

- 只提供网盘分享链接的导航/聚合，不存储任何影视文件本体
- 资源版权归原作者所有，建议在页脚声明“请勿用于商业用途”
- 若需收录新资源，建议只收录 1080P 以上画质，保持站点调性与 wogg 一致
*（内容由AI生成，仅供参考）*
