# public/scripts/gen_moves_json.py
import csv
import json
import re
from pathlib import Path
from typing import Optional

# ----- パス設定（このファイルは public/scripts/ にある想定） -----
ROOT = Path(__file__).resolve().parent.parent  # プロジェクトルート

CSV_PATH = ROOT / "2期生男子種族値 - 技一覧.csv"
POKEMONS_JSON_PATH = ROOT / "src/data/pokemons.json"
OUTPUT_JSON_PATH = ROOT / "src/data/moves.json"

# ----- ポケモン name → id マップ -----
with POKEMONS_JSON_PATH.open(encoding="utf-8") as f:
  pokemons = json.load(f)

name_to_id = {p["name"]: p["id"] for p in pokemons}

# ----- 日本語 → 英語タイプ -----
TYPE_MAP = {
  "ノーマル": "normal",
  "ほのお": "fire",
  "みず": "water",
  "でんき": "electric",
  "くさ": "grass",
  "こおり": "ice",
  "かくとう": "fighting",
  "どく": "poison",
  "じめん": "ground",
  "ひこう": "flying",
  "エスパー": "psychic",
  "むし": "bug",
  "いわ": "rock",
  "ゴースト": "ghost",
  "ドラゴン": "dragon",
  "あく": "dark",
  "はがね": "steel",
  "フェアリー": "fairy",
}

# ----- 日本語ぶんるい → category -----
CATEGORY_MAP = {
  "物理": "physical",
  "特殊": "special",
  "変化": "status",
}

CONTACT_MAP = {
  "接触": True,
  "非接触": False,
}

SELF_STAGE_STAT_MAP = {
  "こうげき": "atk",
  "ぼうぎょ": "def",
  "とくこう": "spa",
  "とくぼう": "spd",
  "すばやさ": "spe",
}

PRIORITY_OVERRIDES = {
  "マッハパンチ": 1,
  "こおりのつぶて": 1,
  "でんこうせっか": 1,
  "バレットパンチ": 1,
  "ジェットパンチ": 1,
  "フェイント": 2,
  "しんそく": 2,
  "まもる": 4,
}

DRAIN_RATIO_OVERRIDES = {
  "ドレインパンチ": 0.5,
  "ギガドレイン": 0.5,
  "メガドレイン": 0.5,
  "ドレインキッス": 0.75,
}

RECOIL_RATIO_OVERRIDES = {
  "とっしん": 0.25,
  "ボルテッカー": 1 / 3,
  "ワイルドボルト": 0.25,
  "すてみタックル": 1 / 3,
  "ブレイブバード": 1 / 3,
  "フレアドライブ": 1 / 3,
}

POWER_OVERRIDES = {
  # 可変威力だが、現状のポケモンデータに重さが無いので暫定値で扱う
  "けたぐり": 100,
}

ALWAYS_CRIT_PHRASE = "必ず急所に当たる"

TARGET_STATUS_MAP = {
  "やけど": "burn",
  "まひ": "paralysis",
}

def parse_multi_hit(effect: Optional[str]):
  if not effect:
    return None

  normalized = re.sub(r"\s+", "", effect)

  progressive_match = re.search(
    r"1ターンに外れるまで最大(\d+)回連続で攻撃する。攻撃が当たる度に威力が(\d+)ずつ増える。",
    normalized,
  )
  if progressive_match:
    return {
      "hitCount": int(progressive_match.group(1)),
      "accuracyPerHit": True,
      "powerStep": int(progressive_match.group(2)),
    }

  range_match = re.search(r"1ターンに(\d+)～(\d+)回連続で攻撃する。", normalized)
  if range_match:
    return {
      "minHits": int(range_match.group(1)),
      "maxHits": int(range_match.group(2)),
    }

  fixed_match = re.search(r"1ターンに(\d+)回連続で攻撃する。", normalized)
  if fixed_match:
    hit_count = int(fixed_match.group(1))
    if hit_count > 1:
      return {
        "hitCount": hit_count,
      }

  return None

def parse_secondary_status_chances(effect: Optional[str]):
  if not effect:
    return None

  normalized = re.sub(r"\s+", "", effect)
  result = {}

  joint_match = re.search(
    r"(\d+)%の確率で相手を『やけど』状態にするか、ひるませる。",
    normalized,
  )
  if joint_match:
    chance = int(joint_match.group(1)) / 100
    return {
      "burnChance": chance,
      "flinchChance": chance,
    }

  burn_match = re.search(r"(\d+)%の確率で相手を『やけど』状態にする。", normalized)
  if burn_match:
    result["burnChance"] = int(burn_match.group(1)) / 100

  flinch_match = re.search(r"(\d+)%の確率で相手をひるませる。", normalized)
  if flinch_match:
    result["flinchChance"] = int(flinch_match.group(1)) / 100

  return result or None

def parse_crit_rank(effect: Optional[str]):
  if not effect:
    return None

  match = re.search(r"急所ランク:\+(\d+)", effect)
  if match:
    return int(match.group(1))

  if ALWAYS_CRIT_PHRASE in effect:
    return 3

  if "急所に当たりやすい" in effect:
    return 1

  return None

def parse_self_stat_changes(effect: Optional[str]):
  if not effect:
    return None

  normalized = re.sub(r"\s+", "", effect)
  if "自分の『" not in normalized:
    return None

  direction = (
    1
    if ("上げる" in normalized or "上がる" in normalized)
    else -1
    if ("下げる" in normalized or "下がる" in normalized)
    else None
  )
  if direction is None:
    return None

  stage_match = re.search(r"(\d+)段階", normalized)
  if not stage_match:
    return None

  stat_names = re.findall(r"『(こうげき|ぼうぎょ|とくこう|とくぼう|すばやさ)』", normalized)
  if not stat_names:
    return None

  delta = int(stage_match.group(1)) * direction
  return {
    "selfStatChanges": {
      SELF_STAGE_STAT_MAP[stat_name]: delta for stat_name in stat_names
    }
  }

def parse_target_status(effect: Optional[str]):
  if not effect:
    return None

  normalized = re.sub(r"\s+", "", effect)
  for status_text, status_value in TARGET_STATUS_MAP.items():
    if f"相手を『{status_text}』状態にする。" in normalized:
      return {
        "targetStatus": status_value,
      }

  return None

def parse_protect(name: str):
  if name == "まもる":
    return {
      "protect": True,
    }

  return None

moves = []

with CSV_PATH.open(encoding="utf-8", newline="") as f:
  reader = csv.DictReader(f)
  for row in reader:
    name = row.get("わざ名")
    if not name:
      continue

    # （古いCSVに「実装済み？」が残ってても動くように一応見る）
    impl = row.get("実装済み？")
    if impl == "未":
      # 新しいCSVにはこの列が無いはずなので、あっても未はスキップ
      continue

    # タイプ
    type_j = row.get("タイプ")
    type_en = TYPE_MAP.get(type_j)
    if not type_en:
      print("タイプ不明:", name, type_j)
      continue

    # ぶんるい
    cat_j = row.get("ぶんるい")
    cat_en = CATEGORY_MAP.get(cat_j)
    if not cat_en:
      print("ぶんるい不明:", name, cat_j)
      continue

    # 威力
    raw_power = row.get("いりょく")
    if cat_en == "status":
      power = 0
    elif raw_power in (None, "", "-"):
      power = POWER_OVERRIDES.get(name)
    else:
      try:
        power = int(raw_power)
      except ValueError:
        print("威力変換失敗:", name, raw_power)
        power = POWER_OVERRIDES.get(name)

    # 威力 null / 0 の攻撃技は除外
    if cat_en != "status" and (power is None or power == 0):
      continue

    # 命中
    raw_accuracy = row.get("めいちゅう")
    if raw_accuracy in (None, "", "-"):
      accuracy = None
    else:
      try:
        accuracy = int(raw_accuracy)
      except ValueError:
        print("命中変換失敗:", name, raw_accuracy)
        accuracy = None

    # 配布対象 → ポケモンid配列
    raw_targets = (row.get("配布対象") or "")
    # 改行や空白を消して「、」区切りに
    raw_targets = raw_targets.replace(" ", "").replace("\t", "").replace("\n", "")
    target_names = [t for t in raw_targets.split("、") if t]

    targets = []
    for tname in target_names:
      pid = name_to_id.get(tname)
      if not pid:
        print("ポケモンid見つからない:", tname, "（技:", name, "）")
        continue
      targets.append(pid)

    move = {
      "id": name,         # そのまま技名をidにしてる
      "name": name,
      "type": type_en,
      "category": cat_en,
      "power": power,
      "accuracy": accuracy,
      "targets": targets,
    }

    contact_raw = row.get("接触/非接触")
    contact = CONTACT_MAP.get(contact_raw)
    if contact is None and contact_raw not in (None, ""):
      print("接触/非接触 不明:", name, contact_raw)
    elif contact is not None:
      move["isContact"] = contact

    priority = PRIORITY_OVERRIDES.get(name)
    if priority is not None:
      move["priority"] = priority

    drain_ratio = DRAIN_RATIO_OVERRIDES.get(name)
    if drain_ratio is not None:
      move["drainRatio"] = drain_ratio

    recoil_ratio = RECOIL_RATIO_OVERRIDES.get(name)
    if recoil_ratio is not None:
      move["recoilRatio"] = recoil_ratio

    crit_rank = parse_crit_rank(row.get("効果"))
    if crit_rank is not None:
      move["critRank"] = crit_rank

    multi_hit = parse_multi_hit(row.get("効果"))
    if multi_hit is not None:
      move.update(multi_hit)

    secondary_status_chances = parse_secondary_status_chances(row.get("効果"))
    if secondary_status_chances is not None:
      move.update(secondary_status_chances)

    self_stat_changes = parse_self_stat_changes(row.get("効果"))
    if self_stat_changes is not None:
      move.update(self_stat_changes)

    target_status = parse_target_status(row.get("効果"))
    if target_status is not None:
      move.update(target_status)

    protect = parse_protect(name)
    if protect is not None:
      move.update(protect)

    moves.append(move)

with OUTPUT_JSON_PATH.open("w", encoding="utf-8") as f:
  json.dump(moves, f, ensure_ascii=False, indent=2)

print("書き出した技の数:", len(moves))
print("出力先:", OUTPUT_JSON_PATH)
