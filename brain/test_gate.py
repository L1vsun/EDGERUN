"""Fast tests for the pipeline's pure logic (no simulation, no data files)."""
from run import HZ_MAX, gate, sense

PASS = {"verdict": "PASS", "symbol": "OK", "failed_checks": []}
FAIL = {"verdict": "FAIL", "symbol": "FAKE", "failed_checks": ["impersonation_ticker"]}
CAUTION = {"verdict": "CAUTION", "symbol": "HM", "failed_checks": []}
BRAIN = {"active_neurons": 8000}
CTRL = {"active_neurons": 300}


def test_sense_maps_verdicts_to_valence_channels_and_caps_rate():
    assert sense([PASS] * 2 + [FAIL]) == {"sweet": 80, "bitter": 40}
    assert sense([PASS] * 10)["sweet"] == HZ_MAX
    assert sense([CAUTION]) == {}          # unresolved stays silent, never sweet
    assert sense([]) == {}


def test_gate_defaults_to_silence():
    assert gate([], BRAIN, CTRL)["action"] == "SILENCE"
    assert gate([PASS, PASS, CAUTION], BRAIN, CTRL)["action"] == "SILENCE"


def test_gate_alerts_on_failed_scan_and_brain_has_no_weight():
    g = gate([PASS, FAIL], BRAIN, CTRL)
    assert g["action"] == "ALERT" and "FAKE" in g["because"][0]
    quiet = gate([PASS, FAIL], {"active_neurons": 0}, CTRL)
    assert quiet["action"] == g["action"] and g["brain_weight"] == 0
