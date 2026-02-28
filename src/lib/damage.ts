// src/lib/damage.ts

// -------------------------
// タイプ関連
// -------------------------
export type PokemonType =
  | "normal"
  | "fire"
  | "water"
  | "electric"
  | "grass"
  | "ice"
  | "fighting"
  | "poison"
  | "ground"
  | "flying"
  | "psychic"
  | "bug"
  | "rock"
  | "ghost"
  | "dragon"
  | "dark"
  | "steel"
  | "fairy";

type TypeRelation = {
  strong: PokemonType[];    // こうかばつぐん (x2)
  weak: PokemonType[];      // いまひとつ (x0.5)
  noEffect: PokemonType[];  // こうかなし (x0)
};

const TYPE_CHART: Record<PokemonType, TypeRelation> = {
  normal:  { strong: [], weak: ["rock", "steel"], noEffect: ["ghost"] },
  fire:    { strong: ["grass", "ice", "bug", "steel"], weak: ["fire", "water", "rock", "dragon"], noEffect: [] },
  water:   { strong: ["fire", "ground", "rock"], weak: ["water", "grass", "dragon"], noEffect: [] },
  electric:{ strong: ["water", "flying"], weak: ["electric", "grass", "dragon"], noEffect: ["ground"] },
  grass:   { strong: ["water", "ground", "rock"], weak: ["fire", "grass", "poison", "flying", "bug", "dragon", "steel"], noEffect: [] },
  ice:     { strong: ["grass", "ground", "flying", "dragon"], weak: ["fire", "water", "ice", "steel"], noEffect: [] },
  fighting:{ strong: ["normal", "ice", "rock", "dark", "steel"], weak: ["poison", "flying", "psychic", "bug", "fairy"], noEffect: ["ghost"] },
  poison:  { strong: ["grass", "fairy"], weak: ["poison", "ground", "rock", "ghost"], noEffect: ["steel"] },
  ground:  { strong: ["fire", "electric", "poison", "rock", "steel"], weak: ["grass", "bug"], noEffect: ["flying"] },
  flying:  { strong: ["grass", "fighting", "bug"], weak: ["electric", "rock", "steel"], noEffect: [] },
  psychic: { strong: ["fighting", "poison"], weak: ["psychic", "steel"], noEffect: ["dark"] },
  bug:     { strong: ["grass", "psychic", "dark"], weak: ["fire", "fighting", "poison", "flying", "ghost", "steel", "fairy"], noEffect: [] },
  rock:    { strong: ["fire", "ice", "flying", "bug"], weak: ["fighting", "ground", "steel"], noEffect: [] },
  ghost:   { strong: ["psychic", "ghost"], weak: ["dark"], noEffect: ["normal"] },
  dragon:  { strong: ["dragon"], weak: ["steel"], noEffect: ["fairy"] },
  dark:    { strong: ["psychic", "ghost"], weak: ["fighting", "dark", "fairy"], noEffect: [] },
  steel:   { strong: ["ice", "rock", "fairy"], weak: ["fire", "water", "electric", "steel"], noEffect: [] },
  fairy:   { strong: ["fighting", "dragon", "dark"], weak: ["fire", "poison", "steel"], noEffect: [] },
};

const getTypeEffectiveness = (
  moveType: PokemonType,
  defenderTypes: PokemonType[],
): number => {
  const relation = TYPE_CHART[moveType];
  let mult = 1;

  for (const defType of defenderTypes) {
    if (relation.noEffect.includes(defType)) {
      return 0; // 無効なら問答無用で 0
    }
    if (relation.strong.includes(defType)) {
      mult *= 2;
    } else if (relation.weak.includes(defType)) {
      mult *= 0.5;
    }
  }

  return mult;
};

const getSTAB = (
  moveType: PokemonType,
  attackerTypes: PokemonType[],
): number => {
  return attackerTypes.includes(moveType) ? 1.5 : 1.0;
};

// -------------------------
// ダメージ計算まわり
// -------------------------

export type CalcDamageArgs = {
  level: number;             // レベル（だいたい 50 を想定）
  power: number;             // 技の威力
  attack: number;            // 攻撃側の実数値（物理 or 特殊）
  defense: number;           // 防御側の実数値（物理 or 特殊）
  moveType: PokemonType;     // 技タイプ
  attackerTypes: PokemonType[]; // 攻撃側のタイプ(1〜2個)
  defenderTypes: PokemonType[]; // 防御側のタイプ(1〜2個)
  defenderHp: number;        // 防御側のHP実数値
};

export type DamageResult = {
  rolls: number[];       // 16通りのダメージ
  min: number;
  max: number;
  minPercent: number;
  maxPercent: number;
  ohkoChance: number;    // 1発で倒せる確率（%）
  guaranteedHits: number; // 確定◯発
};

export const getKOChance = (
  rolls: number[],
  hp: number,
  hits: number,
): number => {
  // 乱数分布を hits 回畳み込んで、合計ダメージ >= HP になる確率を計算
  let dist = new Map<number, number>();
  dist.set(0, 1); // 0ダメージが1通りスタート

  for (let h = 0; h < hits; h++) {
    const newDist = new Map<number, number>();
    for (const [sum, count] of dist.entries()) {
      for (const d of rolls) {
        const newSum = sum + d;
        const prev = newDist.get(newSum) ?? 0;
        newDist.set(newSum, prev + count);
      }
    }
    dist = newDist;
  }

  const totalCombos = Math.pow(rolls.length, hits);
  let koCombos = 0;
  for (const [sum, count] of dist.entries()) {
    if (sum >= hp) {
      koCombos += count;
    }
  }

  return (koCombos / totalCombos) * 100;
};

export const getGuaranteedHits = (rolls: number[], hp: number): number => {
  const min = rolls[0];
  if (min <= 0) return Infinity;
  return Math.ceil(hp / min);
};

export const calcDamage = (args: CalcDamageArgs): DamageResult => {
  const {
    level,
    power,
    attack,
    defense,
    moveType,
    attackerTypes,
    defenderTypes,
    defenderHp,
  } = args;

  if (power <= 0 || attack <= 0 || defense <= 0 || defenderHp <= 0) {
    return {
      rolls: [0],
      min: 0,
      max: 0,
      minPercent: 0,
      maxPercent: 0,
      ohkoChance: 0,
      guaranteedHits: Infinity,
    };
  }

  // --- ① 乱数・補正を除いた「素のダメージ」部分（公式準拠） ---
  const step1 = Math.floor((2 * level) / 5) + 2;
  const step2 = Math.floor((step1 * power * attack) / defense);
  const baseDamage = Math.floor(step2 / 50) + 2;

  // --- ② STAB + タイプ相性 ---
  const stab = getSTAB(moveType, attackerTypes);
  const typeEff = getTypeEffectiveness(moveType, defenderTypes);

  // 今は天候・持ち物・ランク補正などは全部 1 としておく
  const otherModifier = 1.0;

  const modifierWithoutRandom = stab * typeEff * otherModifier;

  // --- ③ 乱数16通り（0.85〜1.00） ---
  const rolls: number[] = [];
  for (let i = 0; i < 16; i++) {
    const rand = (85 + i) / 100; // 0.85, 0.86, ... , 1.00
    const damage = Math.floor(baseDamage * modifierWithoutRandom * rand);
    rolls.push(damage);
  }
  rolls.sort((a, b) => a - b);

  const min = rolls[0];
  const max = rolls[rolls.length - 1];
  const minPercent = (min / defenderHp) * 100;
  const maxPercent = (max / defenderHp) * 100;

  const ohkoChance = getKOChance(rolls, defenderHp, 1);
  const guaranteedHits = getGuaranteedHits(rolls, defenderHp);

  return {
    rolls,
    min,
    max,
    minPercent,
    maxPercent,
    ohkoChance,
    guaranteedHits,
  };
};