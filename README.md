# 智能个人助理系统

基于 LangChain + FastAPI + React 的多用户、多会话 AI 助理 Web 应用。助手具备**工具调用**
（计算器 / 天气 / 待办 / 网页搜索）与**会话记忆**能力，数据持久化到 SQLite。

- 详细开发规格：`docs/`（或工作区根目录下的《开发文档_详细版.md》）
- 环境准备：`安装指南_环境准备.md`

---

## 快速启动

### 1. 后端

```powershell
cd D:\专业实习-IPAS\smart-assistant\backend

# 首次：创建虚拟环境
py -3.13 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 启动（必须在 backend 目录下，因为模块用 app.xxx 绝对导入）
uvicorn app.main:app --reload --port 8000
```

启动后：
- Swagger 接口文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/api/health （会返回当前使用的大模型）

### 2. 前端

```powershell
cd D:\专业实习-IPAS\smart-assistant\frontend
npm install
npm run dev
```

打开 http://localhost:5173 ，注册账号即可开始对话。

> 前端通过 Vite 代理把 `/api` 转发到 `http://localhost:8000`，不需要额外配 CORS。

---

## 大模型配置

编辑 `backend/.env`，**默认已配好本地 Ollama**：

```env
LLM_PROVIDER=ollama          # ollama（本地） / cloud（云端）
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b        # 备选：qwen3:14b（更准）/ qwen3:4b（更快）
OLLAMA_THINK=false           # 关闭思考，响应快 3~5 倍
OLLAMA_NUM_CTX=8192
```

切换到云端只需要两步（代码不动）：

```env
LLM_PROVIDER=cloud
CLOUD_API_KEY=sk-xxxx
CLOUD_BASE_URL=https://open.bigmodel.cn/api/paas/v4/   # 智谱；DeepSeek 填 https://api.deepseek.com
CLOUD_MODEL=glm-4-flash
```

> 本地必须先启动 Ollama 服务（`ollama list` 能列出模型即正常）。

---

## 目录结构

```
smart-assistant/
├── backend/
│   ├── app/
│   │   ├── main.py           入口：CORS + 路由注册 + 启动建表
│   │   ├── config.py         集中配置（LLM provider / JWT / DB / 工具 Key）
│   │   ├── database.py       engine / SessionLocal / Base / get_db / init_db
│   │   ├── models.py         User / Conversation / Message / TodoItem
│   │   ├── schemas.py        Pydantic 请求响应模型
│   │   ├── deps.py           JWT 解析 → 当前用户
│   │   ├── auth.py           注册 / 登录（bcrypt 哈希 + JWT 签发）
│   │   ├── sessions.py       会话 CRUD（含归属校验）
│   │   ├── chat.py           聊天接口（核心）
│   │   ├── agent_manager.py  Agent 工厂 + 会话级缓存
│   │   └── tools.py          计算器 / 天气 / 搜索 / 待办
│   ├── requirements.txt
│   ├── .env.example
│   └── .env                  本地配置（不入库）
├── frontend/
│   ├── src/
│   │   ├── api/              axios 实例 + 接口封装
│   │   ├── components/       Login / ChatContainer / SessionList / ChatWindow / MessageBubble
│   │   ├── types.ts
│   │   └── styles.css
│   ├── package.json
│   └── vite.config.ts        /api 代理到 8000
└── 安装指南_环境准备.md
```

---

## 技术要点（与常见写法不同的地方）

| 点 | 做法 | 原因 |
|----|------|------|
| Agent | `langgraph.prebuilt.create_react_agent` | 旧版 `initialize_agent` 已废弃 |
| 记忆 | `MemorySaver` + `thread_id`（= 会话 id） | 天然实现会话隔离 |
| 本地模型 | `langchain-ollama` 的 `ChatOllama` | 只有 Ollama **原生** `/api/chat` 端点才能让 `think=false` 生效；走 `/v1` 兼容端点关不掉 Qwen3 的思考，回答会被思考内容挤成空 |
| 密码哈希 | 直接用 `bcrypt` | `passlib` 在 Python 3.13 + bcrypt 4.x 下报 `__about__` 错误 |
| 计算器 | `ast` 白名单解析 | 杜绝 `eval` 的任意代码执行风险 |
| 待办 | 工厂函数 `make_todo_tools(user_id)` | 工具绑定用户，实现多用户隔离 |

---

## 功能验收清单

- [ ] 注册 / 登录，错误密码返回 401
- [ ] 新建 / 切换 / 删除会话，会话间上下文互不污染
- [ ] 刷新页面历史消息仍在
- [ ] 输入 `帮我计算 12*15` → 返回 180（计算器工具）
- [ ] 输入 `北京天气怎么样` → 返回天气（需配置 Key）
- [ ] 输入 `添加待办：写课程报告` → `我有哪些待办` → 能看到；换账号看不到
- [ ] 两个用户互相访问对方会话 → 404

---

## 常见问题

| 现象 | 原因 / 解决 |
|------|------------|
| `ModuleNotFoundError: No module named 'app'` | 必须在 `backend/` 目录下用 `uvicorn app.main:app` 启动 |
| 回复内容为空 | Ollama 的 Qwen3 默认开启思考，确认 `.env` 里 `OLLAMA_THINK=false` 且用的是 `ChatOllama`（不是 `/v1` 端点） |
| 启动报 `bcrypt has no attribute '__about__'` | 说明装了 passlib，本项目已不使用，卸载即可：`pip uninstall passlib` |
| 天气返回"未找到城市" | 城市名要用英文（`Beijing`）；新申请的 Key 需等 10 分钟~2 小时生效 |
| 前端跨域报错 | 检查 `vite.config.ts` 的 proxy 是否生效，前端要走 5173 端口访问 |
| 401 一刷新就掉登录 | token 过期，调大 `.env` 的 `ACCESS_TOKEN_EXPIRE_MINUTES` |
