import json
from pathlib import Path

import pytest

from crawler.normalize import combine_pieces, parse_pieces

CASES = json.loads((Path(__file__).parent / "vectors" / "piece_cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["text"] or "<empty>" for c in CASES])
def test_shared_piece_vectors(case):
    r = parse_pieces(case["text"])
    assert (r.status, r.count, r.label) == (case["status"], case["count"], case["label"])


def test_combine_pieces_prefers_option_and_detects_conflict():
    assert combine_pieces("배추 3개입", "★초특가★ 배추(3입,겉잎포함)") == (3, "입")
    assert combine_pieces("EA", "계란 특란 30구") == (30, "구")
    assert combine_pieces("3개입", "배추 4입") == (None, None)
