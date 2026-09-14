#!/usr/bin/env python
"""修复「Windows 智能应用控制(SAC)拦截 uuid_utils 原生扩展导致后端无法启动」的问题。

═══════════════════════════════════════════════════════════════════════════
【问题现象】
    启动后端时在 import 阶段直接崩溃，报：

        ImportError: DLL load failed while importing _uuid_utils:
                     应用程序控制策略已阻止此文件。

    Traceback 的关键路径：
        app.main → app.calendar_api → app.agent_manager
            → langgraph.checkpoint.sqlite
            → langchain_core.runnables.config
            → langchain_core.callbacks.manager
            → langchain_core.utils.uuid
            → uuid_utils.compat

【根本原因】
    uuid_utils 的核心是 Rust 编译的原生扩展 `_uuid_utils.cp313-win_amd64.pyd`，
    它没有代码签名。当 Windows「智能应用控制(Smart App Control)」处于
    **强制拦截(enforce)** 模式时，这类未签名二进制会被策略直接拒绝加载
    （WinError 4551）。

    为什么"昨天还能用"：Windows 上新启用的 SAC 会先经历一段**评估期**
    （只观察、不拦截），评估结束后自动切换到强制拦截。所以故障会
    毫无征兆地出现在某一天。

    而 langchain-core 与 langsmith 都是**硬导入**且没有回退：
        langchain_core/utils/uuid.py : from uuid_utils.compat import uuid7
        langsmith/_internal/_uuid.py : from uuid_utils.compat import uuid7
    所以问题与模型、网络、项目代码全部无关。

【修复原理】
    用纯 Python 实现顶替被打不开的原生扩展：
      1) 把 `_uuid_utils.cp313-win_amd64.pyd` 改名为 `*.pyd.sac-blocked`（文件保留，可还原）
      2) 放入本仓库的 `patches/uuid_utils_pure/_uuid_utils.py` 作为同名模块
      3) `uuid_utils/__init__.py` 与 `compat/__init__.py` 无需改动即可正常工作

    ⚠️ 必须改名而不是只新增 .py：Python 的导入优先级是
       **扩展模块(.pyd) > 源码(.py)**，.pyd 还在的话纯 Python 版本永远轮不到。

【影响】
    uuid_utils 只是一个"更快的 uuid 实现"。本项目仅在 langchain 内部追踪时用到
    uuid7（生成时间有序 ID）。纯 Python 版本功能完全等价，性能差异在此场景下不可感知。

【用法】
    python fix_sac_uuid_utils.py            # 应用修复（推荐先 --check）
    python fix_sac_uuid_utils.py --check    # 只诊断，不改动任何文件
    python fix_sac_uuid_utils.py --restore  # 还原成原生实现（需 SAC 已放行）

【何时需要重新运行】
    只要重新安装了 uuid-utils（例如 `pip install -r requirements.txt`、重建 venv），
    原生 .pyd 就会被装回来、问题复现 —— 此时重跑本脚本即可。
═══════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil
import sys
from pathlib import Path

# 仓库内的纯 Python 实现（唯一真源），随项目一起版本控制
PURE_IMPL = Path(__file__).resolve().parent / "patches" / "uuid_utils_pure" / "_uuid_utils.py"
SUFFIX = ".sac-blocked"


def find_site_packages() -> Path | None:
    """定位当前 Python 环境的 site-packages 目录。"""
    for p in sys.path:
        cand = Path(p) / "uuid_utils"
        if cand.is_dir():
            return cand
    return None


def find_native_pyd(pkg: Path) -> list[Path]:
    """找出 uuid_utils 包内的原生扩展文件（未改名与已改名的都返回）。"""
    return [Path(p) for p in glob.glob(str(pkg / "_uuid_utils*.pyd*"))]


def report(pkg: Path) -> None:
    """打印当前状态。"""
    print(f"  uuid_utils 位置：{pkg}")
    native = list(pkg.glob("_uuid_utils*.pyd"))
    disabled = list(pkg.glob(f"_uuid_utils*.pyd{SUFFIX}"))
    pure = pkg / "_uuid_utils.py"

    print(f"  原生扩展(.pyd)        ：{'存在 ' + native[0].name if native else '不存在'}")
    print(f"  已禁用的原生扩展       ：{'存在 ' + disabled[0].name if disabled else '不存在'}")
    print(f"  纯 Python 实现(_uuid_utils.py)：{'存在' if pure.exists() else '不存在'}")

    if native and not pure.exists():
        print("  → 状态：原生可用（未打补丁）。若启动报「应用程序控制策略已阻止此文件」，请运行本脚本。")
    elif disabled and pure.exists():
        print("  → 状态：✅ 补丁已生效（正在使用纯 Python 实现）")
    elif native and pure.exists():
        print("  → 状态：⚠️ 两者同时存在，.pyd 优先 → 纯 Python 实现不会生效。请运行本脚本修复。")
    else:
        print("  → 状态：❌ 异常，缺少可用的实现。")


def apply_fix(pkg: Path) -> int:
    """应用修复：改名原生扩展 + 安装纯 Python 实现。"""
    if not PURE_IMPL.exists():
        print(f"  ✗ 找不到纯 Python 实现：{PURE_IMPL}")
        return 1

    # 1) 把原生扩展改名，让它不再参与导入
    renamed = 0
    for p in pkg.glob("_uuid_utils*.pyd"):
        target = p.with_name(p.name + SUFFIX)
        shutil.move(str(p), str(target))
        print(f"  ✓ 原生扩展已改名：{p.name} → {target.name}")
        renamed += 1
    if renamed == 0:
        print("  · 没有需要改名的原生扩展（可能已经打过了）")

    # 2) 放入纯 Python 实现（每次都覆盖，保证与仓库版本一致）
    dst = pkg / "_uuid_utils.py"
    shutil.copyfile(PURE_IMPL, dst)
    print(f"  ✓ 已写入纯 Python 实现：{dst}")

    # 3) 清理可能残留的字节码缓存（避免旧的 .pyc 干扰）
    cache = pkg / "__pycache__"
    if cache.is_dir():
        shutil.rmtree(cache, ignore_errors=True)
        print("  ✓ 已清理 __pycache__")
    return 0


def restore(pkg: Path) -> int:
    """还原成原生实现。"""
    n = 0
    for p in pkg.glob(f"_uuid_utils*.pyd{SUFFIX}"):
        target = p.with_name(p.name[: -len(SUFFIX)])
        shutil.move(str(p), str(target))
        print(f"  ✓ 已还原：{target.name}")
        n += 1
    if n == 0:
        print("  · 没有找到已禁用的原生扩展")

    dst = pkg / "_uuid_utils.py"
    if dst.exists():
        dst.unlink()
        print("  ✓ 已移除纯 Python 实现")

    cache = pkg / "__pycache__"
    if cache.is_dir():
        shutil.rmtree(cache, ignore_errors=True)

    print("  ⚠️ 注意：若 SAC 仍在拦截，还原后后端会再次无法启动。")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="修复 SAC 拦截 uuid_utils 导致的后端启动失败")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true", help="只诊断，不改动文件")
    g.add_argument("--restore", action="store_true", help="还原成原生实现")
    args = ap.parse_args()

    pkg = find_site_packages()
    if pkg is None:
        print("✗ 未找到 uuid_utils 包。请确认已激活项目虚拟环境（backend/venv）。")
        return 1

    print("=== 当前状态 ===")
    report(pkg)

    if args.check:
        return 0

    print("\n=== 执行" + ("还原" if args.restore else "修复") + " ===")
    rc = restore(pkg) if args.restore else apply_fix(pkg)

    if rc == 0 and not args.restore:
        print("\n=== 验证 ===")
        try:
            import importlib

            import uuid_utils  # noqa: F401
            importlib.reload(uuid_utils)
            from uuid_utils.compat import uuid7

            u = uuid7()
            print(f"  ✓ uuid7() = {u}  (version={u.version})")
            print("  ✅ 修复成功，现在可以正常启动后端了。")
        except Exception as e:  # pragma: no cover
            print(f"  ✗ 验证失败：{e}")
            return 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
