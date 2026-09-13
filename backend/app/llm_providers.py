"""多 API 接入管理：把「接入功能」与「已接入的 API 列表」分开。

数据存 llm_providers 表（每用户可接多个云端 API），与早期单一 CLOUD_* 配置并存：
- 这里管理的是「多个云端 provider」，每个一套独立凭据；
- 本地 Ollama 不算 provider，仍由 config.OLLAMA_* 控制；
- 旧数据（会话 provider_id 为 NULL）仍走 config.CLOUD_* 默认值，完全兼容。

接入前先真实测连（最小化调用），失败把真实原因返回，避免「保存成功、对话才报错」。
网络通路与聊天完全一致（复用 agent_manager 的全局共享 http_client）。
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import LlmProvider, User
from app.schemas import LlmProviderCreate, LlmProviderOut, LlmProviderUpdate

router = APIRouter(prefix="/api/llm-providers", tags=["llm-providers"])


def _mask_key(key: str) -> str:
    """密钥脱敏：只显示首尾，中间打码。"""
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
    return f"{key[:4]}...{key[-4:]}"


def _to_models(text: str | None) -> list[str]:
    """把逗号分隔的模型清单字符串转成 list（去重去空）。"""
    if not text:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for m in text.split(","):
        m = m.strip()
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def _to_out(p: LlmProvider) -> LlmProviderOut:
    """把 ORM 对象转成响应（key 脱敏）。"""
    return LlmProviderOut(
        id=p.id,
        name=p.name,
        base_url=p.base_url,
        model=p.model,
        models=_to_models(p.models),
        masked_key=_mask_key(p.api_key),
        created_at=p.created_at,
    )


def _test_provider(key: str, base_url: str, model: str) -> None:
    """用给定凭据做一次最小化连通性测试；失败抛 HTTPException(400, 真实原因)。

    失败时先触发一次代理自愈（本机代理端口常变），再重试一次——
    这样「直连慢导致超时」这类问题能自动恢复，而不是每次都报连接失败。
    """
    from app.agent_manager import warm_up_cloud
    from app.llm_config import _test_cloud

    try:
        _test_cloud(key, base_url, model)
        return
    except ValueError as first:
        # 可能是代理失效导致直连超时：自愈后重试一次
        try:
            warm_up_cloud()
            _test_cloud(key, base_url, model)
            return
        except ValueError as second:
            raise HTTPException(400, str(second))


@router.get("", response_model=list[LlmProviderOut])
def list_providers(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """列出当前用户已接入的全部云端 API（key 脱敏）。"""
    rows = (
        db.query(LlmProvider)
        .filter(LlmProvider.user_id == current_user.id)
        .order_by(LlmProvider.id.asc())
        .all()
    )
    return [_to_out(p) for p in rows]


@router.post("", response_model=LlmProviderOut)
def create_provider(
    payload: LlmProviderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """接入新 API：先真实测连，通过才入库。"""
    # 重名校验：同一用户下 name 唯一，便于前端下拉区分
    dup = (
        db.query(LlmProvider)
        .filter(LlmProvider.user_id == current_user.id, LlmProvider.name == payload.name.strip())
        .first()
    )
    if dup:
        raise HTTPException(400, f"已存在名为「{payload.name.strip()}」的接入，请换一个名称")

    _test_provider(payload.api_key.strip(), payload.base_url.strip(), payload.model.strip())

    row = LlmProvider(
        user_id=current_user.id,
        name=payload.name.strip(),
        base_url=payload.base_url.strip(),
        api_key=payload.api_key.strip(),
        model=payload.model.strip(),
        models=",".join(m.strip() for m in payload.models if m and m.strip()),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.patch("/{pid}", response_model=LlmProviderOut)
def update_provider(
    pid: int,
    payload: LlmProviderUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """编辑已接入的 API；api_key 留空 = 保持原 Key。改凭据前先测连。"""
    row = (
        db.query(LlmProvider)
        .filter(LlmProvider.id == pid, LlmProvider.user_id == current_user.id)
        .first()
    )
    if not row:
        raise HTTPException(404, "未找到该接入")

    new_name = (payload.name or row.name).strip()
    new_base = (payload.base_url or row.base_url).strip()
    new_model = (payload.model or row.model).strip()
    new_key = (payload.api_key or "").strip() or row.api_key

    if new_name != row.name:
        dup = (
            db.query(LlmProvider)
            .filter(LlmProvider.user_id == current_user.id, LlmProvider.name == new_name)
            .first()
        )
        if dup:
            raise HTTPException(400, f"已存在名为「{new_name}」的接入")

    _test_provider(new_key, new_base, new_model)

    row.name = new_name
    row.base_url = new_base
    row.api_key = new_key
    row.model = new_model
    if payload.models is not None:
        row.models = ",".join(m.strip() for m in payload.models if m and m.strip())
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/{pid}")
def delete_provider(
    pid: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除一个已接入的 API（正在引用它的会话会回落到默认配置，不报错）。"""
    row = (
        db.query(LlmProvider)
        .filter(LlmProvider.id == pid, LlmProvider.user_id == current_user.id)
        .first()
    )
    if not row:
        raise HTTPException(404, "未找到该接入")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/{pid}/test")
def test_provider(
    pid: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """单独测试某个已接入 API 的连通性（用于列表卡片上的「测试」按钮）。"""
    row = (
        db.query(LlmProvider)
        .filter(LlmProvider.id == pid, LlmProvider.user_id == current_user.id)
        .first()
    )
    if not row:
        raise HTTPException(404, "未找到该接入")
    try:
        _test_provider(row.api_key, row.base_url, row.model)
    except HTTPException as e:
        return {"ok": False, "message": e.detail}
    return {"ok": True, "message": f"连接成功（{row.model}）"}
