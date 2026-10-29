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
_RANGE_BEFORE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|킬로그램|킬로|키로|g|그램)?\s*~\s*$")
_APPROX_BEFORE_RE = re.compile(r"약\s*$")
_APPROX_AFTER_RE = re.compile(r"^\s*(내외|이상|이하|전후|정도|안팎|\(?\s*±)")
_TOLERANCE_BEFORE_RE = re.compile(r"(±|\+-|\+/-)\s*$")
_PIECE_BEFORE_RE = re.compile(r"(개당|개\s+당|\d+\s*번구)\s*$")
_PIECE_AFTER_RE = re.compile(r"^\s*/\s*개(?![입])")
_MULT_X_RE = re.compile(r"^\s*(?:x|\*)\s*(\d+)")
_MULT_COUNT_RE = re.compile(r"^\s+(\d+)\s*(?:개|봉지|봉|팩|입|ea|통|망|박스|box|pack)")


@dataclass(frozen=True)
class WeightResult:
    kg: float | None
    status: WeightStatus
    approx_range: tuple[float, float] | None = None


def normalize_weight_text(text: str) -> str:
    s = unicodedata.normalize("NFKC", text).lower()
    s = re.sub(r"(\d),(?=\d{3}(?!\d))", r"\1", s)
    return re.sub(r"[×✕✖]", "x", s)


def _round6(n: float) -> float:
    r = round(n * 1e6) / 1e6
    return int(r) if r == int(r) else r


def _to_kg(value: float, unit: str | None) -> float:
    return value / 1000 if unit in ("g", "그램") else value


def parse_weight(text: str | None) -> WeightResult:
    """'500g × 2봉' → 1kg. 알 1개 크기(개당·번구·/개)와 ±오차는 무시, 총중량이 범위/근사/충돌이면 None.
    src/lib/domain/weight.ts 와 같은 규칙."""
    if not text or not text.strip():
        return WeightResult(None, "missing")
    s = normalize_weight_text(text)
    matches = list(_WEIGHT_RE.finditer(s))
    if not matches:
        return WeightResult(None, "unsupported_unit" if _VOLUME_RE.search(s) else "missing")
    if _VOLUME_RE.search(s):
        return WeightResult(None, "ambiguous")
    tokens: list[tuple[float, float, float, bool]] = []  # total, lo, hi, approx
    for m in matches:
        before, after = s[: m.start()], s[m.end():]
        if _TOLERANCE_BEFORE_RE.search(before):
            continue
        if _PIECE_BEFORE_RE.search(before) or _PIECE_AFTER_RE.match(after):
            continue
        unit = m.group(2)
        kg = _to_kg(float(m.group(1)), unit)
        rng = _RANGE_BEFORE_RE.search(before)
        approx = bool(rng) or bool(_APPROX_BEFORE_RE.search(before)) or bool(_APPROX_AFTER_RE.match(after))
        mult = None if approx else (_MULT_X_RE.match(after) or _MULT_COUNT_RE.match(after))
        total = _round6(kg * (int(mult.group(1)) if mult else 1))
        if rng:
            lo = _round6(_to_kg(float(rng.group(1)), rng.group(2) or unit))
            hi = total
        elif approx:
            lo, hi = _round6(total * 0.9), _round6(total * 1.1)
        else:
            lo = hi = total
        tokens.append((total, min(lo, hi), max(lo, hi), approx))
    if not tokens:
        return WeightResult(None, "missing")  # 알 1개 크기·오차 표기뿐, 총중량 정보 없음
    exact = sorted({t[0] for t in tokens if not t[3]})
    approx = [t for t in tokens if t[3]]
    if len(exact) > 1:
        return WeightResult(None, "ambiguous")
    if len(exact) == 1:
        kg = exact[0]
        if not kg > 0:
            return WeightResult(None, "ambiguous")
        if any(t[2] >= kg * 0.5 for t in approx):
            return WeightResult(None, "ambiguous", (min(t[1] for t in approx), max(t[2] for t in approx)))
        return WeightResult(kg, "ok")
    big = [t for t in approx if t[2] > 0]
    if not big:
        return WeightResult(None, "ambiguous")
    return WeightResult(None, "ambiguous", (min(t[1] for t in big), max(t[2] for t in big)))


_PIECE_RE = re.compile(r"(\d+)\s*(개입|구|알|입|개|포기|단|송이)(?![가-힣])")
_PIECE_RANGE_BEFORE_RE = re.compile(r"\d+\s*~\s*$")
_PIECE_APPROX_AFTER_RE = re.compile(r"^\s*(내외|이상|이하|전후|정도|안팎)")
_PIECE_MULT_RE = re.compile(r"^\s*(?:x|\*)\s*(\d+)\s*(?:판|봉|팩|박스|box|망|세트)?")


@dataclass(frozen=True)
class PieceResult:
    count: int | None
    label: str | None
    status: Literal["ok", "missing", "ambiguous"]


def parse_pieces(text: str | None) -> PieceResult:
    """계란 '30구', 배추 '3입' 등 개수. 망·박스·봉·판은 포장 단위라 'N구 x M판' 처럼 곱해질 때만 반영.
    src/lib/domain/pieces.ts 와 같은 규칙."""
    if not text or not text.strip():
        return PieceResult(None, None, "missing")
    s = re.sub(r"[×✕✖]", "x", unicodedata.normalize("NFKC", text).lower())
    found: list[tuple[int, str, bool]] = []
    for m in _PIECE_RE.finditer(s):
        before, after = s[: m.start()], s[m.end():]
        if re.search(r"번\s*$", before):
            continue
        approx = bool(_PIECE_RANGE_BEFORE_RE.search(before)) or bool(_APPROX_BEFORE_RE.search(before)) or bool(_PIECE_APPROX_AFTER_RE.match(after))
        mult = _PIECE_MULT_RE.match(after)
        label = "입" if m.group(2) == "개입" else m.group(2)
        found.append((int(m.group(1)) * (int(mult.group(1)) if mult else 1), label, approx))
    if not found:
        return PieceResult(None, None, "missing")
    if any(f[2] for f in found):
        return PieceResult(None, None, "ambiguous")
    counts = {f[0] for f in found}
    if len(counts) > 1 or not found[0][0] > 0:
        return PieceResult(None, None, "ambiguous")
    return PieceResult(found[0][0], found[0][1], "ok")


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
    """옵션(규격) 중량과 상품명 중량을 함께 검증.
    - 옵션 중량이 정확하고 상품명에 다른 '정확한' 총중량이 있으면 충돌 → None
    - 상품명이 근사/범위 표기(예: '14~15kg내외')이고 그 범위가 옵션 중량을 포함하면 옵션 중량 채택(메모 남김)
    """
    opt = parse_weight(option_text)
    name = parse_weight(title)
    notes: list[str] = []
    if opt.status == "ok":
        if name.status == "ok" and name.kg != opt.kg:
            notes.append(f"옵션 중량({option_text})과 상품명 중량이 다름")
            return None, option_text, notes
        if name.status in ("ambiguous", "unsupported_unit"):
            rng = name.approx_range
            if rng and rng[1] < opt.kg * 0.5:  # type: ignore[operator]
                return opt.kg, option_text, notes  # 훨씬 작은 근사값 = 알 1개 크기 설명
            if rng and rng[0] * 0.9 <= opt.kg <= rng[1] * 1.1:  # type: ignore[operator]
                notes.append(f"상품명은 근사 표기, 옵션 규격 {option_text} 기준")
                return opt.kg, option_text, notes
            notes.append("상품명 중량 표기와 옵션 규격이 맞지 않아 확인 필요")
            return None, option_text, notes
        return opt.kg, option_text, notes
    if opt.status == "missing" and name.status == "ok":
        return name.kg, option_text or title, notes
    if opt.status in ("ambiguous", "unsupported_unit") or name.status in ("ambiguous", "unsupported_unit"):
        notes.append("중량 표기가 범위/근사값이라 단가 계산 제외")
    else:
        notes.append("중량 정보 없음")
    return None, option_text, notes


def combine_pieces(option_text: str | None, title: str | None) -> tuple[int | None, str | None]:
    """옵션 → 상품명 순으로 개수 확인. 둘 다 정확한데 다르면 None."""
    opt, name = parse_pieces(option_text), parse_pieces(title)
    if opt.status == "ok":
        if name.status == "ok" and name.count != opt.count:
            return None, None
        return opt.count, opt.label
    if opt.status == "missing" and name.status == "ok":
        return name.count, name.label
    return None, None
