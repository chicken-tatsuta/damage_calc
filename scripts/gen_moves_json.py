# public/scripts/gen_moves_json.py
import csv
import json
from pathlib import Path

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

    # 変化技はここで除外
    if cat_en == "status":
      continue

    # 威力
    raw_power = row.get("いりょく")
    if raw_power in (None, "", "-"):
      power = None
    else:
      try:
        power = int(raw_power)
      except ValueError:
        print("威力変換失敗:", name, raw_power)
        power = None

    # 威力 null / 0 の技は除外
    if power is None or power == 0:
      continue

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

    moves.append(
      {
        "id": name,         # そのまま技名をidにしてる
        "name": name,
        "type": type_en,
        "category": cat_en,
        "power": power,
        "targets": targets,
      }
    )

with OUTPUT_JSON_PATH.open("w", encoding="utf-8") as f:
  json.dump(moves, f, ensure_ascii=False, indent=2)

print("書き出した技の数:", len(moves))
print("出力先:", OUTPUT_JSON_PATH)