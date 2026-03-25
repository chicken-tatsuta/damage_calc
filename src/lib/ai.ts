import { calcDamage, getTypeEffectiveness } from "./damage";
import {
  applyBattleStageChanges,
  applyStageMultiplier,
  formatBattleStageChange,
  getEffectiveSpeed,
  type BattleStageStat,
} from "./battleStages";
import type { SimBattlePokemon, SimMove } from "./simulator";

export type MoveEvaluation = {
  move: SimMove;
  expectedDamage: number;
  koChance: number;
  priority: number;
  accuracy: number;
  score: number;
  twoTurnKoChance: number;
  twoTurnSetupScore: number;
};

type FinishingPlan = {
  move: SimMove | null;
  finishChance: number;
  expectedDamage: number;
};

type WeightedMoveOption = {
  move: SimMove;
  probability: number;
  score: number;
};

type ProjectedTurnOutcome = {
  attacker: SimBattlePokemon;
  defender: SimBattlePokemon;
  probability: number;
  opponentMove: SimMove;
};

type DamageDistribution = Map<number, number>;
type DefenderState = {
  hp: number;
  focusSashUsed: boolean;
};

const CRIT_BUCKETS = 24;
const MAX_BASE_DAMAGE_CACHE_SIZE = 5000;
const MAX_EVALUATION_CACHE_SIZE = 3000;
const MAX_MOVE_DISTRIBUTION_CACHE_SIZE = 5000;
const MAX_WEIGHTED_POLICY_CACHE_SIZE = 3000;
const baseDamageRollCache = new Map<string, number[]>();
const evaluationCache = new Map<string, MoveEvaluation[]>();
const moveDamageDistributionCache = new Map<string, Array<[number, number]>>();
const weightedMovePolicyCache = new Map<string, WeightedMoveOption[]>();

const capCacheSize = (cache: Map<string, unknown>, maxSize: number) => {
  if (cache.size >= maxSize) {
    cache.clear();
  }
};

const getStaticDamageKey = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove,
  powerOverride = move.power
) => {
  const relevantAttackStat = getRelevantStats(attacker, move).attack;
  const relevantDefenseStat = getDefenseStatWithItem(defender, move.category);

  return [
    attacker.level,
    attacker.pokemon.id,
    attacker.itemId ?? "",
    relevantAttackStat,
    attacker.pokemon.types.join(","),
    defender.pokemon.id,
    defender.itemId ?? "",
    relevantDefenseStat,
    defender.pokemon.types.join(","),
    move.id,
    powerOverride,
    move.critRank ?? 0,
  ].join("|");
};

const getEvaluationKey = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon
) =>
  [
    attacker.pokemon.id,
    attacker.itemId ?? "",
    attacker.choiceLockedMoveId ?? "",
    attacker.currentHp,
    attacker.effectiveSpeed,
    attacker.focusSashUsed ? 1 : 0,
    attacker.burned ? 1 : 0,
    attacker.paralyzed ? 1 : 0,
    attacker.protectActive ? 1 : 0,
    attacker.protectUsedLastTurn ? 1 : 0,
    attacker.stages.atk,
    attacker.stages.def,
    attacker.stages.spa,
    attacker.stages.spd,
    attacker.stages.spe,
    attacker.stats.hp,
    attacker.stats.atk,
    attacker.stats.def,
    attacker.stats.spa,
    attacker.stats.spd,
    attacker.stats.spe,
    attacker.moves.map((move) => move.id).join(","),
    defender.pokemon.id,
    defender.itemId ?? "",
    defender.choiceLockedMoveId ?? "",
    defender.currentHp,
    defender.effectiveSpeed,
    defender.focusSashUsed ? 1 : 0,
    defender.burned ? 1 : 0,
    defender.paralyzed ? 1 : 0,
    defender.protectActive ? 1 : 0,
    defender.protectUsedLastTurn ? 1 : 0,
    defender.stages.atk,
    defender.stages.def,
    defender.stages.spa,
    defender.stages.spd,
    defender.stages.spe,
    defender.stats.hp,
    defender.stats.atk,
    defender.stats.def,
    defender.stats.spa,
    defender.stats.spd,
    defender.stats.spe,
    defender.moves.map((move) => move.id).join(","),
  ].join("|");

const getMoveDistributionKey = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove
) => [getEvaluationKey(attacker, defender), move.id].join("|");

export const clearAiCaches = () => {
  baseDamageRollCache.clear();
  evaluationCache.clear();
  moveDamageDistributionCache.clear();
  weightedMovePolicyCache.clear();
};

const getAttackStatItemMultiplier = (
  itemId: string | undefined,
  category: SimMove["category"]
) => {
  if (itemId === "choiceBand" && category === "physical") {
    return 1.5;
  }

  if (itemId === "choiceSpecs" && category === "special") {
    return 1.5;
  }

  if (itemId === "lifeOrb") {
    return 1.3;
  }

  return 1;
};

const getAttackAbilityMultiplier = (
  pokemon: SimBattlePokemon,
  category: SimMove["category"]
) => {
  if (category === "physical" && pokemon.pokemon.id === "reosan") {
    return 2;
  }

  return 1;
};

const getFinalDamageItemMultiplier = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove
) => {
  let multiplier = 1;

  if (attacker.itemId === "lifeOrb") {
    multiplier *= 1.3;
  }

  if (
    attacker.itemId === "expertBelt" &&
    getTypeEffectiveness(move.type, defender.pokemon.types) > 1
  ) {
    multiplier *= 1.2;
  }

  return multiplier;
};

const getDefenseStatWithItem = (
  pokemon: SimBattlePokemon,
  category: SimMove["category"]
) => {
  if (category === "special") {
    const baseDefense = pokemon.stats.spd;
    const stagedDefense = applyStageMultiplier(baseDefense, pokemon.stages.spd);
    return pokemon.itemId === "assaultVest" ? Math.floor(stagedDefense * 1.5) : stagedDefense;
  }

  const stagedDefense = applyStageMultiplier(pokemon.stats.def, pokemon.stages.def);
  if (pokemon.pokemon.id === "bucchi") {
    return stagedDefense * 2;
  }

  return stagedDefense;
};

const getRelevantStats = (pokemon: SimBattlePokemon, move: SimMove) => {
  if (move.category === "physical") {
    return {
      attack: Math.floor(
        applyStageMultiplier(pokemon.stats.atk, pokemon.stages.atk) *
          getAttackStatItemMultiplier(pokemon.itemId, move.category) *
          getAttackAbilityMultiplier(pokemon, move.category) *
          (pokemon.burned ? 0.5 : 1)
      ),
    };
  }

  return {
    attack: Math.floor(
      applyStageMultiplier(pokemon.stats.spa, pokemon.stages.spa) *
        getAttackStatItemMultiplier(pokemon.itemId, move.category) *
        getAttackAbilityMultiplier(pokemon, move.category)
    ),
  };
};

const getRockyHelmetDamage = (pokemon: SimBattlePokemon) => {
  return Math.max(1, Math.floor(pokemon.stats.hp / 6));
};

const getBurnDamage = (pokemon: SimBattlePokemon) => {
  return Math.max(1, Math.floor(pokemon.stats.hp / 16));
};

const canApplyBurn = (defender: SimBattlePokemon) => {
  return !defender.burned && !defender.pokemon.types.includes("fire");
};

const canApplyParalysis = (defender: SimBattlePokemon, move?: SimMove) => {
  if (defender.paralyzed) {
    return false;
  }

  if (move?.id === "でんじは") {
    return !defender.pokemon.types.includes("ground") && !defender.pokemon.types.includes("electric");
  }

  return true;
};

const refreshEffectiveSpeed = (pokemon: SimBattlePokemon) => {
  pokemon.effectiveSpeed = getEffectiveSpeed(
    pokemon.stats.spe,
    pokemon.itemId,
    pokemon.stages.spe,
    pokemon.paralyzed
  );
};

const applyRockyHelmetDamage = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove,
  damageDealt: number
) => {
  if (!move.isContact || damageDealt <= 0 || defender.itemId !== "rockyHelmet") {
    return;
  }

  attacker.currentHp = Math.max(0, attacker.currentHp - getRockyHelmetDamage(attacker));
};

const getMoveCritChance = (move: SimMove) => {
  const rank = move.critRank ?? 0;

  if (rank >= 3) {
    return 1;
  }

  if (rank === 2) {
    return 0.5;
  }

  if (rank === 1) {
    return 1 / 8;
  }

  return 1 / 24;
};

const getMoveAccuracy = (move: SimMove) => {
  return move.accuracy ?? 100;
};

const getAccuracyMultiplier = (move: SimMove) => getMoveAccuracy(move) / 100;

const getProjectedMoveOutcomeOptions = (move: SimMove) => {
  if (move.protect) {
    return [{ hit: true, probability: 1 }];
  }

  const accuracyRate = getAccuracyMultiplier(move);
  if (accuracyRate <= 0) {
    return [{ hit: false, probability: 1 }];
  }

  if (accuracyRate >= 1) {
    return [{ hit: true, probability: 1 }];
  }

  return [
    { hit: true, probability: accuracyRate },
    { hit: false, probability: 1 - accuracyRate },
  ];
};

const getHitPowerAtIndex = (move: SimMove, hitIndex: number) => {
  return move.power + (move.powerStep ?? 0) * (hitIndex - 1);
};

const getConditionalHitSequences = (move: SimMove) => {
  if (move.hitCount && move.hitCount > 1 && move.accuracyPerHit) {
    const accuracyRate = getAccuracyMultiplier(move);
    const sequences: Array<{ powers: number[]; probability: number }> = [];

    for (let landedHits = 1; landedHits <= move.hitCount; landedHits += 1) {
      const probability =
        landedHits === move.hitCount
          ? Math.pow(accuracyRate, move.hitCount - 1)
          : Math.pow(accuracyRate, landedHits - 1) * (1 - accuracyRate);

      sequences.push({
        powers: Array.from({ length: landedHits }, (_, index) =>
          getHitPowerAtIndex(move, index + 1)
        ),
        probability,
      });
    }

    return sequences;
  }

  if (move.hitCount && move.hitCount > 1) {
    return [
      {
        powers: Array.from({ length: move.hitCount }, (_, index) =>
          getHitPowerAtIndex(move, index + 1)
        ),
        probability: 1,
      },
    ];
  }

  if (move.minHits && move.maxHits) {
    const minHits = move.minHits;
    const maxHits = move.maxHits;
    const hitCounts = Array.from(
      { length: maxHits - minHits + 1 },
      (_, index) => minHits + index
    );
    const probabilities =
      minHits === 2 && maxHits === 5
        ? [0.35, 0.35, 0.15, 0.15]
        : hitCounts.map(() => 1 / hitCounts.length);

    return hitCounts.map((count, index) => ({
      powers: Array.from({ length: count }, () => move.power),
      probability: probabilities[index] ?? 0,
    }));
  }

  return [
    {
      powers: [move.power],
      probability: 1,
    },
  ];
};

const getRepresentativeHitPowers = (move: SimMove) => {
  const sequences = getConditionalHitSequences(move).sort((left, right) => {
    if (right.probability !== left.probability) {
      return right.probability - left.probability;
    }

    return right.powers.length - left.powers.length;
  });

  return sequences[0]?.powers ?? [move.power];
};

const getExpectedHitCount = (move: SimMove) => {
  return getConditionalHitSequences(move).reduce(
    (sum, sequence) => sum + sequence.powers.length * sequence.probability,
    0
  );
};

const getScaledDamageRolls = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove,
  isCrit: boolean,
  powerOverride = move.power
) => {
  const { attack } = getRelevantStats(attacker, move);
  const damage = calcDamage({
    level: attacker.level,
    power: powerOverride,
    attack,
    defense: getDefenseStatWithItem(defender, move.category),
    moveType: move.type,
    attackerTypes: attacker.pokemon.types,
    defenderTypes: defender.pokemon.types,
    defenderHp: defender.currentHp,
    isCrit,
  });

  const finalDamageMultiplier = getFinalDamageItemMultiplier(attacker, defender, move);
  return damage.rolls.map((roll) => Math.floor(roll * finalDamageMultiplier));
};

export const getSingleHitDamageRolls = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove,
  powerOverride = move.power
): number[] => {
  const staticDamageKey = getStaticDamageKey(attacker, defender, move, powerOverride);
  let scaledRolls = baseDamageRollCache.get(staticDamageKey);

  if (!scaledRolls) {
    const critChance = getMoveCritChance(move);
    const normalRolls = getScaledDamageRolls(attacker, defender, move, false, powerOverride);
    const critRolls = getScaledDamageRolls(attacker, defender, move, true, powerOverride);
    const critBucketCount = Math.round(critChance * CRIT_BUCKETS);
    const normalBucketCount = Math.max(0, CRIT_BUCKETS - critBucketCount);
    const builtRolls: number[] = [];

    for (let i = 0; i < normalBucketCount; i += 1) {
      builtRolls.push(...normalRolls);
    }

    for (let i = 0; i < critBucketCount; i += 1) {
      builtRolls.push(...critRolls);
    }

    if (builtRolls.length === 0) {
      builtRolls.push(...normalRolls);
    }

    scaledRolls = builtRolls.sort((left, right) => left - right);
    capCacheSize(baseDamageRollCache, MAX_BASE_DAMAGE_CACHE_SIZE);
    baseDamageRollCache.set(staticDamageKey, scaledRolls);
  }

  return scaledRolls;
};

const getRollProbabilityMap = (rolls: number[]) => {
  const distribution: DamageDistribution = new Map();

  if (rolls.length === 0) {
    distribution.set(0, 1);
    return distribution;
  }

  for (const roll of rolls) {
    distribution.set(roll, (distribution.get(roll) ?? 0) + 1 / rolls.length);
  }

  return distribution;
};

const applyDamageToDefenderState = (
  state: DefenderState,
  defender: SimBattlePokemon,
  damage: number
): DefenderState => {
  if (state.hp <= 0) {
    return state;
  }

  const focusSashActivates =
    defender.itemId === "focusSash" &&
    !state.focusSashUsed &&
    state.hp === defender.stats.hp &&
    damage >= state.hp;

  if (focusSashActivates) {
    return {
      hp: 1,
      focusSashUsed: true,
    };
  }

  return {
    hp: Math.max(0, state.hp - damage),
    focusSashUsed: state.focusSashUsed,
  };
};

const getDamageDistribution = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove
) => {
  const distributionKey = getMoveDistributionKey(attacker, defender, move);
  const cached = moveDamageDistributionCache.get(distributionKey);

  if (cached) {
    return new Map(cached);
  }

  const startHp = defender.currentHp;
  const sequenceDistributions = getConditionalHitSequences(move);
  const totalDistribution: DamageDistribution = new Map();

  for (const sequence of sequenceDistributions) {
    let stateDistribution = new Map<string, number>([
      [`${defender.currentHp}|${defender.focusSashUsed ? 1 : 0}`, 1],
    ]);

    for (const power of sequence.powers) {
      const hitRolls = getRollProbabilityMap(
        getSingleHitDamageRolls(attacker, defender, move, power)
      );
      const nextStateDistribution = new Map<string, number>();

      for (const [stateKey, stateProbability] of stateDistribution.entries()) {
        const [hpText, sashText] = stateKey.split("|");
        const state: DefenderState = {
          hp: Number(hpText),
          focusSashUsed: sashText == "1",
        };

        if (state.hp <= 0) {
          nextStateDistribution.set(
            stateKey,
            (nextStateDistribution.get(stateKey) ?? 0) + stateProbability
          );
          continue;
        }

        for (const [damage, damageProbability] of hitRolls.entries()) {
          const nextState = applyDamageToDefenderState(state, defender, damage);
          const nextStateKey = `${nextState.hp}|${nextState.focusSashUsed ? 1 : 0}`;
          nextStateDistribution.set(
            nextStateKey,
            (nextStateDistribution.get(nextStateKey) ?? 0) + stateProbability * damageProbability
          );
        }
      }

      stateDistribution = nextStateDistribution;
    }

    for (const [stateKey, stateProbability] of stateDistribution.entries()) {
      const [hpText] = stateKey.split("|");
      const remainingHp = Number(hpText);
      const totalDamage = Math.max(0, startHp - remainingHp);
      totalDistribution.set(
        totalDamage,
        (totalDistribution.get(totalDamage) ?? 0) + stateProbability * sequence.probability
      );
    }
  }

  capCacheSize(moveDamageDistributionCache, MAX_MOVE_DISTRIBUTION_CACHE_SIZE);
  moveDamageDistributionCache.set(distributionKey, Array.from(totalDistribution.entries()));

  return totalDistribution;
};

export const getDamageRolls = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove
): number[] => {
  const distribution = getDamageDistribution(attacker, defender, move);
  const rolls: number[] = [];

  for (const [damage, probability] of [...distribution.entries()].sort((left, right) => left[0] - right[0])) {
    const bucketCount = Math.max(1, Math.round(probability * 100));
    for (let index = 0; index < bucketCount; index += 1) {
      rolls.push(damage);
    }
  }

  return rolls;
};

export const getRepresentativeDamage = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove
) => {
  const distribution = [...getDamageDistribution(attacker, defender, move).entries()].sort(
    (left, right) => left[0] - right[0]
  );
  let cumulativeProbability = 0;

  for (const [damage, probability] of distribution) {
    cumulativeProbability += probability;
    if (cumulativeProbability >= 0.5) {
      return damage;
    }
  }

  return distribution[distribution.length - 1]?.[0] ?? 0;
};

export const getExpectedDamage = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove
): number => {
  const distribution = getDamageDistribution(attacker, defender, move);
  let expectedDamage = 0;

  for (const [damage, probability] of distribution.entries()) {
    expectedDamage += damage * probability;
  }

  return expectedDamage;
};

export const getKoChance = (
  distribution: DamageDistribution,
  currentHp: number
): number => {
  if (distribution.size === 0 || currentHp <= 0) {
    return 0;
  }

  let koChance = 0;
  for (const [damage, probability] of distribution.entries()) {
    if (damage >= currentHp) {
      koChance += probability;
    }
  }

  return koChance;
};

const getMovePriority = (move: SimMove) => {
  return move.priority ?? 0;
};

const getEffectiveKoChance = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove
) => {
  const distribution = getDamageDistribution(attacker, defender, move);
  return getKoChance(distribution, defender.currentHp) * getAccuracyMultiplier(move);
};

const cloneBattlePokemon = (pokemon: SimBattlePokemon): SimBattlePokemon => ({
  ...pokemon,
  evs: { ...pokemon.evs },
  ivs: { ...pokemon.ivs },
  stats: { ...pokemon.stats },
  moves: [...pokemon.moves],
  stages: { ...pokemon.stages },
});

const isChoiceItem = (itemId?: string) => {
  return itemId === "choiceBand" || itemId === "choiceSpecs" || itemId === "choiceScarf";
};

const getAvailableMoves = (pokemon: SimBattlePokemon) => {
  if (!pokemon.choiceLockedMoveId) {
    return pokemon.moves;
  }

  const lockedMove = pokemon.moves.find((move) => move.id === pokemon.choiceLockedMoveId);
  return lockedMove ? [lockedMove] : pokemon.moves;
};

const getAvailableAttackMoves = (pokemon: SimBattlePokemon) =>
  getAvailableMoves(pokemon).filter((move) => move.category !== "status" && !move.protect);

const getWeightedMovePolicyKey = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  opposingMove?: SimMove | null
) => [getEvaluationKey(attacker, defender), opposingMove?.id ?? ""].join("|");

const applyChoiceLock = (pokemon: SimBattlePokemon, move: SimMove | null) => {
  if (!move || !isChoiceItem(pokemon.itemId) || pokemon.choiceLockedMoveId) {
    return;
  }

  pokemon.choiceLockedMoveId = move.id;
};

const getRepresentativeSingleHitDamage = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove,
  powerOverride = move.power
) => {
  const rolls = getSingleHitDamageRolls(attacker, defender, move, powerOverride);
  if (rolls.length === 0) {
    return 0;
  }

  return rolls[Math.floor(rolls.length / 2)];
};

const applySelfStatChanges = (
  pokemon: SimBattlePokemon,
  move: SimMove
) => {
  if (!move.selfStatChanges || pokemon.currentHp <= 0) {
    return [];
  }

  const { nextStages, appliedChanges } = applyBattleStageChanges(
    pokemon.stages,
    move.selfStatChanges
  );
  pokemon.stages = nextStages;
  refreshEffectiveSpeed(pokemon);

  return (Object.entries(appliedChanges) as Array<[BattleStageStat, number]>).map(
    ([stat, delta]) => formatBattleStageChange(stat, delta)
  );
};

const applyTargetStatus = (
  defender: SimBattlePokemon,
  move: SimMove
) => {
  if (move.targetStatus === "burn" && canApplyBurn(defender)) {
    defender.burned = true;
    return true;
  }

  if (move.targetStatus === "paralysis" && canApplyParalysis(defender, move)) {
    defender.paralyzed = true;
    refreshEffectiveSpeed(defender);
    return true;
  }

  return false;
};

const applyProjectedMove = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove,
  willHit = true
) => {
  if (move.protect) {
    if (!attacker.protectUsedLastTurn) {
      attacker.protectActive = true;
    }
    return;
  }

  if (!willHit) {
    return;
  }

  if (move.category === "status") {
    if (!defender.protectActive) {
      applyTargetStatus(defender, move);
    }
    applySelfStatChanges(attacker, move);
    return;
  }

  if (defender.protectActive) {
    applySelfStatChanges(attacker, move);
    return;
  }

  const defenderHpBeforeHit = defender.currentHp;
  for (const power of getRepresentativeHitPowers(move)) {
    if (attacker.currentHp <= 0 || defender.currentHp <= 0) {
      break;
    }

    const defenderHpBeforeSingleHit = defender.currentHp;
    const damage = getRepresentativeSingleHitDamage(attacker, defender, move, power);
    const nextState = applyDamageToDefenderState(
      {
        hp: defender.currentHp,
        focusSashUsed: defender.focusSashUsed,
      },
      defender,
      damage
    );

    defender.currentHp = nextState.hp;
    defender.focusSashUsed = nextState.focusSashUsed;
    applyRockyHelmetDamage(
      attacker,
      defender,
      move,
      Math.max(defenderHpBeforeSingleHit - defender.currentHp, 0)
    );
  }

  const damageDealt = Math.max(defenderHpBeforeHit - defender.currentHp, 0);

  if (damageDealt > 0 && defender.currentHp > 0 && move.burnChance && move.burnChance >= 0.5 && canApplyBurn(defender)) {
    defender.burned = true;
  }

  if (move.drainRatio && damageDealt > 0 && attacker.currentHp > 0) {
    attacker.currentHp = Math.min(
      attacker.stats.hp,
      attacker.currentHp + damageDealt * move.drainRatio
    );
  }

  if (move.recoilRatio && damageDealt > 0 && attacker.currentHp > 0) {
    attacker.currentHp = Math.max(
      0,
      attacker.currentHp - Math.max(1, damageDealt * move.recoilRatio)
    );
  }

  applySelfStatChanges(attacker, move);
};

type AttackMoveMetrics = {
  move: SimMove | null;
  expectedDamage: number;
  koChance: number;
  score: number;
};

const getBestAttackMoveMetrics = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon
): AttackMoveMetrics => {
  let bestMove: SimMove | null = null;
  let bestExpectedDamage = 0;
  let bestKoChance = 0;
  let bestScore = -Infinity;

  for (const move of getAvailableAttackMoves(attacker)) {
    const expectedDamage =
      getExpectedDamage(attacker, defender, move) * getAccuracyMultiplier(move);
    const koChance = getEffectiveKoChance(attacker, defender, move);
    const score = koChance * 20_000 + expectedDamage + Math.max(getMovePriority(move), 0) * 250;

    if (score > bestScore) {
      bestMove = move;
      bestExpectedDamage = expectedDamage;
      bestKoChance = koChance;
      bestScore = score;
    }
  }

  return {
    move: bestMove,
    expectedDamage: bestExpectedDamage,
    koChance: bestKoChance,
    score: Math.max(bestScore, 0),
  };
};

const getShallowMoveScore = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove,
  opposingMove?: SimMove | null
) => {
  const accuracy = getMoveAccuracy(move);
  const priority = getMovePriority(move);
  const accuracyPenalty = (100 - accuracy) * 8;
  const fallbackThreat = getBestAttackMoveMetrics(defender, attacker);
  const referenceThreatMove = opposingMove && opposingMove.category !== "status" && !opposingMove.protect
    ? opposingMove
    : fallbackThreat.move;

  if (move.protect) {
    const blockedDamage = referenceThreatMove
      ? getExpectedDamage(defender, attacker, referenceThreatMove) * getAccuracyMultiplier(referenceThreatMove)
      : fallbackThreat.expectedDamage;

    return (
      (attacker.protectUsedLastTurn ? -60_000 : 0) +
      blockedDamage * 22 +
      fallbackThreat.koChance * 9_000 +
      (defender.burned ? getBurnDamage(defender) * 140 : 0) +
      priority * 250
    );
  }

  if (move.category === "status") {
    const projectedAttacker = cloneBattlePokemon(attacker);
    const projectedDefender = cloneBattlePokemon(defender);
    const currentBestAttack = getBestAttackMoveMetrics(attacker, defender);

    applyProjectedMove(projectedAttacker, projectedDefender, move, true);
    applyProjectedEndOfTurnEffects(projectedAttacker, projectedDefender);

    const nextBestAttack = getBestAttackMoveMetrics(projectedAttacker, projectedDefender);
    const projectedOpponentThreat =
      projectedDefender.currentHp > 0
        ? getBestAttackMoveMetrics(projectedDefender, projectedAttacker)
        : { move: null, expectedDamage: 0, koChance: 0, score: 0 };
    const offenseGain = Math.max(0, nextBestAttack.score - currentBestAttack.score);
    const defenseGain = Math.max(
      0,
      fallbackThreat.expectedDamage - projectedOpponentThreat.expectedDamage
    ) * 18;
    const speedSwingValue =
      projectedAttacker.effectiveSpeed > projectedDefender.effectiveSpeed &&
      attacker.effectiveSpeed <= defender.effectiveSpeed
        ? 8_000
        : 0;
    const burnValue =
      move.targetStatus === "burn"
        ? (getAvailableAttackMoves(defender).some((candidateMove) => candidateMove.category === "physical")
            ? defender.stats.atk * 10
            : 0) + getBurnDamage(defender) * 90
        : 0;
    const paralysisValue =
      move.targetStatus === "paralysis"
        ? (attacker.effectiveSpeed < defender.effectiveSpeed &&
            projectedAttacker.effectiveSpeed > projectedDefender.effectiveSpeed
            ? 5_000
            : 0) + fallbackThreat.expectedDamage * 10 + fallbackThreat.koChance * 6_000
        : 0;

    return (
      getAccuracyMultiplier(move) *
        (offenseGain + defenseGain + speedSwingValue + burnValue + paralysisValue + priority * 250) -
      accuracyPenalty
    );
  }

  const expectedDamage = getExpectedDamage(attacker, defender, move) * getAccuracyMultiplier(move);
  const koChance = getEffectiveKoChance(attacker, defender, move);
  const actsBeforeReference =
    referenceThreatMove ? moveActsBeforeOpponent(attacker, defender, move, referenceThreatMove) : true;
  const defenderHasPhysicalMoves = getAvailableAttackMoves(defender).some(
    (candidateMove) => candidateMove.category === "physical"
  );
  const burnBonus =
    move.burnChance && canApplyBurn(defender)
      ? move.burnChance *
        ((defenderHasPhysicalMoves ? defender.stats.atk * 8 : 0) + getBurnDamage(defender) * 30)
      : 0;
  const flinchBonus =
    move.flinchChance && actsBeforeReference
      ? move.flinchChance * (fallbackThreat.koChance * 8_000 + expectedDamage * 6)
      : 0;
  const rockyHelmetPenalty =
    defender.itemId === "rockyHelmet" && move.isContact
      ? getRockyHelmetDamage(attacker) * getExpectedHitCount(move) * 10
      : 0;
  const hpSwingBonus =
    expectedDamage * (move.drainRatio ?? 0) * 12 -
    expectedDamage * (move.recoilRatio ?? 0) * 10 -
    rockyHelmetPenalty;

  return (
    koChance * 20_000 +
    expectedDamage +
    priority * 250 +
    hpSwingBonus +
    burnBonus +
    flinchBonus -
    accuracyPenalty
  );
};

const getWeightedMoveOptions = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  opposingMove?: SimMove | null
): WeightedMoveOption[] => {
  const cacheKey = getWeightedMovePolicyKey(attacker, defender, opposingMove);
  const cached = weightedMovePolicyCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const availableMoves = getAvailableMoves(attacker);
  if (availableMoves.length === 0) {
    return [];
  }

  const scoredMoves = availableMoves.map((move) => ({
    move,
    score: getShallowMoveScore(attacker, defender, move, opposingMove),
  }));
  const maxScore = Math.max(...scoredMoves.map((entry) => entry.score));
  const weightedScores = scoredMoves.map((entry) => ({
    ...entry,
    weight: Math.exp(Math.max(-8, Math.min(0, (entry.score - maxScore) / 8_000))),
  }));
  const totalWeight = weightedScores.reduce((sum, entry) => sum + entry.weight, 0);
  const options = weightedScores.map((entry) => ({
    move: entry.move,
    score: entry.score,
    probability: totalWeight <= 0 ? 1 / weightedScores.length : entry.weight / totalWeight,
  }));

  capCacheSize(weightedMovePolicyCache, MAX_WEIGHTED_POLICY_CACHE_SIZE);
  weightedMovePolicyCache.set(cacheKey, options);

  return options;
};

const applyProjectedEndOfTurnEffects = (
  leftPokemon: SimBattlePokemon,
  rightPokemon: SimBattlePokemon
) => {
  if (leftPokemon.currentHp <= 0 || rightPokemon.currentHp <= 0) {
    return;
  }

  if (leftPokemon.burned) {
    leftPokemon.currentHp = Math.max(0, leftPokemon.currentHp - getBurnDamage(leftPokemon));
  }

  if (rightPokemon.burned) {
    rightPokemon.currentHp = Math.max(0, rightPokemon.currentHp - getBurnDamage(rightPokemon));
  }

  leftPokemon.protectUsedLastTurn = leftPokemon.protectActive;
  rightPokemon.protectUsedLastTurn = rightPokemon.protectActive;
  leftPokemon.protectActive = false;
  rightPokemon.protectActive = false;
};

const getFinishingMovePlan = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon
) : FinishingPlan => {
  let bestMove: SimMove | null = null;
  let bestFinishChance = -1;
  let bestExpectedDamage = -1;

  for (const move of getAvailableAttackMoves(attacker)) {
    const opponentOptions = getWeightedMoveOptions(defender, attacker, move);
    const expectedDamage =
      getExpectedDamage(attacker, defender, move) * getAccuracyMultiplier(move);
    let finishChance = 0;

    for (const option of opponentOptions) {
      const moveHits = getAccuracyMultiplier(move);

      if (moveActsBeforeOpponent(attacker, defender, move, option.move)) {
        const defenderKoChance =
          option.move.category === "status" || option.move.protect
            ? 0
            : getEffectiveKoChance(defender, attacker, option.move);
        const myKoChance = getEffectiveKoChance(attacker, defender, move);
        const hitThroughProtectMultiplier = option.move.protect ? 0 : 1;

        finishChance += option.probability * moveHits * myKoChance * hitThroughProtectMultiplier;
        if (myKoChance < 1 && defenderKoChance < 1) {
          finishChance +=
            option.probability *
            moveHits *
            (1 - myKoChance) *
            (1 - defenderKoChance) *
            0;
        }
      } else {
        const survivalChance =
          option.move.category === "status" || option.move.protect
            ? 1
            : 1 - getEffectiveKoChance(defender, attacker, option.move);
        const hitThroughProtectMultiplier = option.move.protect ? 0 : 1;
        finishChance +=
          option.probability *
          Math.max(survivalChance, 0) *
          moveHits *
          getEffectiveKoChance(attacker, defender, move) *
          hitThroughProtectMultiplier;
      }
    }

    if (
      finishChance > bestFinishChance ||
      (finishChance === bestFinishChance && expectedDamage > bestExpectedDamage)
    ) {
      bestMove = move;
      bestFinishChance = finishChance;
      bestExpectedDamage = expectedDamage;
    }
  }

  return {
    move: bestMove,
    finishChance: Math.max(bestFinishChance, 0),
    expectedDamage: Math.max(bestExpectedDamage, 0),
  };
};

const getProjectedTurnOutcomes = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove
): ProjectedTurnOutcome[] => {
  const opponentOptions = getWeightedMoveOptions(defender, attacker, move);
  const attackerOutcomeOptions = getProjectedMoveOutcomeOptions(move);
  const outcomes: ProjectedTurnOutcome[] = [];

  for (const option of opponentOptions) {
    const opponentOutcomeOptions = getProjectedMoveOutcomeOptions(option.move);

    for (const attackerOutcome of attackerOutcomeOptions) {
      for (const opponentOutcome of opponentOutcomeOptions) {
        const probability =
          option.probability * attackerOutcome.probability * opponentOutcome.probability;

        if (probability <= 0) {
          continue;
        }

        const projectedAttacker = cloneBattlePokemon(attacker);
        const projectedDefender = cloneBattlePokemon(defender);

        applyChoiceLock(projectedAttacker, move);
        applyChoiceLock(projectedDefender, option.move);

        if (moveActsBeforeOpponent(projectedAttacker, projectedDefender, move, option.move)) {
          applyProjectedMove(projectedAttacker, projectedDefender, move, attackerOutcome.hit);
          if (projectedAttacker.currentHp > 0 && projectedDefender.currentHp > 0) {
            applyProjectedMove(projectedDefender, projectedAttacker, option.move, opponentOutcome.hit);
          }
        } else {
          applyProjectedMove(projectedDefender, projectedAttacker, option.move, opponentOutcome.hit);
          if (projectedAttacker.currentHp > 0 && projectedDefender.currentHp > 0) {
            applyProjectedMove(projectedAttacker, projectedDefender, move, attackerOutcome.hit);
          }
        }

        applyProjectedEndOfTurnEffects(projectedAttacker, projectedDefender);
        outcomes.push({
          attacker: projectedAttacker,
          defender: projectedDefender,
          probability,
          opponentMove: option.move,
        });
      }
    }
  }

  return outcomes;
};

const moveActsBeforeOpponent = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  myMove: SimMove,
  opponentMove: SimMove
) => {
  const myPriority = getMovePriority(myMove);
  const opponentPriority = getMovePriority(opponentMove);

  if (myPriority !== opponentPriority) {
    return myPriority > opponentPriority;
  }

  if (attacker.effectiveSpeed !== defender.effectiveSpeed) {
    return attacker.effectiveSpeed > defender.effectiveSpeed;
  }

  return false;
};

const getTwoTurnPlan = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove
) => {
  const projectedTurnOutcomes = getProjectedTurnOutcomes(attacker, defender, move);
  let twoTurnKoChance = 0;
  let weightedFinisherPriorityBonus = 0;

  for (const outcome of projectedTurnOutcomes) {
    if (outcome.attacker.currentHp <= 0 || outcome.defender.currentHp <= 0) {
      continue;
    }

    const finishingPlan = getFinishingMovePlan(outcome.attacker, outcome.defender);
    if (!finishingPlan.move || finishingPlan.finishChance <= 0) {
      continue;
    }

    const weightedFinishChance = outcome.probability * finishingPlan.finishChance;
    twoTurnKoChance += weightedFinishChance;
    weightedFinisherPriorityBonus +=
      weightedFinishChance * Math.max(getMovePriority(finishingPlan.move), 0) * 1000;
  }

  return {
    twoTurnKoChance,
    twoTurnSetupScore: twoTurnKoChance * 30_000 + weightedFinisherPriorityBonus,
  };
};

export const scoreMove = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove
): MoveEvaluation => {
  if (move.category === "status" || move.protect) {
    const accuracy = getMoveAccuracy(move);
    const priority = getMovePriority(move);
    const accuracyPenalty = (100 - accuracy) * 8;
    const currentBestAttack = getBestAttackMoveMetrics(attacker, defender);
    const opponentThreat = getBestAttackMoveMetrics(defender, attacker);
    const projectedTurnOutcomes = getProjectedTurnOutcomes(attacker, defender, move);
    const chanceToUse = projectedTurnOutcomes.reduce((sum, outcome) => sum + outcome.probability, 0);

    if (chanceToUse <= 0) {
      return {
        move,
        expectedDamage: 0,
        koChance: 0,
        priority,
        accuracy,
        score: -50_000 - accuracyPenalty,
        twoTurnKoChance: 0,
        twoTurnSetupScore: 0,
      };
    }

    const aggregated = projectedTurnOutcomes.reduce(
      (sum, outcome) => {
        if (outcome.attacker.currentHp <= 0) {
          return sum;
        }

        const nextBestAttack = getBestAttackMoveMetrics(outcome.attacker, outcome.defender);
        const followUpPlan =
          outcome.attacker.currentHp > 0 && outcome.defender.currentHp > 0
            ? getFinishingMovePlan(outcome.attacker, outcome.defender)
            : { move: null, finishChance: 0, expectedDamage: 0 };
        const projectedOpponentThreat =
          outcome.defender.currentHp > 0
            ? getBestAttackMoveMetrics(outcome.defender, outcome.attacker)
            : { move: null, expectedDamage: 0, koChance: 0, score: 0 };

        sum.nextBestAttackScore += outcome.probability * nextBestAttack.score;
        sum.projectedOpponentThreat += outcome.probability * projectedOpponentThreat.expectedDamage;
        sum.followUpBonus +=
          outcome.probability *
          (followUpPlan.finishChance * 45_000 +
            followUpPlan.expectedDamage * 18 +
            (followUpPlan.move ? Math.max(getMovePriority(followUpPlan.move), 0) * 1_500 : 0));
        sum.speedSwingValue +=
          outcome.probability *
          (outcome.attacker.effectiveSpeed > outcome.defender.effectiveSpeed &&
          attacker.effectiveSpeed <= defender.effectiveSpeed
            ? 8_000
            : 0);

        return sum;
      },
      {
        nextBestAttackScore: 0,
        projectedOpponentThreat: 0,
        followUpBonus: 0,
        speedSwingValue: 0,
      }
    );
    const offenseGain = Math.max(0, aggregated.nextBestAttackScore - currentBestAttack.score);
    const defenseGain = Math.max(
      0,
      opponentThreat.expectedDamage - aggregated.projectedOpponentThreat
    ) * 18;
    const speedSwingValue = aggregated.speedSwingValue;
    const burnValue =
      move.targetStatus === "burn"
        ? (getAvailableAttackMoves(defender).some((candidateMove) => candidateMove.category === "physical")
            ? defender.stats.atk * 10
            : 0) + getBurnDamage(defender) * 90
        : 0;
    const paralysisValue =
      move.targetStatus === "paralysis"
        ? (attacker.effectiveSpeed < defender.effectiveSpeed &&
            speedSwingValue > 0
            ? 5_000
            : 0) + opponentThreat.expectedDamage * 10 + opponentThreat.koChance * 6_000
        : 0;
    const protectValue =
      move.protect
        ? (attacker.protectUsedLastTurn ? -60_000 : 0) +
          opponentThreat.expectedDamage * 22 +
          opponentThreat.koChance * 9_000 +
          (defender.burned ? getBurnDamage(defender) * 140 : 0)
        : 0;
    const score =
      offenseGain +
      aggregated.followUpBonus +
      defenseGain +
      speedSwingValue +
      burnValue +
      paralysisValue +
      protectValue +
      priority * 250 -
      accuracyPenalty;

    return {
      move,
      expectedDamage: 0,
      koChance: 0,
      priority,
      accuracy,
      score,
      twoTurnKoChance: 0,
      twoTurnSetupScore:
        offenseGain +
        aggregated.followUpBonus +
        defenseGain +
        speedSwingValue +
        burnValue +
        paralysisValue +
        protectValue,
    };
  }

  const distribution = getDamageDistribution(attacker, defender, move);
  const expectedDamage = getExpectedDamage(attacker, defender, move);
  const koChance = getKoChance(distribution, defender.currentHp);
  const accuracy = getMoveAccuracy(move);
  const priority = getMovePriority(move);
  const projectedTurnOutcomes = getProjectedTurnOutcomes(attacker, defender, move);
  const immediateWinChance = projectedTurnOutcomes.reduce(
    (sum, outcome) => sum + (outcome.attacker.currentHp > 0 && outcome.defender.currentHp <= 0 ? outcome.probability : 0),
    0
  );
  const opponentMoveOptions = getWeightedMoveOptions(defender, attacker, move);
  const weightedPreemptiveKoChance = opponentMoveOptions.reduce((sum, option) => {
    if (option.move.category === "status" || option.move.protect) {
      return sum;
    }

    if (!moveActsBeforeOpponent(attacker, defender, move, option.move)) {
      return sum + option.probability * getEffectiveKoChance(defender, attacker, option.move);
    }

    return sum;
  }, 0);
  const actsBeforeOpponentProbability = opponentMoveOptions.reduce((sum, option) => {
    return sum + (moveActsBeforeOpponent(attacker, defender, move, option.move) ? option.probability : 0);
  }, 0);
  const expectedDamageRatio = defender.currentHp <= 0 ? 0 : expectedDamage / defender.currentHp;
  const accuracyPenalty = (100 - accuracy) * 8;
  const priorityBonus = priority * 250;
  const defenderHasPhysicalMoves = getAvailableAttackMoves(defender).some(
    (candidateMove) => candidateMove.category === "physical"
  );
  const burnBonus =
    move.burnChance && canApplyBurn(defender)
      ? move.burnChance *
        ((defenderHasPhysicalMoves ? defender.stats.atk * 8 : 0) + getBurnDamage(defender) * 30)
      : 0;
  const flinchBonus =
    move.flinchChance && actsBeforeOpponentProbability > 0
      ? move.flinchChance * (weightedPreemptiveKoChance * 8000 + expectedDamageRatio * 1200) * actsBeforeOpponentProbability
      : 0;
  const rockyHelmetPenalty =
    defender.itemId === "rockyHelmet" && move.isContact
      ? getRockyHelmetDamage(attacker) * getExpectedHitCount(move) * 10
      : 0;
  const immediateRockyHelmetTradePenalty =
    defender.itemId === "rockyHelmet" && move.isContact && getRockyHelmetDamage(attacker) >= attacker.currentHp
      ? 1_100_000
      : 0;
  const hpSwingBonus =
    expectedDamage * (move.drainRatio ?? 0) * 12 -
    expectedDamage * (move.recoilRatio ?? 0) * 10 -
    rockyHelmetPenalty;
  const revengeBonus =
    actsBeforeOpponentProbability < 1 && weightedPreemptiveKoChance > 0
      ? priority * 3000 + expectedDamageRatio * 600
      : 0;
  const survivalPressurePenalty =
    actsBeforeOpponentProbability < 1 && weightedPreemptiveKoChance > 0
      ? weightedPreemptiveKoChance * 2500 - priority * 500
      : 0;
  const { twoTurnKoChance, twoTurnSetupScore } = getTwoTurnPlan(attacker, defender, move);
  const score =
    immediateWinChance * 1_000_000 +
    expectedDamage +
    priorityBonus +
    revengeBonus -
    survivalPressurePenalty -
    accuracyPenalty +
    hpSwingBonus +
    burnBonus +
    flinchBonus +
    twoTurnSetupScore -
    immediateRockyHelmetTradePenalty +
    accuracy;

  return {
    move,
    expectedDamage,
    koChance,
    priority,
    accuracy,
    score,
    twoTurnKoChance,
    twoTurnSetupScore,
  };
};

export const evaluateMoves = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon
): MoveEvaluation[] => {
  const evaluationKey = getEvaluationKey(attacker, defender);
  const cached = evaluationCache.get(evaluationKey);

  if (cached) {
    return cached;
  }

  const evaluations = attacker.moves
    .filter((move) =>
      attacker.choiceLockedMoveId ? move.id === attacker.choiceLockedMoveId : true
    )
    .map((move) => scoreMove(attacker, defender, move))
    .sort((a, b) => b.score - a.score);

  capCacheSize(evaluationCache, MAX_EVALUATION_CACHE_SIZE);
  evaluationCache.set(evaluationKey, evaluations);

  return evaluations;
};

export const chooseBestMove = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon
): SimMove | null => {
  if (attacker.moves.length === 0) {
    return null;
  }

  return evaluateMoves(attacker, defender)[0]?.move ?? null;
};
