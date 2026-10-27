"""중량·가격 정규화. src/lib/domain/{weight,pricing}.ts 와 같은 규칙이며
tests/vectors/*.json 공유 벡터를 함께 통과해야 한다."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

WeightStatus = Literal["ok", "missing", "ambiguous", "unsupported_unit"]

_WEIGHT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|킬로그램|킬로|키로|g|그램)(?![a-z])")
_VOLUME_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(ml|㎖|ℓ|l|리터)(?![a-z])")
_AMBIGUOUS_RE = re.compile(r"~|내외|약|±|이상|이하|전후|정도|개당")
_MULT_X_RE = re.compile(r"^\s*(?:x|\*)\s*(\d+)")
_MULT_COUNT_RE = re.compile(r"^\s+(\d+)\s*(?:개|봉지|봉|팩|입|ea|통|망|박스|box|pack)")


@dataclass(frozen=True)
class WeightResult:
    kg: float | None
    status: WeightStatus


def normalize_weight_text(text: str) -> str:
    s = unicodedata.normalize("NFKC", text).lower()
    s = re.sub(r"(\d),(?=\d{3}(?!\d))", r"\1", s)
    return re.sub(r"[×✕✖]", "x", s)


def _round6(n: float) -> float:
    r = round(n * 1e6) / 1e6
    return int(r) if r == int(r) else r


def parse_weight(text: str | None) -> WeightResult:
    """'500g × 2봉' → 1kg. 범위/근사/충돌/부피 단위는 None."""
    if not text or not text.strip():
        return WeightResult(None, "missing")
    s = normalize_weight_text(text)
    tokens = list(_WEIGHT_RE.finditer(s))
    if not tokens:
        return WeightResult(None, "unsupported_unit" if _VOLUME_RE.search(s) else "missing")
    if _AMBIGUOUS_RE.search(s) or _VOLUME_RE.search(s):
        return WeightResult(None, "ambiguous")
    totals: set[float] = set()
    bases: set[float] = set()
    for m in tokens:
        value = float(m.group(1))
        unit = m.group(2)
        base = value / 1000 if unit in ("g", "그램") else value
        rest = s[m.end():]
        mult = _MULT_X_RE.match(rest) or _MULT_COUNT_RE.match(rest)
        count = int(mult.group(1)) if mult else 1
        bases.add(_round6(base))
        totals.add(_round6(base * count))
    if len(bases) > 1 or len(totals) > 1:
        return WeightResult(None, "ambiguous")
    kg = next(iter(totals))
    if not kg > 0:
        return WeightResult(None, "ambiguous")
    return WeightResult(kg, "ok")


@dataclass(frozen=True)
class BestPrice:
    price: int | None
    kind: Literal["regular", "sale", "coupon"] | None
    warnings: tuple[str, ...]


def _valid(p: int | float | None) -> bool:
    return p is not None and p >= 0


def best_price(regular: int | None, sale: int | None, coupon: int | None, coupon_eligible: bool | None) -> BestPrice:
    """정상가·할인가·적용 가능 쿠폰가 중 최솟값. 배송비는 인자로 받지도 않는다(명세 5.2)."""
    warnings: list[str] = []
    candidates: list[tuple[str, int]] = []
    if _valid(regular):
        candidates.append(("regular", regular))  # type: ignore[arg-type]
    if _valid(sale):
        candidates.append(("sale", sale))  # type: ignore[arg-type]
    if _valid(coupon):
        if coupon_eligible is True:
            candidates.append(("coupon", coupon))  # type: ignore[arg-type]
        else:
            warnings.append("coupon_excluded")
    if _valid(regular) and _valid(sale) and sale > regular:  # type: ignore[operator]
        warnings.append("sale_gt_regular")
    if not candidates:
        return BestPrice(None, None, tuple(warnings))
    kind, price = candidates[0]
    for k, p in candidates:
        if p < price:
            kind, price = k, p
    return BestPrice(price, kind, tuple(warnings))  # type: ignore[arg-type]


def unit_price(best: int | None, weight_kg: float | None) -> float | None:
    if best is None or weight_kg is None or not weight_kg > 0:
        return None
    return round(best / weight_kg, 2)


def parse_krw(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value) if value >= 0 else None
    s = re.sub(r"[₩,\s원]", "", str(value))
    if not s or not re.fullmatch(r"\d+(\.\d+)?", s):
        return None
    return int(float(s))


def combine_weight(option_text: str | None, title: str | None) -> tuple[float | None, str | None, list[str]]:
    """옵션(규격) 중량과 상품명 중량을 함께 검증. 충돌·근사 표기는 None + 검토 사유."""
    opt = parse_weight(option_text)
    name = parse_weight(title)
    notes: list[str] = []
    if opt.status == "ok":
        if name.status == "ok" and name.kg != opt.kg:
            notes.append(f"옵션 중량({option_text})과 상품명 중량이 다름")
            return None, option_text, notes
        if name.status in ("ambiguous", "unsupported_unit"):
            notes.append("상품명에 근사/범위 중량 표기가 있어 확인 필요")
            return None, option_text, notes
        return opt.kg, option_text, notes
    if opt.status == "missing" and name.status == "ok":
        return name.kg, option_text or title, notes
    if opt.status in ("ambiguous", "unsupported_unit") or name.status in ("ambiguous", "unsupported_unit"):
        notes.append("중량 표기가 범위/근사값이라 단가 계산 제외")
    else:
        notes.append("중량 정보 없음")
    return None, option_text, notes
