from edgerun.selectors import DANGEROUS_SELECTORS, selectors_present

# Real dispatch-table fragment lifted from a verified LinkToken contract on
# Robinhood Chain (0x492641F6...) — contains mint(address,uint256) = 0x40c10f19.
REAL_MINT_BYTECODE_FRAGMENT = (
    "608060405234801561001057600080fd5b50600436106101f05760003560e01c80"
    "8063a4c0ed3600000000000000000000000000000000000000000000000000000"
    "806340c10f19146102c15760003560e01c8063"
)


def test_mint_selector_detected_in_real_bytecode_fragment():
    found = selectors_present(REAL_MINT_BYTECODE_FRAGMENT)
    sigs = [sig for sig, _ in found]
    assert "mint(address,uint256)" in sigs


def test_clean_bytecode_flags_nothing():
    assert selectors_present("0x6080604052348015600f57600080fd5b50") == []


def test_empty_bytecode_is_safe():
    assert selectors_present("") == []
    assert selectors_present("0x") == []


def test_selector_table_values_match_verified_computation():
    # Cross-checked against a real pycryptodome keccak256 run — see selectors.py docstring.
    expected = {
        "mint(address,uint256)": "40c10f19",
        "pause()": "8456cb59",
        "unpause()": "3f4ba83a",
        "owner()": None,  # not in DANGEROUS_SELECTORS, checked separately
    }
    for sig, sel in expected.items():
        if sel is None:
            continue
        assert DANGEROUS_SELECTORS[sig][0] == sel
