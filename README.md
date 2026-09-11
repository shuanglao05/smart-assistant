# 智能个人助理系统（IPAS）

基于 **LangChain + LangGraph + FastAPI + React** 的多用户、多会话 AI 助理 Web 应用。

助手具备**工具调用**（计算器 / 天气 / 网页搜索 / 待办 / 站内提醒）、**会话记忆**、**技能（人设）定制**、
**附件与图片问答**、**RAG 知识库检索**、**本地 / 云端大模型一键切换**等能力，数据持久化到 SQLite。

> 适合作为课程设计 / 入门级 AI Agent 项目：前后端分离、代码带详细中文注释、本地零成本即可跑通。

---

## 功能总览

### 对话
- **流式输出**（SSE 打字机），可随时**停止**，答得不好可 **⟳ 重新生成**
- **会话记忆**：同一会话多轮上下文连贯；**不同会话互不干扰**；**切换模型不丢历史**
- **每条回答标注所用模型**（本地 / 云端 · 模型名），便于回看"这段对话是哪个模型答的"
- **思考过程**展示：推理模型（或本地开启 think）的思考内容折叠展示，与正文分离

### 大模型
- **本地 Ollama**（默认 `qwen3:8b`，离线、免费）⇄ **云端 OpenAI 兼容平台**（阿里云百炼 / DeepSeek / 智谱 / OpenAI…）
- **界面内切换**：顶栏下拉自绘选择器，**按会话独立**记忆所用模型
- **模型清单可维护**：预设 + 自定义，支持一键从平台 `/models` 拉取
- 接入云端**保存前真实测连**，配置错误立刻给出原因，不会写坏现有配置

### 知识与文件
- **附件问答**：上传 `txt / md / csv / json / pdf / py / js / ts / html`，AI 基于文件内容回答（PDF 自动抽取文字）
- **图片识别**：上传图片（`png / jpg / webp / gif / bmp`）交给**多模态模型**直接看图
- **RAG 知识库**：多个知识库、上传即**自动切分 + 向量化**（本地 `bge-m3`，零成本）、会话内勾选参与检索、回答下方**标注引用来源**
- **知识库关系图**：把「知识库 → 文档 → 知识片段」可视化（纯 SVG 绘制，可点片段看内容）
- **文档查看器**：点击引用文档从右侧滑出查看（Markdown 渲染 + 下载）

### 工具与效率
- **计算器**：`ast` 白名单解析（不使用 `eval`，安全）
- **天气**：中文城市名即可；实况 + 未来多日预报（高德 / OpenWeatherMap）
- **待办**：自然语言记录，面板勾选 / 删除 / 看进度
- **站内提醒**：AI 把提醒推进右上角**通知中心**（铃铛红点）
- **技能（Skills）**：一段指令即一套人设，**勾选即生效**；支持新建 / 编辑 / 删除 / 导入 `.md` 或整个技能文件夹
- **跨会话历史搜索**、**导出会话为 Markdown**

### 功能页
默认顺序：**对话 → 技能 → 知识库 → 笔记 → 日程 → 课表 → 天气 → 待办 → 计时器 → 日历**（可在右侧功能栏拖拽调整）

| 功能页 | 说明 |
|---|---|
| 智能笔记 | 按日期分组的 Markdown 笔记，支持编辑 / 预览切换、AI 归纳要点、导出 6 种格式（`md/txt/html/pdf/doc/json`） |
| 日程规划 | 添加日程，**开始前 5 分钟**由后端后台协程自动推送站内通知 |
| 课表 | 节次 × 星期表格；支持**智能导入**（粘贴文本 / 网址 / **截图识别**）、按周次过滤（`1-16`、`1,3,5-8`、`1-16单周`）；格子尺寸可拖滑杆自由调节 |
| 天气 | 中文城市名查询（高德优先、OpenWeatherMap 备用） |
| 待办 | 自然语言记录，勾选 / 删除 / 看进度 |
| 计时器 | 倒计时 + 秒表；倒计时结束推送通知并响铃，**提示音可选 6 种音色、音量可调** |
| 日历 | 月视图备忘（存本机 **localStorage**）；**公历 + 农历节日标注**（春节 / 端午 / 中秋…）；格子尺寸可调节 |

### 界面
- 双主题（浅色 / 深色）、字号三档（小 / 中 / 大）、中英文切换
- 三栏布局：会话列表 / 主内容 / 功能栏，**左右栏可拖宽、可收起**，输入框可拖高

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + lucide-react + mermaid（图表渲染） |
| 后端 | FastAPI + SQLAlchemy + SQLite |
| AI 层 | LangChain + LangGraph（`create_react_agent`） |
| 模型 | Ollama（本地，`ChatOllama`）/ 任意 OpenAI 兼容平台（`ChatOpenAI`） |
| 向量检索 | Ollama `bge-m3` + 纯 Python 余弦相似度（无额外向量库依赖） |
| 鉴权 | JWT + bcrypt |

---

## 快速启动

### 0. 前置

- **Python 3.10+**（开发用 3.13）
- **Node.js 18+**
- **Ollama**（可选项但推荐：本地模型 + 知识库向量化都靠它）
  ```bash
  ollama pull qwen3:8b     # 本地对话模型
  ollama pull bge-m3       # 知识库向量化模型（要用 RAG 才需要）
  ```

### 1. 后端

```powershell
cd backend

# 首次：建虚拟环境并装依赖
py -3.13 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 复制配置模板（.env 不入库）
copy .env.example .env

# 启动（必须在 backend 目录下，因为代码用 app.xxx 绝对导入）
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- 接口文档：http://127.0.0.1:8000/docs
- 健康检查：http://127.0.0.1:8000/api/health （会返回当前使用的大模型）

### 2. 前端

```powershell
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173 ，注册账号即可开始对话。

> 前端通过 Vite 代理把 `/api` 转发到 `http://127.0.0.1:8000`，无需额外配置 CORS。

### 3. 一键启动（Windows）

根目录 `start.bat`：双击即先后拉起后端与前端两个窗口。

---

## 配置说明（`backend/.env`）

```env
# ---------- 大模型 ----------
LLM_PROVIDER=ollama            # ollama（本地）/ cloud（云端）
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_THINK=false             # false 关闭思考，响应快 3~5 倍；想看到思考过程可设 true

# 云端（LLM_PROVIDER=cloud 或界面里接入云端时使用）
CLOUD_API_KEY=
CLOUD_BASE_URL=                # 留空 = OpenAI 官方
                               # 阿里云百炼：https://dashscope.aliyuncs.com/compatible-mode/v1
                               # DeepSeek ：https://api.deepseek.com
                               # 智谱     ：https://open.bigmodel.cn/api/paas/v4/
CLOUD_MODEL=qwen-plus
# 界面「切换模型」下拉里的云端模型清单（逗号分隔）
CLOUD_MODELS=qwen3.8-max,qwen-max,qwen-plus,qwen-flash,deepseek-v3.2,glm-5.2,kimi-k3,qwen3-vl-plus

# 多模态视觉模型（图片识别 / 课表截图导入），必须支持图片输入
VISION_MODEL=qwen3-vl-plus

# ---------- RAG 知识库 ----------
EMBED_PROVIDER=ollama
EMBED_MODEL=bge-m3
RAG_CHUNK_SIZE=500             # 每个知识片段的目标字符数
RAG_CHUNK_OVERLAP=80
RAG_TOP_K=4                    # 每次检索返回的片段数

# ---------- 其他 ----------
SECRET_KEY=change-me-to-a-random-string
DATABASE_URL=sqlite:///./app.db
AMAP_API_KEY=                  # 天气（可选，高德）
OPENWEATHERMAP_API_KEY=        # 天气（可选，备用）
```

> **模型名要和平台一致**：同一个模型在不同平台叫法不同（例如百炼是 `deepseek-v3.2`，DeepSeek 官方是 `deepseek-chat`）。
> 填错时保存前的测连会直接告诉你原因。

---

## 目录结构

```
smart-assistant/
├── backend/
│   ├── app/
│   │   ├── main.py            入口：CORS + 路由注册 + 启动建表
│   │   ├── config.py          集中配置（模型 / JWT / DB / 工具 Key / 可选模型清单）
│   │   ├── database.py        engine / SessionLocal / init_db（含增量 ALTER 迁移）
│   │   ├── models.py          ORM：User/Conversation/Message/TodoItem/Skill/FileItem/Notification/KbCollection/KbChunk
│   │   ├── schemas.py         Pydantic 请求响应模型
│   │   ├── deps.py            JWT → 当前用户
│   │   ├── auth.py            注册 / 登录
│   │   ├── users.py           个人资料（昵称 / 头像 / 主题 / 字号 / 语言 / 改密）
│   │   ├── sessions.py        会话 CRUD + 消息列表
│   │   ├── chat.py            聊天接口（流式 / 非流式，核心）
│   │   ├── agent_manager.py   Agent 工厂 + 会话级缓存 + 共享记忆
│   │   ├── tools.py           工具集（计算 / 天气 / 搜索 / 待办 / 通知 / 知识库检索）
│   │   ├── rag.py             RAG 核心：切分 / 向量化 / 检索
│   │   ├── kb.py              知识库与文档管理 + 关系图数据
│   │   ├── files.py           文件上传 / 详情（上传即建索引）
│   │   ├── skills.py          技能 CRUD
│   │   ├── todos.py           待办 CRUD
│   │   ├── notifications.py   站内通知
│   │   ├── weather.py         天气接口
│   │   ├── search.py          跨会话历史搜索
│   │   ├── llm_config.py      运行时切换 / 配置云端模型
│   │   ├── notes.py           智能笔记 CRUD + AI 归纳（/summarize）
│   │   ├── schedules.py       日程 CRUD + 后台提醒协程
│   │   ├── courses.py         课表 CRUD + 智能导入（/import，支持图片）
│   │   └── api_keys.py        当前 API 配置（Key 脱敏）
│   ├── requirements.txt
│   ├── .env.example           ← 配置模板（真实 .env 不入库）
│   └── uploads/               用户上传（不入库）
├── frontend/
│   ├── src/
│   │   ├── api/               axios 实例 + 接口封装
│   │   ├── components/        布局与组件（ChatWindow/ModelPicker/KbGraph/GridZoom…）
│   │   ├── pages/             功能页（笔记/日程/课表/天气/技能/待办/计时器/日历/知识库）
│   │   ├── chime.ts           提示音合成（Web Audio，6 种音色）
│   │   ├── globalModel.ts     全局模型选择（localStorage + 事件同步）
│   │   ├── toast.ts           全局轻提示
│   │   ├── types.ts           全局类型
│   │   └── styles.css         全局样式（CSS 变量 + 双主题）
│   ├── package.json
│   └── vite.config.ts         /api 代理到后端
├── docs/                      文档（安装指南 / 结构解析 / 分享介绍 / 详细开发文档）
├── start.bat                  Windows 一键启动
└── README.md
```

---

## 文档导航

| 文档 | 内容 |
|---|---|
| [`docs/安装指南_环境准备.md`](docs/安装指南_环境准备.md) | 环境准备（Python / Node / Ollama）详细步骤与常见坑 |
| [`docs/项目结构清单与框架解析.md`](docs/项目结构清单与框架解析.md) | 逐文件说明 + LangChain / LangGraph 与 RAG 原理剖析 |
| [`docs/项目分享介绍.md`](docs/项目分享介绍.md) | 答辩 / 分享用的精简介绍 |
| [`docs/开发文档_详细版.md`](docs/开发文档_详细版.md) | 需求 / 设计 / 接口 / 测试 / 排障 / 更新记录（含 v1.1、v1.2） |

---

## 技术要点（与常见写法不同的地方）

| 点 | 做法 | 原因 |
|---|---|---|
| Agent | `langgraph.prebuilt.create_react_agent` | 旧版 `initialize_agent` 已废弃 |
| 记忆 | **全局共享一个** `MemorySaver` + `thread_id`（= 会话 id） | 会话天然隔离；且**切换模型 / 技能 / 知识库时不会丢上下文** |
| 本地模型 | `langchain-ollama` 的 `ChatOllama` | 只有 Ollama **原生** `/api/chat` 端点才能让 `think=false` 生效；走 `/v1` 兼容端点关不掉 Qwen3 的思考 |
| 密码哈希 | 直接用 `bcrypt` | `passlib` 在 Python 3.13 + bcrypt 4.x 下报 `__about__` 错误 |
| 计算器 | `ast` 白名单解析 | 杜绝 `eval` 的任意代码执行风险 |
| 多用户隔离 | 工厂函数 `make_xxx_tools(user_id)` + 查询恒带 `user_id` | 工具/查询都绑定当前用户 |
| 向量检索 | 纯 Python 余弦相似度 | 免装向量数据库，SQLite 存向量即可；数据量大时可换 FAISS / Chroma |
| 思考过程 | 后端流式剥离 ` thinking…` / 转发 `reasoning_content` | 思考与正文分离展示，不污染回答 |
| 知识库上限 | 单文档 ≤ **20 万字符**、单文件 ≤ 8MB | 超长文档请切卷上传（见 `docs/项目结构清单与框架解析.md`） |

---

## 功能验收清单

- [ ] 注册 / 登录，错误密码返回 401
- [ ] 新建 / 切换 / 删除会话；**换账号看不到别人的会话**
- [ ] 刷新页面历史消息仍在
- [ ] `帮我计算 12*15` → 180（计算器工具）
- [ ] `北京天气怎么样` → 天气（需配置 Key）
- [ ] `添加待办：写课程报告` → 待办面板出现；换账号看不到
- [ ] 上传 PDF / txt 后提问 → 基于文件内容回答
- [ ] 上传图片后提问 → 多模态模型识别图片
- [ ] 新建知识库 → 上传文档 → 勾选该库提问 → 回答下方出现**来源标注**
- [ ] 知识库页切到「关系图」→ 看到 库 → 文档 → 片段 的结构
- [ ] 顶栏切换本地 / 云端模型 → 后续回答下方标注随之变化，且**上下文不断**
- [ ] `提醒我明天上午 9 点开组会` → 右上角铃铛出现未读

---

## 常见问题

| 现象 | 原因 / 解决 |
|---|---|
| `ModuleNotFoundError: No module named 'app'` | 必须在 `backend/` 目录下用 `uvicorn app.main:app` 启动 |
| 回复内容为空 | 本地 Qwen3 默认开启思考，确认 `.env` 里 `OLLAMA_THINK=false` 且用的是 `ChatOllama`（不是 `/v1` 端点） |
| 启动报 `bcrypt has no attribute '__about__'` | 装了 passlib，本项目不用它：`python -m pip uninstall passlib` |
| 云端测连失败 `model_not_found` | 模型名与平台不匹配（不同平台叫法不同），改到该平台真实存在的模型名 |
| 云端测连超时 | 检查 `CLOUD_BASE_URL` 是否填对（留空会回落 OpenAI 官方） |
| 天气返回"未找到城市" | 城市名用英文（`Beijing`）或确认高德 Key；新申请的 Key 需等 10 分钟~2 小时生效 |
| 前端页面空白 / 像被清空 | 先查后端 8000 端口是否在跑（`netstat -ano | findstr :8000`）；前端所有请求经 Vite 代理，后端没起就是 502 |
| 知识库列表报 500 | 历史数据 `created_at` 为空所致，重启后端会自动修复（`init_db` 里已含修复语句） |
| 401 一刷新就掉登录 | token 过期，调大 `.env` 的 `ACCESS_TOKEN_EXPIRE_MINUTES` |

---

## 隐私与数据说明

- 真实密钥只放在 `backend/.env`，**已在 `.gitignore` 中忽略**，不会进入版本库。
- 数据库 `backend/app.db`、用户上传 `backend/uploads/` 同样被忽略，**不会上传到仓库**。
- `frontend/.env`、`*.log`、`node_modules/`、`venv/`、`dist/` 均不参与提交。
- 想清空所有本地数据：删除 `backend/app.db` 与 `backend/uploads/` 即可（重启后端会重新建表）。
- 日历备忘、功能页尺寸等偏好存在**浏览器 localStorage**（不上传服务器，换设备不同步）。

### 开源前自查清单（重要）

推送到公开仓库前，请逐项确认：

1. **`.env` 从未入库**
   ```bash
   git ls-files | grep -i "\.env"      # 只应看到 .env.example
   git log --all --full-history -- backend/.env   # 历史里也应为空
   ```
2. **改掉默认 `SECRET_KEY`**：`python -c "import secrets;print(secrets.token_urlsafe(32))"`，
   否则任何人都能伪造 JWT 登录。
3. **提交邮箱会永久公开**：GitHub 会展示每次提交的 `user.email`。
   不想暴露真实邮箱就用 [GitHub noreply 邮箱](https://docs.github.com/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-email-preferences/setting-your-commit-email-address)：
   ```bash
   git config user.email "<你的ID>+<用户名>@users.noreply.github.com"
   ```
   注意：这**只影响之后的提交**；已推送历史里的邮箱需要用 `git filter-repo` 重写并强推才能清除。
4. **扫描密钥**：`git ls-files -z | xargs -0 grep -nIE "(sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]\s*[\"'][^\"']{8,})"`
5. **确认无个人隐私**：学号 / 姓名 / 手机号等不要写进文档或注释。
