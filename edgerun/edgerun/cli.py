from __future__ import annotations

import time

import click

from .blockscout import BlockscoutClient, BlockscoutError
from .config import load_config
from .models import ScanResult
from .scan import scan_address

STATUS_ICON = {"ok": "ok  ", "warn": "warn", "fail": "fail", "unresolved": "??  "}


def _print_scan(result: ScanResult) -> None:
    short = f"{result.address[:6]}...{result.address[-4:]}"
    click.echo(f"\n  edgerun  {short}  scanned just now\n")

    click.echo("  contract")
    for c in result.contract.checks:
        click.echo(f"    {STATUS_ICON[c.status]}  {c.detail}")

    click.echo("\n  impersonation")
    imp_checks = [c for c in result.impersonation.checks]
    flagged = any(c.status == "fail" for c in imp_checks)
    for c in imp_checks:
        click.echo(f"    {STATUS_ICON[c.status]}  {c.detail}")
    if flagged:
        for m in result.impersonation.nearest_matches[:1]:
            click.echo(f"    ref   closest known match: {m.ticker} ({m.contract[:6]}...) - not the same contract")

    click.echo(f"\n  verdict: {result.verdict}")
    click.echo(f"  facts checked: {result.facts_checked} · unresolved: {result.unresolved} "
               f"· view on blockscout: {result.blockscout_url}\n")
    click.echo("  Not financial advice. Verification only - read the linked page yourself.\n")


@click.group()
def main() -> None:
    """edgerun - contract safety + impersonation checker for Robinhood Chain."""


@main.command()
@click.argument("address")
@click.option("--config", "config_path", default=None, help="Path to known_tokens.json")
def scan(address: str, config_path: str | None) -> None:
    """Run both lanes once on ADDRESS."""
    cfg = load_config(config_path)
    try:
        result = scan_address(address, cfg)
    except ValueError as exc:
        raise click.ClickException(str(exc))
    _print_scan(result)
    raise SystemExit({"PASS": 0, "CAUTION": 1, "FAIL": 2}[result.verdict])


@main.command()
@click.option("--config", "config_path", default=None, help="Path to known_tokens.json")
@click.option("--poll", default=45, help="Seconds between polls")
def watch(config_path: str | None, poll: int) -> None:
    """Poll new deployments on Robinhood Chain and scan each on arrival."""
    cfg = load_config(config_path)
    seen: set[str] = set()
    click.echo(f"\n  watching robinhood chain · poll every {poll}s\n")

    with BlockscoutClient(cfg.explorer_base) as bs:
        while True:
            try:
                items = bs.newest_smart_contracts(limit=25)
            except BlockscoutError as exc:
                click.echo(f"  [poll error] {exc}")
                items = []

            for item in items:
                addr = (item.get("address") or {}).get("hash")
                if not addr or addr in seen:
                    continue
                seen.add(addr)
                try:
                    result = scan_address(addr, cfg)
                except Exception as exc:  # keep the poll loop alive
                    click.echo(f"  {time.strftime('%H:%M:%S')}  {addr[:6]}...  scan failed: {exc}")
                    continue
                ticker = result.token_symbol or "(no ticker)"
                click.echo(
                    f"  {time.strftime('%H:%M:%S')}  {addr[:6]}...  {ticker:14s} verdict: {result.verdict}"
                )

            time.sleep(poll)


@main.command("verify-config")
@click.option("--config", "config_path", default=None, help="Path to known_tokens.json")
def verify_config(config_path: str | None) -> None:
    """Check known_tokens.json and thresholds without scanning anything."""
    cfg = load_config(config_path)
    click.echo(f"  config: {cfg.path}")
    click.echo(f"  explorer base: {cfg.explorer_base}")
    click.echo(f"  rpc url: {cfg.rpc_url}")
    click.echo(f"  chain id: {cfg.chain_id}")
    click.echo(f"  max_edit_distance_flag: {cfg.thresholds.max_edit_distance_flag}")
    click.echo(f"  lp_lock_warn_days_remaining: {cfg.thresholds.lp_lock_warn_days_remaining}")
    click.echo(f"  reference tokens: {len(cfg.reference_tokens)}")
    for t in cfg.reference_tokens:
        click.echo(f"    {t.ticker:10s} {t.name:20s} {t.contract}")
    if not cfg.dex_factory_address:
        click.echo("  dex.factory_address: not set - LP lock checks will report unresolved")


@main.command()
def explain() -> None:
    """Print what each check does and what it needs to resolve."""
    click.echo("""
  contract lane
    source_verified  GET /api/v2/addresses/{address} -> is_verified
    supply_mint       bytecode selector scan for mint(address,uint256) (+ source regex when
                       verified); needs deployed bytecode, unresolved if neither source nor
                       eth_getCode is reachable
    ownership         eth_call owner() over RPC, cross-checked against a bytecode scan for
                       pause/blacklist/setFee-style selectors; unresolved if owner() reverts
                       and no dangerous selectors are found either
    lp_lock           unresolved until dex.factory_address is set in known_tokens.json

  impersonation lane
    ticker/name        Levenshtein edit distance against every entry in known_tokens.json;
                        unresolved if the reference list is empty or the address has no
                        token metadata
""")
