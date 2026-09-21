"""Exit test: can holders actually move this token, right now?

Every other check in this tool - and in every comparable tool on this chain -
is static: does the bytecode contain a `pause()` selector, is the source
verified, is ownership renounced. Static analysis answers "does a mechanism
exist". It cannot answer "is it switched on".

This check answers that by executing the transfer. `eth_call` runs a real
transfer against current chain state without broadcasting anything, costing
nothing and signing nothing. If a genuine holder's transfer reverts, holders
cannot sell - whatever the bytecode looks like.

Verified against Robinhood Chain 2026-09-09:
  - real holder, 1 token   -> 0x...01 (true), the transfer would succeed
  - empty wallet, 1 token  -> reverts ERC20InsufficientBalance (0xe450d38c)
so a revert is distinguishable from a *restricted* revert by its error data.

Limits, stated plainly (see docs/checks.md):
  - This is a transfer test, not a DEX sell test. It proves tokens can move
    between wallets. A pool with no liquidity, or a router-level tax, is a
    different failure this does not see.
  - It reflects state at scan time. That is exactly why the watchtower
    re-runs it - see watch.py.
"""
from __future__ import annotations

from ..blockscout import BlockscoutClient, BlockscoutError
from ..models import CheckResult
from ..rpc import RpcClient, RpcError

TRANSFER_SELECTOR = "0xa9059cbb"  # transfer(address,uint256)
BALANCE_OF_SELECTOR = "0x70a08231"  # balanceOf(address)
BURN_SINK = "0x000000000000000000000000000000000000dEaD"

# Revert selectors we can name. Anything unrecognised is reported as-is
# rather than guessed at.
KNOWN_REVERTS: dict[str, str] = {
    "e450d38c": "insufficient balance",          # ERC20InsufficientBalance (OZ v5)
    "f4d678b8": "insufficient balance",          # InsufficientBalance() - verified selector
    "ec442f05": "receiver rejected",             # ERC20InvalidReceiver
    "96c6fd1e": "sender rejected",               # ERC20InvalidSender
    "d93c0665": "transfers are PAUSED",          # EnforcedPause
    "55697f8b": "transfers are PAUSED",          # ERC20Paused
    "ffa4e618": "sender is BLACKLISTED",         # Blacklisted(address)
    "12f1f923": "trading not enabled yet",       # TradingNotEnabled
    "a24e573d": "transfers disabled",            # TransferDisabled
}

# A revert that means "this wallet can't move tokens", as opposed to a benign
# balance problem, is the honeypot signal.
BENIGN_REVERTS = {"e450d38c", "f4d678b8"}

# Same thing expressed as a require() string. Blockscout's holder list is a
# cached snapshot, so a listed holder may already have moved their tokens -
# every one of these means "this wallet is empty", never "this wallet is
# blocked". Treating them as restrictions produced false blacklist accusations
# against legitimate tokens (1INCH, SHRUB) in a live 45-token run.
BENIGN_REVERT_TEXT = (
    "exceeds balance",
    "insufficient balance",
    "subtraction overflow",   # SafeMath underflow == not enough balance
    "underflow",
    "transfer amount exceeds",
    "not enough",
)


def _encode_transfer(to: str, amount_wei: int) -> str:
    to_word = to.lower().removeprefix("0x").rjust(64, "0")
    amt_word = f"{amount_wei:064x}"
    return f"{TRANSFER_SELECTOR}{to_word}{amt_word}"


def decode_revert(data: str | None) -> str:
    """Turn revert data into a human reason. Returns '' when unknown."""
    if not data or data == "0x":
        return ""
    raw = data.lower().removeprefix("0x")
    selector = raw[:8]

    if selector in KNOWN_REVERTS:
        return KNOWN_REVERTS[selector]

    # Error(string) - the classic require("...") message
    if selector == "08c379a0":
        try:
            body = bytes.fromhex(raw[8:])
            length = int.from_bytes(body[32:64], "big")
            text = body[64 : 64 + length].decode("utf-8", errors="replace").strip()
            return f'reverted: "{text}"' if text else ""
        except (ValueError, IndexError):
            return ""

    return f"reverted with unrecognised error 0x{selector}"


def is_benign(data: str | None) -> bool:
    """True when a revert means 'this wallet has no tokens', not 'this wallet
    is restricted'. Checks the custom-error selector and the require() text."""
    if not data:
        return False
    if data.lower().removeprefix("0x")[:8] in BENIGN_REVERTS:
        return True
    reason = decode_revert(data).lower()
    return any(t in reason for t in BENIGN_REVERT_TEXT)


def _live_balance(rpc: RpcClient, token: str, holder: str) -> int:
    """Read the holder's balance from chain state, not from the cached list."""
    word = holder.lower().removeprefix("0x").rjust(64, "0")
    raw = rpc.eth_call(None, token, f"{BALANCE_OF_SELECTOR}{word}")
    if not raw or raw == "0x":
        return 0
    return int(raw, 16)


def run_exit_test(
    address: str, bs: BlockscoutClient, rpc: RpcClient, max_holders: int = 3
) -> CheckResult:
    """Simulate a small transfer from each of the top holders.

    Uses real holders rather than a synthetic funded account so the result
    reflects what an actual holder of this token would experience.
    """
    try:
        holders = bs.token_holders(address, limit=max_holders)
    except BlockscoutError as exc:
        return CheckResult(
            "exit_test", "exit test", "unresolved",
            f"cannot list holders to simulate a transfer from: {exc}",
        )

    # Skip the burn sink and the contract itself - neither represents a holder
    # who might want to sell.
    candidates = [
        h for h in holders
        if h["address"].lower() not in {BURN_SINK.lower(), address.lower()}
        and int(h["value"] or 0) > 0
    ]

    if not candidates:
        return CheckResult(
            "exit_test", "exit test", "unresolved",
            "no holder with a non-zero balance to simulate a transfer from",
        )

    passed, blocked, skipped = [], [], 0
    for h in candidates:
        # Confirm the holder still holds something, at this block. Without
        # this, a stale cached balance makes a normal "you have no tokens"
        # revert look like a restriction.
        try:
            if _live_balance(rpc, address, h["address"]) == 0:
                skipped += 1
                continue
        except RpcError:
            skipped += 1
            continue

        # 1 wei of the token: the smallest amount that still runs the full
        # transfer path, and guaranteed to be within a non-zero balance.
        data = _encode_transfer(BURN_SINK, 1)
        try:
            rpc.eth_call(h["address"], address, data)
            passed.append(h["address"])
        except RpcError as exc:
            revert = getattr(exc, "revert_data", None)
            if is_benign(revert):
                skipped += 1  # still a balance issue despite the live read
                continue
            blocked.append((h["address"], decode_revert(revert) or "reverted, no reason given"))

    if not passed and not blocked:
        return CheckResult(
            "exit_test", "exit test", "unresolved",
            f"no holder with a live non-zero balance to test ({skipped} skipped) - inconclusive",
        )

    if blocked and not passed:
        who, reason = blocked[0]
        return CheckResult(
            "exit_test", "exit test", "fail",
            f"simulated transfer FAILED for all {len(blocked)} holder(s) tested - "
            f"{reason}. Holders cannot move this token right now.",
        )

    if blocked:
        who, reason = blocked[0]
        return CheckResult(
            "exit_test", "exit test", "warn",
            f"simulated transfer succeeded for {len(passed)} holder(s) but FAILED for "
            f"{len(blocked)} ({who[:10]}… - {reason}) - selective restriction, "
            "the signature of a targeted blacklist",
        )

    return CheckResult(
        "exit_test", "exit test", "ok",
        f"simulated transfer succeeded from {len(passed)} real holder(s) - tokens "
        "are movable at this block (transfer test, not a DEX sell test)",
    )
