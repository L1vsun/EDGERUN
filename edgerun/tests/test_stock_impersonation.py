"""Stock-token authenticity.

The claims this check makes are the strongest in the tool - "this is not the
real Tesla" - so the cases that must NOT fire are as important as the ones
that must. A false accusation against a legitimate meme token would be worse
than missing a fake.
"""
import pytest

from edgerun.checks.stock_impersonation import run_stock_check
from edgerun.stock_registry import StockRegistry, normalize_name

OFFICIAL_TSLA = "0x322f0929c4625ed5bad873c95208d54e1c003b2d"
FAKE = "0x066ad1c8bf4edf5482d6994f18c27216e597f81a"


class FakeRpc:
    def __init__(self, has_multiplier=False):
        self.has_multiplier = has_multiplier

    def eth_call(self, from_address, to, data):
        if self.has_multiplier:
            return "0x" + "0" * 47 + "de0b6b3a7640000"
        from edgerun.rpc import RpcError
        raise RpcError("execution reverted", revert_data="0x")


@pytest.fixture
def registry(monkeypatch):
    reg = StockRegistry()
    reg._by_ticker = {
        "TSLA": {"ticker": "TSLA", "name": "Tesla • Robinhood Token",
                 "address": OFFICIAL_TSLA, "status": "ASSET_STATUS_ACTIVE", "multiplier": "1"},
    }
    reg._by_address = {OFFICIAL_TSLA: reg._by_ticker["TSLA"]}
    reg._fetched_at = 1e12  # far future: never refetch during tests
    monkeypatch.setattr("edgerun.checks.stock_impersonation.REGISTRY", reg)
    return reg


def test_official_address_is_verified(registry):
    r = run_stock_check(OFFICIAL_TSLA, "TSLA", "Tesla • Robinhood Token", FakeRpc())
    assert r.status == "ok"
    assert "VERIFIED" in r.detail


def test_official_ticker_at_wrong_address_is_fail(registry):
    """The headline case: a structurally clean ERC-20 that simply isn't Tesla."""
    r = run_stock_check(FAKE, "TSLA", "Tesla • Robinhood Token", FakeRpc())
    assert r.status == "fail"
    assert OFFICIAL_TSLA[:8] in r.detail.replace("…", "")[:200] or "0x322f09" in r.detail
    assert "NOT it" in r.detail


def test_forged_branding_without_official_ticker_is_fail(registry):
    """No official ticker, but wears '• Robinhood Token' - still a false claim."""
    r = run_stock_check(FAKE, "WOOF", "Doge • Robinhood Token", FakeRpc())
    assert r.status == "fail"
    assert "branding" in r.detail


def test_ordinary_token_returns_nothing(registry):
    """No claim on an official asset must produce no check at all - silence,
    not a reassuring green line that would dilute the real ones."""
    assert run_stock_check(FAKE, "HOODRAT", "Hoodrat", FakeRpc()) is None


def test_ui_multiplier_on_unregistered_token_is_only_a_warning(registry):
    r = run_stock_check(FAKE, "WOOF", "Woof Coin", FakeRpc(has_multiplier=True))
    assert r.status == "warn"
    assert "not in the official registry" in r.detail


def test_unreachable_registry_never_reads_as_authentic(monkeypatch):
    reg = StockRegistry(url="http://127.0.0.1:9/nope", timeout=0.01)
    monkeypatch.setattr("edgerun.checks.stock_impersonation.REGISTRY", reg)
    r = run_stock_check(FAKE, "TSLA", "Tesla • Robinhood Token", FakeRpc())
    assert r.status == "unresolved"
    assert "cannot confirm or deny" in r.detail


def test_case_and_bullet_insensitive_branding():
    assert normalize_name("Tesla • Robinhood Token") == "tesla robinhood token"
    assert normalize_name("TESLA - robinhood  token") == "tesla robinhood token"
    assert normalize_name("Tesla | Robinhood Token") == "tesla robinhood token"


def test_lowercase_ticker_still_matches(registry):
    r = run_stock_check(FAKE, "tsla", "whatever", FakeRpc())
    assert r.status == "fail"
