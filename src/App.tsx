// src/App.tsx
import { useState, useEffect, useMemo } from "react";
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Container,
  CssBaseline,
  ThemeProvider,
  Typography,
  createTheme,
  Slider,
  TextField,
  Stack,
  Autocomplete,
  MenuItem,
  Chip,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import { calcDamage, getKOChance } from "./lib/damage";
import { calcAllStats } from "./lib/stats";
import type { BaseStats, EVs, IVs, Nature } from "./lib/stats";
import type { PokemonType } from "./lib/damage";

import pokemonData from "./data/pokemons.json";
import moveData from "./data/moves.json";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#e53935" }, // 赤を少し締める
    secondary: { main: "#5e35b1" }, // 紫寄りに
    background: {
      default: "#f6f7fb",
      paper: "#ffffff",
    },
  },
  shape: { borderRadius: 18 },
  typography: {
    fontFamily: `"Inter","Noto Sans JP",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif`,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          background:
            "#f6f7fb",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: ({ theme }) => ({
          border: `1px solid ${theme.palette.divider}`,
          boxShadow: "0 12px 36px rgba(0,0,0,0.06)",
          borderRadius: 18,
        }),
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        title: { fontWeight: 900 },
        subheader: { fontWeight: 700 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 800 },
      },
    },
    MuiSlider: {
      styleOverrides: {
        thumb: {
          boxShadow: "0 0 0 8px rgba(229,57,53,0.12)",
        },
      },
    },
  },
});

const LEVEL = 50;

// 持ち物の型と簡易データ
type ItemId = "choiceBand" | "choiceSpecs" | "lifeOrb" | "assaultVest";

type ItemCategory = "offense" | "defense" | "utility";

type ItemOption = {
  id: ItemId;
  name: string;       // 表示名
  shortName?: string; // 将来Chipなどで使いたければ
  category: ItemCategory;
};

const ITEM_OPTIONS: ItemOption[] = [
  {
    id: "choiceBand",
    name: "こだわりハチマキ",
    shortName: "ハチマキ",
    category: "offense",
  },
  {
    id: "choiceSpecs",
    name: "こだわりメガネ",
    shortName: "メガネ",
    category: "offense",
  },
  {
    id: "lifeOrb",
    name: "いのちのたま",
    category: "offense",
  },
  {
    id: "assaultVest",
    name: "とつげきチョッキ",
    category: "defense",
  },
];

// ポケモンデータの型
type PokemonData = {
  id: string;
  name: string;
  types: PokemonType[];
  baseStats: BaseStats;
};

type MoveCategory = "physical" | "special" | "status";

// 表示用のタイプ名
const TYPE_LABELS: Record<PokemonType, string> = {
  normal: "ノーマル",
  fire: "ほのお",
  water: "みず",
  electric: "でんき",
  grass: "くさ",
  ice: "こおり",
  fighting: "かくとう",
  poison: "どく",
  ground: "じめん",
  flying: "ひこう",
  psychic: "エスパー",
  bug: "むし",
  rock: "いわ",
  ghost: "ゴースト",
  dragon: "ドラゴン",
  dark: "あく",
  steel: "はがね",
  fairy: "フェアリー",
};

const STAGE_OPTIONS = Array.from({ length: 13 }, (_, i) => i - 6).map((v) => ({
  value: v,
  label: v === 0 ? "±0" : v > 0 ? `+${v}` : `${v}`,
}));

type AbilityInfo = {
  name: string;
  physicalAtkMul?: number; // 物理Aにかかる倍率（例：ヨガパワー）
  physicalDefMul?: number; // 物理Bにかかる倍率（例：ファーコート）
};

// ポケモン名 → 特性（必要に応じて id ベースに変えてOK）
const ABILITY_BY_POKEMON_NAME: Record<string, AbilityInfo> = {
  れおさん: { name: "ヨガパワー", physicalAtkMul: 2 },
  ぶっちー: { name: "ファーコート", physicalDefMul: 2 },
};

const getAbilityInfo = (p: { name: string } | null | undefined): AbilityInfo | undefined => {
  if (!p) return undefined;
  return ABILITY_BY_POKEMON_NAME[p.name];
};

const getAbilityMultiplier = (
  pokemon: { name: string } | null | undefined,
  kind: "attack" | "defense",
  category: "physical" | "special" | "status"
) => {
  const info = getAbilityInfo(pokemon);
  if (!info) return 1;

  // 今回の2つは「物理のときだけ」
  if (category !== "physical") return 1;

  if (kind === "attack" && info.physicalAtkMul) return info.physicalAtkMul;
  if (kind === "defense" && info.physicalDefMul) return info.physicalDefMul;

  return 1;
};

const formatStage = (v: number) => (v === 0 ? "±0" : v > 0 ? `+${v}` : `${v}`);

// ポケモンのランク補正倍率
// +n: (2+n)/2, -n: 2/(2-n)
const stageMultiplier = (stage: number) => {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
};

const CATEGORY_LABELS: Record<MoveCategory, string> = {
  physical: "物理",
  special: "特殊",
  status: "変化",
};

// 簡易タイプ相性表（攻撃側 → 防御側）
const TYPE_CHART: Record<PokemonType, Partial<Record<PokemonType, number>>> = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: {
    fire: 0.5,
    water: 0.5,
    grass: 2,
    ice: 2,
    bug: 2,
    rock: 0.5,
    dragon: 0.5,
    steel: 2,
  },
  water: {
    fire: 2,
    water: 0.5,
    grass: 0.5,
    ground: 2,
    rock: 2,
    dragon: 0.5,
  },
  electric: {
    water: 2,
    electric: 0.5,
    grass: 0.5,
    ground: 0,
    flying: 2,
    dragon: 0.5,
  },
  grass: {
    fire: 0.5,
    water: 2,
    grass: 0.5,
    poison: 0.5,
    ground: 2,
    flying: 0.5,
    bug: 0.5,
    rock: 2,
    dragon: 0.5,
    steel: 0.5,
  },
  ice: {
    fire: 0.5,
    water: 0.5,
    grass: 2,
    ice: 0.5,
    ground: 2,
    flying: 2,
    dragon: 2,
    steel: 0.5,
  },
  fighting: {
    normal: 2,
    ice: 2,
    rock: 2,
    dark: 2,
    steel: 2,
    poison: 0.5,
    flying: 0.5,
    psychic: 0.5,
    bug: 0.5,
    fairy: 0.5,
    ghost: 0,
  },
  poison: {
    grass: 2,
    fairy: 2,
    poison: 0.5,
    ground: 0.5,
    rock: 0.5,
    ghost: 0.5,
    steel: 0,
  },
  ground: {
    fire: 2,
    electric: 2,
    poison: 2,
    rock: 2,
    steel: 2,
    grass: 0.5,
    bug: 0.5,
    flying: 0,
  },
  flying: {
    grass: 2,
    fighting: 2,
    bug: 2,
    electric: 0.5,
    rock: 0.5,
    steel: 0.5,
  },
  psychic: {
    fighting: 2,
    poison: 2,
    psychic: 0.5,
    steel: 0.5,
    dark: 0,
  },
  bug: {
    grass: 2,
    psychic: 2,
    dark: 2,
    fire: 0.5,
    fighting: 0.5,
    poison: 0.5,
    flying: 0.5,
    ghost: 0.5,
    steel: 0.5,
    fairy: 0.5,
  },
  rock: {
    fire: 2,
    ice: 2,
    flying: 2,
    bug: 2,
    fighting: 0.5,
    ground: 0.5,
    steel: 0.5,
  },
  ghost: {
    psychic: 2,
    ghost: 2,
    normal: 0,
    dark: 0.5,
  },
  dragon: {
    dragon: 2,
    steel: 0.5,
    fairy: 0,
  },
  dark: {
    psychic: 2,
    ghost: 2,
    fighting: 0.5,
    dark: 0.5,
    fairy: 0.5,
  },
  steel: {
    ice: 2,
    rock: 2,
    fairy: 2,
    fire: 0.5,
    water: 0.5,
    electric: 0.5,
    steel: 0.5,
  },
  fairy: {
    fighting: 2,
    dragon: 2,
    dark: 2,
    fire: 0.5,
    poison: 0.5,
    steel: 0.5,
  },
};

const getTypeEffectiveness = (
  moveType: PokemonType,
  defenderTypes: PokemonType[]
): number => {
  const chart = TYPE_CHART[moveType] ?? {};
  return defenderTypes.reduce(
    (mul, t) => mul * (chart[t] ?? 1),
    1
  );
};

// 技データの型
type MoveData = {
  id: string;
  name: string;
  type: PokemonType;
  category: MoveCategory;
  power: number | null;
  targets?: string[]; // ← ここ追加（その技を配布されてる2期ポケの id 達）
};

const POKEMONS = pokemonData as PokemonData[];
const MOVES = moveData as MoveData[];

// デフォルトの努力値・個体値・性格
const defaultAttackEVs: EVs = {
  hp: 0,
  atk: 252,
  def: 0,
  spa: 0,
  spd: 4,
  spe: 252,
};

const defaultAttackIVs: IVs = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const defaultAttackNature: Nature = {
  name: "いじっぱり",
  increased: "atk",
  decreased: "spa",
};

const defaultDefenseEVs: EVs = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const defaultDefenseIVs: IVs = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const defaultDefenseNature: Nature = {
  name: "ずぶとい",
  increased: "def",
  decreased: "atk",
};

// 最初に選ばれているポケモン＆技
const firstAttacker = POKEMONS[0] ?? null;
const firstDefender = POKEMONS[1] ?? POKEMONS[0] ?? null;
const firstMove = MOVES[0] ?? null;

// 初期実数値
const initialAttackerStats =
  firstAttacker &&
  calcAllStats(
    firstAttacker.baseStats,
    defaultAttackEVs,
    defaultAttackIVs,
    LEVEL,
    defaultAttackNature
  );

const initialDefenderStats =
  firstDefender &&
  calcAllStats(
    firstDefender.baseStats,
    defaultDefenseEVs,
    defaultDefenseIVs,
    LEVEL,
    defaultDefenseNature
  );

function App() {
  // ---- ポケモン・技選択 ----
  const [attackerPokemon, setAttackerPokemon] = useState<PokemonData | null>(
    firstAttacker
  );
  const [defenderPokemon, setDefenderPokemon] = useState<PokemonData | null>(
    firstDefender
  );
  const [selectedMove, setSelectedMove] = useState<MoveData | null>(firstMove);

  const [attackerStage, setAttackerStage] = useState<number>(0);
  const [defenderStage, setDefenderStage] = useState<number>(0);

  // Attacker の持ち物
  const [attackerItem, setAttackerItem] = useState<ItemOption | null>(null);

  // Defender の持ち物
  const [defenderItem, setDefenderItem] = useState<ItemOption | null>(null);
  // ---- 数値入力 ----
  const [attack, setAttack] = useState<number>(
    initialAttackerStats?.atk ?? 100
  );
  const [defense, setDefense] = useState<number>(
    initialDefenderStats?.def ?? 100
  );
  const [hp, setHp] = useState<number>(initialDefenderStats?.hp ?? 100);

    // ---- 努力値（EV） ----
    const [attackerAtkEV, setAttackerAtkEV] = useState<number>(
      defaultAttackEVs.atk // 252
    );
    const [attackerSpAEV, setAttackerSpAEV] = useState<number>(
      defaultAttackEVs.spa // 0
    );
  
    const [defenderHpEV, setDefenderHpEV] = useState<number>(
      defaultDefenseEVs.hp // 252
    );
    const [defenderDefEV, setDefenderDefEV] = useState<number>(
      defaultDefenseEVs.def // 252
    );
    const [defenderSpDEV, setDefenderSpDEV] = useState<number>(
      defaultDefenseEVs.spd // 4
    );

  // ポケモン or 技が変わったら、実数値と威力をまとめて再計算
  // ポケモン / 技 / 努力値が変わったら、実数値と威力をまとめて再計算
  useEffect(() => {
    if (!attackerPokemon || !defenderPokemon) return;

    // 攻撃側の努力値（必要なところだけ上書き）
    const attackerEVs: EVs = {
      hp: 0,
      atk: attackerAtkEV,
      def: 0,
      spa: attackerSpAEV,
      spd: 0,
      spe: 0,
    };

    // 防御側の努力値
    const defenderEVs: EVs = {
      hp: defenderHpEV,
      atk: 0,
      def: defenderDefEV,
      spa: 0,
      spd: defenderSpDEV,
      spe: 0,
    };

    const atkStats = calcAllStats(
      attackerPokemon.baseStats,
      attackerEVs,
      defaultAttackIVs,
      LEVEL,
      defaultAttackNature
    );

    const defStats = calcAllStats(
      defenderPokemon.baseStats,
      defenderEVs,
      defaultDefenseIVs,
      LEVEL,
      defaultDefenseNature
    );

    // HP は常に防御側のH
    setHp(defStats.hp);

    // 技カテゴリに応じて使う実数値を変える
    // 技カテゴリに応じて使う実数値を変える
const category = selectedMove?.category ?? "physical";
const isSpecial = category === "special";

const rawAttack = isSpecial ? atkStats.spa : atkStats.atk;
const rawDefense = isSpecial ? defStats.spd : defStats.def;

// ★ここが追加：努力値で出した実数値に、特性倍率をかける（ランクより前）
const atkMul = getAbilityMultiplier(attackerPokemon, "attack", category);
const defMul = getAbilityMultiplier(defenderPokemon, "defense", category);

setAttack(Math.floor(rawAttack * atkMul));
setDefense(Math.floor(rawDefense * defMul));

    // 威力もここで反映（技があれば）
  
  }, [
    attackerPokemon,
    defenderPokemon,
    selectedMove,
    attackerAtkEV,
    attackerSpAEV,
    defenderHpEV,
    defenderDefEV,
    defenderSpDEV,
  ]);
  const moveType: PokemonType = selectedMove?.type ?? "fire";
  const moveCategory = selectedMove?.category ?? "physical";
  const isSpecial = moveCategory === "special";
  const power = selectedMove?.power ?? 0;
  
  const attackStageLabel = isSpecial ? "特攻ランク" : "攻撃ランク";
  const defenseStageLabel = isSpecial ? "特防ランク" : "防御ランク";
  
  // --- 持ち物補正 ---
  const attackItemMultiplier =
    attackerItem?.id === "choiceBand" && !isSpecial
      ? 1.5 // 物理技 + こだわりハチマキ
      : attackerItem?.id === "choiceSpecs" && isSpecial
      ? 1.5 // 特殊技 + こだわりメガネ
      : attackerItem?.id === "lifeOrb"
      ? 1.3 // いのちのたま（本来は最終ダメ1.3倍だけど、ここでは攻撃にまとめて持たせる近似）
      : 1;
  
  const defenseItemMultiplier =
    defenderItem?.id === "assaultVest" && isSpecial
      ? 1.5 // 特防1.5倍（特殊技のときだけ）
      : 1;
  // --- ここまで ---
  
  const effectiveAttack = Math.floor(
    attack * attackItemMultiplier * stageMultiplier(attackerStage)
  );
  const effectiveDefense = Math.floor(
    defense * defenseItemMultiplier * stageMultiplier(defenderStage)
  );


  const attackerAbilityInfo = getAbilityInfo(attackerPokemon);
  const defenderAbilityInfo = getAbilityInfo(defenderPokemon);

  const attackerAbilityMul = getAbilityMultiplier(attackerPokemon, "attack", moveCategory);
  const defenderAbilityMul = getAbilityMultiplier(defenderPokemon, "defense", moveCategory);

  const attackLabel = isSpecial
    ? "攻撃実数値（とくこう）"
    : "攻撃実数値（こうげき）";

  const defenseLabel = isSpecial
    ? "防御実数値（とくぼう）"
    : "防御実数値（ぼうぎょ）";

    const result = calcDamage({
      level: LEVEL,
      power,
      attack: effectiveAttack,
      defense: effectiveDefense,
      moveType,
      attackerTypes: attackerPokemon?.types ?? ["fire"],
      defenderTypes: defenderPokemon?.types ?? ["steel"],
      defenderHp: hp,
    });

// ダメージ％を 0〜100 にクランプ（HPバー用）
// ダメージ％を 0〜100 にクランプ（HPバー用）
const clampedMinPercent = Math.max(0, Math.min(100, result.minPercent));
const clampedMaxPercent = Math.max(0, Math.min(100, result.maxPercent));

const remainingMinHP = Math.max(0, hp - result.max); // 最悪（最大ダメ後）
const remainingMaxHP = Math.max(0, hp - result.min); // 最良（最小ダメ後）

// 残HP%（残る体力） = 100 - 被ダメ%
const remainingMinPercent = Math.max(0, Math.min(100, 100 - clampedMaxPercent)); // 最悪（最大ダメ後）
const remainingMaxPercent = Math.max(0, Math.min(100, 100 - clampedMinPercent)); // 最良（最小ダメ後）
const remainingExtraPercent = Math.max(0, remainingMaxPercent - remainingMinPercent); // 薄緑の伸び分

const hpColorKey =
  remainingMinPercent < 20
    ? "error" // 20%未満 → 赤
    : remainingMinPercent <= 50
      ? "warning" // 20〜50% → 橙
      : "success"; // それ以外 → 緑

const hpBarSolidColor = `${hpColorKey}.dark` as const; // 濃い部分
const hpBarRangeColor = `${hpColorKey}.main` as const; // 薄い部分

// 2発・3発で落ちる確率（※ここは1回だけ宣言する）
const twoHKOChance = getKOChance(result.rolls, hp, 2);
const threeHKOChance = getKOChance(result.rolls, hp, 3);

const isGuaranteed = (p: number) => p >= 99.95; // 浮動小数誤差対策

const koChance = (hits: number) =>
  hits === 1 ? result.ohkoChance : getKOChance(result.rolls, hp, hits);

const guaranteedHits = (() => {
  for (let n = 1; n <= 10; n++) {
    const p = koChance(n);
    if (isGuaranteed(p)) return n;
  }
  return 10;
})();

// 「最短で落ちる可能性がある」発数（乱数n発）を探す
const randomKO = (() => {
  for (let n = 1; n <= guaranteedHits; n++) {
    const p = koChance(n);
    if (p > 0) return { hits: n, chance: p };
  }
  // ここに来ることは基本ないけど保険
  return { hits: guaranteedHits, chance: koChance(guaranteedHits) };
})();

const koSummary = (() => {
  // 乱数の発数と確定の発数が同じなら「確定n発」
  if (randomKO.hits === guaranteedHits) return `確定${guaranteedHits}発`;

  // そうでなければ「乱数n発(xx%) / 確定m発」
  return `乱数${randomKO.hits}発 (${randomKO.chance.toFixed(1)}%) / 確定${guaranteedHits}発`;
})();

// タイプ相性倍率（STAB抜き）
const typeEffectiveness =
  selectedMove && defenderPokemon
    ? getTypeEffectiveness(moveType, defenderPokemon.types)
    : 1;

let effectivenessText = "";
if (selectedMove && defenderPokemon) {
  if (typeEffectiveness === 0) {
    effectivenessText = "こうかがないようだ… (x0)";
  } else if (typeEffectiveness > 1) {
    effectivenessText = `こうかはばつぐんだ！ (x${typeEffectiveness})`;
  } else if (typeEffectiveness < 1) {
    effectivenessText = `効果はいまひとつのようだ… (x${typeEffectiveness})`;
  } else {
    effectivenessText = "等倍ダメージ (x1)";
  }
}

// 相性テキストの色（MUIのテーマ色）
const effectivenessColor =
  typeEffectiveness === 0
    ? "text.disabled"
    : typeEffectiveness > 1
      ? "error.main"
      : typeEffectiveness < 1
        ? "warning.main"
        : "text.secondary";
  const filteredMoves = useMemo(() => {
    return MOVES.filter((move) => {
      // 変化技は除外
      if (move.category === "status") return false;

      // 威力なしは除外
      if (move.power == null || move.power === 0) return false;

      // targets がない/空の技は除外
      if (!move.targets || move.targets.length === 0) return false;

      // 攻撃側未選択なら、とりあえず使える技は全部出す
      if (!attackerPokemon) return true;

      // 攻撃側に配布されている技だけ
      return move.targets.includes(attackerPokemon.id);
    });
  }, [attackerPokemon]);

  // 攻撃側ポケモンが変わって、今選んでいる技が候補外になったら自動で差し替え
  useEffect(() => {
    if (!selectedMove) return;

    const stillValid = filteredMoves.some(
      (move) => move.id === selectedMove.id
    );

    if (!stillValid) {
      // 候補の先頭に自動で差し替え（候補がなければ null）
      setSelectedMove(filteredMoves[0] ?? null);
    }
  }, [filteredMoves, selectedMove]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", bgcolor: "#f5f5f5", pt: 4, pb: 14 }}>
        {/* 中央寄せ＆横幅 lg までのコンテナ */}
        <Container maxWidth={false} sx={{ px: { xs: 2, sm: 3, md: 4 } }}>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Damage Calculator
          </Typography>

          {/* Attacker / Defender を2カラムで並べる */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, // スマホ1列 / それ以上2列
              gap: 2,
              width: "100%",
            }}
          >
            {/* Attacker */}
            <Card sx={{ boxShadow: 3 }}>
              <CardHeader title="🗡️Attacker" />
              <CardContent>
                <Stack spacing={2}>
                  {/* ポケモン選択 */}
                  <Autocomplete
                    options={POKEMONS}
                    getOptionLabel={(option) => option.name}
                    value={attackerPokemon}
                    onChange={(_, newValue) => setAttackerPokemon(newValue)}
                    renderInput={(params) => (
                      <TextField {...params} label="ポケモン" size="small" />
                    )}
                  />
                  {/* 持ち物選択（UIだけ・計算には未反映） */}
<Autocomplete
  options={ITEM_OPTIONS}
  getOptionLabel={(option) => option.name}
  groupBy={(option) =>
    option.category === "offense"
      ? "攻撃系"
      : option.category === "defense"
      ? "耐久系"
      : "その他"
  }
  value={attackerItem}
  onChange={(_, newValue) => setAttackerItem(newValue)}
  renderInput={(params) => (
    <TextField
      {...params}
      label="持ち物"
      size="small"
      placeholder="なし"
    />
  )}
  clearOnEscape
/>

                  {/* 技選択 */}
                  <Autocomplete
                    options={filteredMoves}
                    getOptionLabel={(option) => option.name}
                    value={selectedMove}
                    onChange={(_, newValue) => setSelectedMove(newValue)}
                    renderInput={(params) => (
                      <TextField {...params} label="技" size="small" />
                    )}
                  />

                  {/* 説明 + 技情報（威力は編集しない） */}
                  <Typography variant="body2" color="text.secondary">
                    攻撃実数値をいじってみる（実数値はポケモンと努力値から自動計算）。
                  </Typography>

                  {selectedMove && (
                    <Typography variant="body2" color="text.secondary">
                      {TYPE_LABELS[selectedMove.type]} 威力{selectedMove.power}{" "}
                      {CATEGORY_LABELS[selectedMove.category]}
                    </Typography>
                  )}

                  {/* 攻撃実数値（こうげき / とくこう） → EV をいじる */}
                  <Typography variant="subtitle2">
  {attackLabel}：{attack}
  {attackerAbilityInfo && attackerAbilityMul !== 1 ? `（特性:${attackerAbilityInfo.name}×${attackerAbilityMul}）` : attackerAbilityInfo ? `（特性:${attackerAbilityInfo.name}）` : ""}
  （{formatStage(attackerStage)} → {effectiveAttack}）
</Typography>
                  <TextField
                    select
                   size="small"
                   label={attackStageLabel}
                    value={attackerStage}
                    onChange={(e) => setAttackerStage(Number(e.target.value))}
                    sx={{ width: 140 }}
                  >
                  {STAGE_OPTIONS.slice().reverse().map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                  </MenuItem>
                  ))}
                  </TextField>
                  <Slider
  value={isSpecial ? attackerSpAEV : attackerAtkEV}
  min={0}
  max={252}
  step={4}
  onChange={(_, v) => {
    const ev = Array.isArray(v) ? v[0] : v;
    if (isSpecial) {
      setAttackerSpAEV(ev);
    } else {
      setAttackerAtkEV(ev);
    }
  }}
  sx={{
    "& .MuiSlider-track": {
      bgcolor: "primary.main",              // 塗られてる部分
    },
    "& .MuiSlider-rail": {
      bgcolor: "rgba(229,57,53,0.16)",      // 背景レール
    },
    "& .MuiSlider-thumb": {
      bgcolor: "#fff",                      // つまみ
      border: "2px solid #e53935",
    },
  }}
/>
                  <TextField
                    size="small"
                    type="number"
                    value={isSpecial ? attackerSpAEV : attackerAtkEV}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const ev = Number.isNaN(raw)
                        ? 0
                        : Math.max(0, Math.min(252, raw));
                      if (isSpecial) {
                        setAttackerSpAEV(ev);
                      } else {
                        setAttackerAtkEV(ev);
                      }
                    }}
                    sx={{ width: 120 }}
                  />
                </Stack>
              </CardContent>
            </Card>

            {/* Defender */}
            <Card sx={{ boxShadow: 3 }}>
              <CardHeader title="🛡️Defender" />
              <CardContent>
                <Stack spacing={2}>
                  {/* ポケモン選択 */}
                  <Autocomplete
                    options={POKEMONS}
                    getOptionLabel={(option) => option.name}
                    value={defenderPokemon}
                    onChange={(_, newValue) => setDefenderPokemon(newValue)}
                    renderInput={(params) => (
                      <TextField {...params} label="ポケモン" size="small" />
                    )}
                  />
                  {/* 持ち物選択（UIだけ） */}
<Autocomplete
  options={ITEM_OPTIONS}
  getOptionLabel={(option) => option.name}
  groupBy={(option) =>
    option.category === "offense"
      ? "攻撃系"
      : option.category === "defense"
      ? "耐久系"
      : "その他"
  }
  value={defenderItem}
  onChange={(_, newValue) => setDefenderItem(newValue)}
  renderInput={(params) => (
    <TextField
      {...params}
      label="持ち物"
      size="small"
      placeholder="なし"
    />
  )}
  clearOnEscape
/>

                  <Typography variant="body2" color="text.secondary">
                    こっちは HP と防御実数値をいじる（実数値はポケモンと努力値から自動計算）。
                  </Typography>

                  {/* HP → EV をいじる */}
                  <Typography variant="subtitle2">
                    HP実数値：{hp}
                  </Typography>
                  <Slider
  value={defenderHpEV}
  min={0}
  max={252}
  step={4}
  onChange={(_, v) => {
    const ev = Array.isArray(v) ? v[0] : v;
    setDefenderHpEV(ev);
  }}
  sx={{
    "& .MuiSlider-track": {
      bgcolor: "success.main",   // 線の色：緑
      border: "none",            // ★赤い枠線を消す
      // borderColor: "success.main", でもOK
    },
    "& .MuiSlider-rail": {
      bgcolor: "rgba(76,175,80,0.2)", // 薄い緑レール
    },
    "& .MuiSlider-thumb": {
      bgcolor: "#fff",
      border: "2px solid #43a047",
      boxShadow: "none",
    },
  }}
/>
                  <TextField
                    size="small"
                    type="number"
                    value={defenderHpEV}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const ev = Number.isNaN(raw)
                        ? 0
                        : Math.max(0, Math.min(252, raw));
                      setDefenderHpEV(ev);
                    }}
                    sx={{ width: 120 }}
                  />

                  {/* 防御実数値（ぼうぎょ / とくぼう） → EV をいじる */}
                  <Typography variant="subtitle2">
  {defenseLabel}：{defense}
  {defenderAbilityInfo && defenderAbilityMul !== 1 ? `（特性:${defenderAbilityInfo.name}×${defenderAbilityMul}）` : defenderAbilityInfo ? `（特性:${defenderAbilityInfo.name}）` : ""}
  （{formatStage(defenderStage)} → {effectiveDefense}）
</Typography>
<TextField
  select
  size="small"
  label={defenseStageLabel}
  value={defenderStage}
  onChange={(e) => setDefenderStage(Number(e.target.value))}
  sx={{ width: 140 }}
>
  {STAGE_OPTIONS.slice().reverse().map((opt) => (
    <MenuItem key={opt.value} value={opt.value}>
      {opt.label}
    </MenuItem>
  ))}
</TextField>
<Slider
  value={isSpecial ? defenderSpDEV : defenderDefEV}
  min={0}
  max={252}
  step={4}
  onChange={(_, v) => {
    const ev = Array.isArray(v) ? v[0] : v;
    if (isSpecial) {
      setDefenderSpDEV(ev);
    } else {
      setDefenderDefEV(ev);
    }
  }}
  sx={{
    "& .MuiSlider-track": {
      bgcolor: "secondary.main",        // 線の色：紫
      border: "none",                   // ★赤い枠線を消す
      // borderColor: "secondary.main", でもOK
    },
    "& .MuiSlider-rail": {
      bgcolor: "rgba(94,53,177,0.16)",  // 薄い紫レール
    },
    "& .MuiSlider-thumb": {
      bgcolor: "#fff",
      border: "2px solid #5e35b1",
      boxShadow: "none",
    },
  }}
/>
                  <TextField
                    size="small"
                    type="number"
                    value={isSpecial ? defenderSpDEV : defenderDefEV}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const ev = Number.isNaN(raw)
                        ? 0
                        : Math.max(0, Math.min(252, raw));
                      if (isSpecial) {
                        setDefenderSpDEV(ev);
                      } else {
                        setDefenderDefEV(ev);
                      }
                    }}
                    sx={{ width: 120 }}
                  />
                </Stack>
              </CardContent>
            </Card>
          </Box>

          <Card sx={{ mt: 3, borderRadius: 3, boxShadow: 2 }}>
  <CardHeader title="結果" subheader={koSummary} />
  <CardContent>
    <Stack spacing={1.25}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        {result.min} ~ {result.max} ダメージ（{result.minPercent.toFixed(1)}% ~{" "}
        {result.maxPercent.toFixed(1)}%）
      </Typography>

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        {selectedMove && (
          <>
            <Chip
              size="small"
              label={`${TYPE_LABELS[moveType]} / ${CATEGORY_LABELS[moveCategory]}`}
              variant="outlined"
            />
            <Chip size="small" label={`威力 ${power}`} variant="outlined" />
          </>
        )}
        {effectivenessText && power > 0 && (
          <Chip
            size="small"
            label={effectivenessText}
            sx={{ color: effectivenessColor, borderColor: effectivenessColor }}
            variant="outlined"
          />
        )}
      </Stack>

      <Divider />

      {power > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            残HP（最悪〜最良）
          </Typography>

          <Box
            sx={{
              mt: 0.5,
              position: "relative",
              height: 14,
              borderRadius: 999,
              bgcolor: "grey.300",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${remainingMinPercent}%`,
                bgcolor: hpBarSolidColor,
                opacity: 0.9,
              }}
            />
            <Box
              sx={{
                position: "absolute",
                left: `${remainingMinPercent}%`,
                top: 0,
                bottom: 0,
                width: `${remainingExtraPercent}%`,
                bgcolor: hpBarRangeColor,
                opacity: 0.45,
              }}
            />
          </Box>

          <Box sx={{ mt: 0.5, display: "flex", justifyContent: "space-between" }}>
            <Typography variant="caption" color="text.secondary">
              最悪 {remainingMinPercent.toFixed(1)}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              最良 {remainingMaxPercent.toFixed(1)}%
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary">
            残HP：最悪 {remainingMinHP}/{hp} ～ 最良 {remainingMaxHP}/{hp}
          </Typography>
        </Box>
      )}

      <Accordion
        elevation={0}
        sx={{ bgcolor: "transparent", "&::before": { display: "none" } }}
      >
        <AccordionSummary expandIcon={<span>▾</span>} sx={{ px: 0 }}>
          <Typography sx={{ color: "primary.main", fontWeight: 700 }}>
            内訳を開く
          </Typography>
        </AccordionSummary>

        <AccordionDetails sx={{ px: 0, pt: 0 }}>
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              1発で倒せる確率: {result.ohkoChance.toFixed(1)}%
            </Typography>
            <Typography variant="body2" color="text.secondary">
              2発で倒せる確率: {twoHKOChance.toFixed(1)}%
            </Typography>
            <Typography variant="body2" color="text.secondary">
              3発で倒せる確率: {threeHKOChance.toFixed(1)}%
            </Typography>

            <Divider sx={{ my: 1 }} />

            <Typography variant="body2" color="text.secondary">
              使用実数値（補正後）: 攻撃 {effectiveAttack} / 防御 {effectiveDefense} / HP {hp}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ランク: 攻撃 {formatStage(attackerStage)} / 防御 {formatStage(defenderStage)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              乱数: 16通り（0.85〜1.00）
            </Typography>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  </CardContent>
</Card>
        </Container>
      </Box>
      {power > 0 && (
  <Box
    sx={{
      position: "fixed",
      left: 0,
      right: 0,
      bottom: 0,
      borderTop: "1px solid",
      borderColor: "divider",
      boxShadow: 6,
      bgcolor: "rgba(255,255,255,0.9)",
      backdropFilter: "blur(10px)",
      zIndex: (t) => t.zIndex.drawer + 1,
      px: 2,
      py: 1, // ちょっとだけ低めにして高さを抑える
    }}
  >
    <Container maxWidth={false} sx={{ px: { xs: 2, sm: 3, md: 4 } }}>
      <Stack spacing={0.5}>
        {/* 1行目：KO summary + 相性Chip */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 800 }}
            noWrap
          >
            {koSummary}
          </Typography>

          {effectivenessText && (
            <Chip
              size="small"
              label={effectivenessText}
              sx={{
                bgcolor: effectivenessColor,
                color: "#fff",
                fontSize: "0.7rem",
                height: 22,
                px: 0.8,
                borderRadius: 1.5,
              }}
            />
          )}
        </Stack>

        <Divider sx={{ opacity: 0.5 }} />

        {/* 2行目：ダメージレンジ */}
        <Typography
          variant="body2"
          sx={{ fontWeight: 700 }}
          noWrap
        >
          ダメージ: {result.min} ~ {result.max}（
          {result.minPercent.toFixed(1)}% ~ {result.maxPercent.toFixed(1)}%）
        </Typography>

        {/* 3行目：残HPバー + 残HP実数値 */}
        <Stack direction="row" spacing={1} alignItems="center">
          {/* 小さい残HPバー */}
          <Box
            sx={{
              position: "relative",
              height: 8,
              borderRadius: 999,
              bgcolor: "grey.300",
              overflow: "hidden",
              flex: 1,
            }}
          >
            <Box
              sx={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${remainingMinPercent}%`,
                bgcolor: hpBarSolidColor,
                opacity: 0.9,
              }}
            />
            <Box
              sx={{
                position: "absolute",
                left: `${remainingMinPercent}%`,
                top: 0,
                bottom: 0,
                width: `${remainingExtraPercent}%`,
                bgcolor: hpBarRangeColor,
                opacity: 0.45,
              }}
            />
          </Box>

          {/* 残HP実数値 */}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ whiteSpace: "nowrap" }}
          >
            残HP {remainingMinHP}/{hp} ～ {remainingMaxHP}/{hp}
          </Typography>
        </Stack>
      </Stack>
    </Container>
  </Box>
)}
    </ThemeProvider>
  );
}
export default App;