"""Exit-test logic, proved against synthetic RPC responses.

Live tokens can't prove the FAIL path on demand (you'd need a honeypot to
hand), and a check that has only ever returned "ok" is worthless. These fake
the RPC so every branch is exercised deterministically.
"""
from edgerun.checks.exit_test import (
    BALANCE_OF_SELECTOR,
    decode_revert,
    is_benign,
    run_exit_test,
)
from edgerun.rpc import RpcError


def _error_string(msg: str) -> str:
    """ABI-encode Error(string) exactly as a node returns it."""
    b = msg.encode()
    return (
        "0x08c379a0"
        + f"{32:064x}"
        + f"{len(b):064x}"
        + b.hex().ljust(((len(b) + 31) // 32) * 64, "0")
    )


class FakeBlockscout:
    def __init__(self, holders):
        self._holders = holders

    def token_holders(self, address, limit=10):
        return [{"address": h, "value": "1000"} for h in self._holders][:limit]


class FakeRpc:
    """balances: holder -> int. transfer_reverts: holder -> revert data (or None)."""

    def __init__(self, balances, transfer_reverts=None):
        self.balances = {k.lower(): v for k, v in balances.items()}
        self.transfer_reverts = {k.lower(): v for k, v in (transfer_reverts or {}).items()}

    def eth_call(self, from_address, to, data):
        if data.startswith(BALANCE_OF_SELECTOR):
            holder = "0x" + data[-40:]
            return hex(self.balances.get(holder.lower(), 0))
        revert = self.transfer_reverts.get((from_address or "").lower())
        if revert:
            raise RpcError("execution reverted", revert_data=revert)
        return "0x" + "0" * 63 + "1"


A = "0x" + "a" * 40
B = "0x" + "b" * 40
C = "0x" + "c" * 40


def test_all_transfers_succeed_is_ok():
    r = run_exit_test("0xtok", FakeBlockscout([A, B]), FakeRpc({A: 100, B: 100}))
    assert r.status == "ok"
    assert "2 real holder" in r.detail


def test_all_transfers_blocked_is_fail():
    """The whole point of the check — holders provably cannot move the token."""
    rpc = FakeRpc({A: 100, B: 100}, {A: "0xd93c0665", B: "0xd93c0665"})  # EnforcedPause
    r = run_exit_test("0xtok", FakeBlockscout([A, B]), rpc)
    assert r.status == "fail"
    assert "PAUSED" in r.detail


def test_selective_block_is_warn():
    rpc = FakeRpc({A: 100, B: 100}, {B: _error_string("Blacklisted address")})
    r = run_exit_test("0xtok", FakeBlockscout([A, B]), rpc)
    assert r.status == "warn"
    assert "selective" in r.detail.lower()


def test_stale_cached_balance_is_not_a_restriction():
    """Regression: a live 45-token run accused 1INCH and SHRUB of running a
    'targeted blacklist' when the revert actually said the wallet was empty.
    Blockscout's holder list is cached, so this must never read as a block."""
    rpc = FakeRpc(
        {A: 100, B: 100},
        {B: _error_string("ERC20: transfer amount exceeds balance")},
    )
    r = run_exit_test("0xtok", FakeBlockscout([A, B]), rpc)
    assert r.status == "ok", r.detail


def test_safemath_underflow_is_not_a_restriction():
    rpc = FakeRpc({A: 100}, {A: _error_string("SafeMath: subtraction overflow")})
    r = run_exit_test("0xtok", FakeBlockscout([A]), rpc)
    assert r.status == "unresolved"  # nothing testable left, but NOT a fail


def test_zero_live_balance_holder_is_skipped_not_failed():
    r = run_exit_test("0xtok", FakeBlockscout([A]), FakeRpc({A: 0}))
    assert r.status == "unresolved"
    assert "skipped" in r.detail


def test_revert_without_reason_on_funded_holder_is_a_real_block():
    rpc = FakeRpc({A: 100}, {A: "0x"})
    r = run_exit_test("0xtok", FakeBlockscout([A]), rpc)
    assert r.status == "fail"


def test_decode_revert_known_selectors():
    assert decode_revert("0xd93c0665") == "transfers are PAUSED"
    assert decode_revert("0xffa4e618") == "sender is BLACKLISTED"
    assert "no sell" in decode_revert(_error_string("no sell")).lower()
    assert decode_revert(None) == ""
    assert decode_revert("0x") == ""


def test_benign_classification():
    assert is_benign("0xe450d38c")                                   # ERC20InsufficientBalance
    assert is_benign("0xf4d678b8")                                   # InsufficientBalance()
    assert is_benign(_error_string("ERC20: transfer amount exceeds balance"))
    assert not is_benign("0xd93c0665")                               # paused
    assert not is_benign(_error_string("Blacklisted address"))
    assert not is_benign(None)


def test_burn_sink_and_self_are_not_used_as_holders():
    dead = "0x000000000000000000000000000000000000dEaD"
    r = run_exit_test(dead, FakeBlockscout([dead]), FakeRpc({dead: 100}))
    assert r.status == "unresolved"
