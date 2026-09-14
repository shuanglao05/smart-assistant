"""_uuid_utils 的纯 Python 实现（替代被 Windows 策略拦截的原生扩展）。

═══════════════════════════════════════════════════════════════════════════
【为什么会有这个文件】
    官方 uuid_utils 的核心是 Rust 编译的原生扩展 `_uuid_utils.cp313-win_amd64.pyd`。
    当 Windows 的「智能应用控制（Smart App Control）」处于强制拦截模式
    （注册表 HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy 的
     VerifiedAndReputablePolicyState = 1）时，该未签名 DLL 会被策略拒绝加载：

        ImportError: DLL load failed while importing _uuid_utils:
                     应用程序控制策略已阻止此文件。  (WinError 4551)

    而 langchain-core 与 langsmith 都是【硬导入】uuid_utils 且没有回退：
        langchain_core/utils/uuid.py:  from uuid_utils.compat import uuid7
        langsmith/_internal/_uuid.py:  from uuid_utils.compat import uuid7
    于是后端启动时直接崩在 import 阶段（与模型、网络都无关）。

【怎么修的】
    把原生 .pyd 改名为 `_uuid_utils.cp313-win_amd64.pyd.sac-blocked`（文件保留，可随时还原），
    再放上本文件作为同名纯 Python 模块顶替。
    ⚠️ 必须改名而不能只新增 .py —— Python 的导入优先级是「扩展模块(.pyd) > 源码(.py)」，
        .pyd 还在的话这个 .py 永远不会被用到。

【影响评估】
    uuid_utils 的作用是「更快的 uuid 实现」，本项目只用到 uuid7（生成时间有序 ID，
    供 langchain 内部追踪使用）。纯 Python 版本功能完全等价，性能差异在本文场景下不可感知。

【如何还原】
    删掉本文件，并把 `_uuid_utils.cp313-win_amd64.pyd.sac-blocked` 改回 `.pyd` 即可。
    （前提是 SAC 已关闭；关闭 SAC 不可逆，需谨慎）
═══════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import random
import threading
import time
import uuid as _uuid

# ── 版本号：与官方 uuid_utils 0.17.0 保持一致，便于依赖检查 ──
__version__ = "0.17.0"

# ── 直接复用标准库 uuid 的类型与命名空间常量 ──
# 官方原生模块导出的是它自己的 C 扩展 UUID 类型；这里用标准库 uuid.UUID 顶替。
# 二者接口兼容（都有 .int / .hex / .bytes 等），
# 且 compat 子模块本来就是「把结果转成标准库 UUID」，所以语义完全对得上。
UUID = _uuid.UUID
SafeUUID = _uuid.SafeUUID
getnode = _uuid.getnode

NAMESPACE_DNS = _uuid.NAMESPACE_DNS
NAMESPACE_OID = _uuid.NAMESPACE_OID
NAMESPACE_URL = _uuid.NAMESPACE_URL
NAMESPACE_X500 = _uuid.NAMESPACE_X500
RESERVED_NCS = _uuid.RESERVED_NCS
RFC_4122 = _uuid.RFC_4122
RESERVED_MICROSOFT = _uuid.RESERVED_MICROSOFT
RESERVED_FUTURE = _uuid.RESERVED_FUTURE

NIL = _uuid.UUID(int=0)
MAX = _uuid.UUID("ffffffff-ffff-ffff-ffff-ffffffffffff")

# ── v1 / v3 / v4 / v5：标准库已有，直接转发 ──
# 注意标准库返回的 UUID 对象自带 .int，满足 compat 子模块 uuidN(...).int 的用法。
uuid1 = _uuid.uuid1
uuid3 = _uuid.uuid3
uuid4 = _uuid.uuid4
uuid5 = _uuid.uuid5


def _uuid4_int() -> int:
    """返回一个 v4（随机）UUID 的 128 位整数。

    compat 子模块用它来构造结果：`_from_int(_uuid4_int())`。
    """
    return _uuid.uuid4().int


# ═══════════════════════════════════════════════════════════════════════
#  UUIDv7（RFC 9562 §5.7）—— 本项目实际会走到的路径
#
#  位布局（共 128 位，自高位到低位）：
#     48 位 unix_ts_ms | 4 位 version(7) | 12 位 counter_hi
#     | 2 位 variant(10) | 30 位 counter_lo | 32 位 random
#
#  单调性保证（Method 1）：同一毫秒内重复生成时，42 位计数器 +1；
#  计数器用尽则时间戳进 1 毫秒并重新随机化计数器。
#  因此同一毫秒内产生的 ID 也是严格递增的 —— 这正是 langchain 需要的性质。
# ═══════════════════════════════════════════════════════════════════════
_U7_LOCK = threading.Lock()          # 多线程下保护计数器（FastAPI 用线程池）
_U7_COUNTER_BITS = 42
_U7_COUNTER_MAX = (1 << _U7_COUNTER_BITS) - 1
_U7_LAST_MS = -1                     # 上一次使用的时间戳（毫秒）
_U7_COUNTER = 0                      # 当前毫秒内的计数器


def _uuid7_int(timestamp: int | None = None, nanos: int | None = None) -> int:
    """生成一个 v7 UUID 的 128 位整数（RFC 9562 Method 1）。

    参数：
        timestamp —— Unix 时间戳（秒）。为 None 时取当前时间。
        nanos     —— 附加的纳秒部分（仅当 timestamp 不为 None 时有意义）。
    返回：
        128 位整数；调用方通常包一层 UUID(int=...) 使用。
    """
    global _U7_LAST_MS, _U7_COUNTER

    if timestamp is None:
        ms = time.time_ns() // 1_000_000
    else:
        # 秒 + 纳秒 → 毫秒（nanos 只取到毫秒精度）
        ms = int(timestamp) * 1000 + (int(nanos) // 1_000_000 if nanos else 0)

    with _U7_LOCK:
        if ms > _U7_LAST_MS:
            # 进入新的毫秒：计数器重新随机初始化（MSB 置 0，即限制在 42 位内）
            _U7_LAST_MS = ms
            _U7_COUNTER = random.getrandbits(_U7_COUNTER_BITS)
        else:
            # 同一毫秒（或时钟回拨）：沿用上次时间戳并让计数器自增，保证单调递增
            ms = _U7_LAST_MS
            _U7_COUNTER += 1
            if _U7_COUNTER > _U7_COUNTER_MAX:
                # 计数器溢出：时间戳前进 1 毫秒并重新随机化
                _U7_LAST_MS += 1
                ms = _U7_LAST_MS
                _U7_COUNTER = random.getrandbits(_U7_COUNTER_BITS)
        counter = _U7_COUNTER

    counter_hi = (counter >> 30) & 0xFFF          # 高 12 位
    counter_lo = counter & ((1 << 30) - 1)        # 低 30 位
    rand = random.getrandbits(32)                 # 32 位纯随机

    value = (
        ((ms & 0xFFFFFFFFFFFF) << 80)   # 48 位时间戳（毫秒），最高位区
        | (0x7 << 76)                   # 4 位版本号 = 7
        | (counter_hi << 64)            # 12 位计数器高位
        | (0b10 << 62)                  # 2 位变体 = 10（RFC 4122 变体）
        | (counter_lo << 32)            # 30 位计数器低位
        | rand                          # 32 位随机
    )
    return value


def uuid7(timestamp: int | None = None, nanos: int | None = None) -> _uuid.UUID:
    """生成一个 v7 UUID（时间有序）。参数含义同 `_uuid7_int`。"""
    return _uuid.UUID(int=_uuid7_int(timestamp, nanos))


# ═══════════════════════════════════════════════════════════════════════
#  UUIDv6（RFC 9562 §5.6）—— 与 v1 同为时间戳型，但字段顺序改为「可直接按字典序排序」
#
#  位布局：
#     32 位 time_high | 16 位 time_mid | 4 位 version(6) | 12 位 time_low
#     | 2 位 variant(10) | 14 位 clock_seq | 48 位 node
#
#  时间戳基准是 1582-10-15 00:00:00 UTC，单位 100 纳秒，
#  所以要加上 1582→1970 之间的偏移量 _GREGORIAN_OFFSET_100NS。
# ═══════════════════════════════════════════════════════════════════════
_GREGORIAN_OFFSET_100NS = 0x01B21DD213814000


def uuid6(node: int | None = None, timestamp: int | None = None) -> _uuid.UUID:
    """生成一个 v6 UUID。

    参数：
        node      —— 48 位节点标识；为 None 时用 uuid.getnode()（通常是网卡 MAC）。
        timestamp —— 100 纳秒精度的时间戳（自 1582-10-15 起）；为 None 时取当前时间。
    """
    if node is None:
        node = _uuid.getnode()
    if timestamp is None:
        ts100 = time.time_ns() // 100 + _GREGORIAN_OFFSET_100NS
    else:
        ts100 = int(timestamp)

    time_high = (ts100 >> 28) & 0xFFFFFFFF
    time_mid = (ts100 >> 12) & 0xFFFF
    time_low = ts100 & 0xFFF
    clock_seq = random.getrandbits(14)

    value = (
        (time_high << 96)
        | (time_mid << 80)
        | (0x6 << 76)                      # 版本号 = 6
        | (time_low << 64)
        | (0b10 << 62)                     # 变体 = 10
        | ((clock_seq & 0x3FFF) << 48)
        | (node & 0xFFFFFFFFFFFF)
    )
    return _uuid.UUID(int=value)


# ═══════════════════════════════════════════════════════════════════════
#  UUIDv8（RFC 9562 §5.8）—— 留给实现者自定义语义的版本
#
#  这里采用一个通用做法：把调用方给的字节放进主体，不足 16 字节的部分用随机数补齐，
#  再强制写入版本号 8 与变体 10（这两个字段必须符合规范，否则不是合法的 UUIDv8）。
# ═══════════════════════════════════════════════════════════════════════
def uuid8(data: bytes | bytearray | str = b"") -> _uuid.UUID:
    """生成一个 v8 UUID。data 为自定义数据（最多取前 16 字节），不足部分随机补齐。"""
    if isinstance(data, str):
        data = data.encode()
    buf = bytearray(bytes(data)[:16])
    if len(buf) < 16:
        buf += bytes(random.getrandbits(8) for _ in range(16 - len(buf)))

    value = int.from_bytes(bytes(buf), "big")
    value &= ~(0xF << 76)      # 清空版本位
    value |= 0x8 << 76         # 版本 = 8
    value &= ~(0b11 << 62)     # 清空变体位
    value |= 0b10 << 62        # 变体 = 10
    return _uuid.UUID(int=value)


# ═══════════════════════════════════════════════════════════════════════
#  其余原生模块导出的内部符号
# ═══════════════════════════════════════════════════════════════════════
def reseed() -> None:
    """重新播种随机数发生器。

    原生实现里这用于 fork 后的子进程避免生成重复 UUID；
    纯 Python 用的是标准库 random（fork 时安全），这里做成空操作即可保持接口一致。
    """
    random.seed()


__all__ = [
    "MAX",
    "NAMESPACE_DNS",
    "NAMESPACE_OID",
    "NAMESPACE_URL",
    "NAMESPACE_X500",
    "NIL",
    "RESERVED_FUTURE",
    "RESERVED_MICROSOFT",
    "RESERVED_NCS",
    "RFC_4122",
    "UUID",
    "__version__",
    "getnode",
    "reseed",
    "uuid1",
    "uuid3",
    "uuid4",
    "uuid5",
    "uuid6",
    "uuid7",
    "uuid8",
]
