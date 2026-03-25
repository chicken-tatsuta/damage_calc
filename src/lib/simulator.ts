import { chooseBestMove, clearAiCaches, getSingleHitDamageRolls } from "./ai";
import {
  applyBattleStageChanges,
  EMPTY_BATTLE_STAGES,
  formatBattleStageChange,
  getEffectiveSpeed,
  type BattleStageStat,
  type BattleStages,
} from "./battleStages";
import type { PokemonType } from "./damage";
import {
  calcAllStats,
  type BaseStats,
  type EVs,
  type IVs,
  type Nature,
  type StatKey,
} from "./stats";

export type MoveCategory = "physical" | "special" | "status";
export type TargetStatus = "burn" | "paralysis";

export type SimPokemon = {
  id: string;
  name: string;
  types: PokemonType[];
  baseStats: BaseStats;
};

export type SimMove = {
  id: string;
  name: string;
  type: PokemonType;
  category: MoveCategory;
  power: number;
  accuracy?: number | null;
  isContact?: boolean;
  burnChance?: number;
  flinchChance?: number;
  hitCount?: number;
  minHits?: number;
  maxHits?: number;
  accuracyPerHit?: boolean;
  powerStep?: number;
  priority?: number;
  critRank?: number;
  drainRatio?: number;
  recoilRatio?: number;
  selfStatChanges?: Partial<Record<BattleStageStat, number>>;
  targetStatus?: TargetStatus;
  protect?: boolean;
  targets: string[];
};

export type SimulatorInput = {
  pokemon: SimPokemon;
  evs: EVs;
  moveIds: string[];
  itemId?: string;
  nature?: Nature;
};

export type SimBattlePokemon = {
  side: Exclude<SimulationSide, "draw">;
  level: number;
  pokemon: SimPokemon;
  itemId?: string;
  evs: EVs;
  ivs: IVs;
  nature?: Nature;
  stats: Record<StatKey, number>;
  currentHp: number;
  moves: SimMove[];
  effectiveSpeed: number;
  stages: BattleStages;
  focusSashUsed: boolean;
  choiceLockedMoveId?: string;
  burned: boolean;
  paralyzed: boolean;
  flinched: boolean;
  protectActive: boolean;
  protectUsedLastTurn: boolean;
};

export type FirstMoveReason = "priority" | "faster" | "speedTie";

export type SimulationSide = "left" | "right" | "draw";

export type SimulationBattleResult = {
  winner: SimulationSide;
  turns: number;
  endingHp: Record<Exclude<SimulationSide, "draw">, number>;
  endingHpPercent: Record<Exclude<SimulationSide, "draw">, number>;
  firstMoveCounts: Record<Exclude<SimulationSide, "draw">, number>;
  firstMoveByReason: Record<Exclude<SimulationSide, "draw">, Record<FirstMoveReason, number>>;
  moveUsage: Record<Exclude<SimulationSide, "draw">, Record<string, number>>;
  koHitCount: Partial<Record<Exclude<SimulationSide, "draw">, number>>;
  moveKoCounts: Record<Exclude<SimulationSide, "draw">, Record<string, number>>;
  openingOrderReason: FirstMoveReason;
  openingFirstSide: Exclude<SimulationSide, "draw">;
};

export type SimulationResult = {
  battles: SimulationBattleResult[];
};

export type ItemCandidateSimulationResult = {
  itemId: string;
  battles: SimulationBattleResult[];
};

export type ItemCandidateSimulationGroup = {
  battles: SimulationBattleResult[];
  byRightItem: ItemCandidateSimulationResult[];
};

export type ProjectedBattleAction = {
  side: Exclude<SimulationSide, "draw">;
  moveId: string;
  moveName: string;
  hit: boolean;
  hitCount: number;
  hitDamages: number[];
  statusTexts: string[];
  damage: number;
  targetSide: Exclude<SimulationSide, "draw">;
  targetRemainingHp: number;
};

export type ProjectedBattleTurn = {
  turn: number;
  firstSide: Exclude<SimulationSide, "draw">;
  reason: FirstMoveReason;
  actions: ProjectedBattleAction[];
  endingHp: Record<Exclude<SimulationSide, "draw">, number>;
};

export type ProjectedBattlePlan = {
  turns: ProjectedBattleTurn[];
  winner: SimulationSide | null;
  probability: number;
};

export type ProjectedWinningPlans = {
  left: ProjectedBattlePlan | null;
  right: ProjectedBattlePlan | null;
};

type SimulateBattleArgs = {
  left: SimulatorInput;
  right: SimulatorInput;
  moveMap: Map<string, SimMove>;
  battleCount: number;
  level?: number;
};

type SimulationBattleStats = Omit<
  SimulationBattleResult,
  "winner" | "turns"
>;

type TurnMoveSelection = {
  leftMove: SimMove | null;
  rightMove: SimMove | null;
};

type TurnOrderResult = {
  first: SimBattlePokemon;
  second: SimBattlePokemon;
  firstMove: SimMove;
  secondMove: SimMove;
  reason: FirstMoveReason;
};

type ActionResult = "none" | "defenderFainted" | "attackerFainted" | "doubleFainted";
type TurnOrderOption = TurnOrderResult & { probability: number };
type ProjectedBranchState = {
  leftPokemon: SimBattlePokemon;
  rightPokemon: SimBattlePokemon;
  turns: ProjectedBattleTurn[];
  probability: number;
  winner: SimulationSide | null;
};
type ProjectedStatusOutcome = {
  leftPokemon: SimBattlePokemon;
  rightPokemon: SimBattlePokemon;
  action: ProjectedBattleAction;
  probability: number;
};

const DEFAULT_LEVEL = 50;
const MAX_TURNS = 100;
const MAX_PROJECTED_BRANCHES = 16;

const DEFAULT_IVS: IVs = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const DEFAULT_EVS: EVs = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const cloneEvs = (evs?: Partial<EVs>): EVs => ({
  hp: evs?.hp ?? DEFAULT_EVS.hp,
  atk: evs?.atk ?? DEFAULT_EVS.atk,
  def: evs?.def ?? DEFAULT_EVS.def,
  spa: evs?.spa ?? DEFAULT_EVS.spa,
  spd: evs?.spd ?? DEFAULT_EVS.spd,
  spe: evs?.spe ?? DEFAULT_EVS.spe,
});

const buildBattlePokemon = (
  side: Exclude<SimulationSide, "draw">,
  input: SimulatorInput,
  moveMap: Map<string, SimMove>,
  level: number
): SimBattlePokemon => {
  const evs = cloneEvs(input.evs);
  const stats = calcAllStats(input.pokemon.baseStats, evs, DEFAULT_IVS, level, input.nature);
  const moves = input.moveIds
    .map((moveId) => moveMap.get(moveId))
    .filter((move): move is SimMove => Boolean(move));

  return {
    side,
    level,
    pokemon: input.pokemon,
    itemId: input.itemId,
    evs,
    ivs: DEFAULT_IVS,
    nature: input.nature,
    stats,
    currentHp: stats.hp,
    moves,
    effectiveSpeed: getEffectiveSpeed(stats.spe, input.itemId, EMPTY_BATTLE_STAGES.spe, false),
    stages: { ...EMPTY_BATTLE_STAGES },
    focusSashUsed: false,
    choiceLockedMoveId: undefined,
    burned: false,
    paralyzed: false,
    flinched: false,
    protectActive: false,
    protectUsedLastTurn: false,
  };
};

const getRandomRoll = <T,>(values: T[]): T => {
  const index = Math.floor(Math.random() * values.length);
  return values[index];
};

const cloneBattlePokemon = (pokemon: SimBattlePokemon): SimBattlePokemon => ({
  ...pokemon,
  evs: { ...pokemon.evs },
  ivs: { ...pokemon.ivs },
  stats: { ...pokemon.stats },
  moves: [...pokemon.moves],
  stages: { ...pokemon.stages },
  paralyzed: pokemon.paralyzed,
  protectActive: pokemon.protectActive,
  protectUsedLastTurn: pokemon.protectUsedLastTurn,
});

const getMovePriority = (move: SimMove) => {
  return move.priority ?? 0;
};

const isChoiceItem = (itemId?: string) => {
  return itemId === "choiceBand" || itemId === "choiceSpecs" || itemId === "choiceScarf";
};

const applyChoiceLock = (pokemon: SimBattlePokemon, move: SimMove | null) => {
  if (!move || !isChoiceItem(pokemon.itemId) || pokemon.choiceLockedMoveId) {
    return;
  }

  pokemon.choiceLockedMoveId = move.id;
};

const createBattleStats = (): SimulationBattleStats => ({
  endingHp: {
    left: 0,
    right: 0,
  },
  endingHpPercent: {
    left: 0,
    right: 0,
  },
  firstMoveCounts: {
    left: 0,
    right: 0,
  },
  firstMoveByReason: {
    left: { priority: 0, faster: 0, speedTie: 0 },
    right: { priority: 0, faster: 0, speedTie: 0 },
  },
  moveUsage: {
    left: {},
    right: {},
  },
  koHitCount: {},
  moveKoCounts: {
    left: {},
    right: {},
  },
  openingOrderReason: "faster",
  openingFirstSide: "left",
});

const calcAttackDamage = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  move: SimMove,
  powerOverride = move.power
): number => {
  return getRandomRoll(getSingleHitDamageRolls(attacker, defender, move, powerOverride));
};

const doesMoveHit = (move: SimMove) => {
  const accuracy = move.accuracy ?? 100;
  if (accuracy >= 100) {
    return true;
  }

  return Math.random() * 100 < accuracy;
};

const getHitPowerAtIndex = (move: SimMove, hitIndex: number) => {
  return move.power + (move.powerStep ?? 0) * (hitIndex - 1);
};

const getRandomHitCount = (move: SimMove) => {
  if (!move.minHits || !move.maxHits) {
    return 1;
  }

  if (move.minHits === 2 && move.maxHits === 5) {
    const roll = Math.random();
    if (roll < 0.35) return 2;
    if (roll < 0.7) return 3;
    if (roll < 0.85) return 4;
    return 5;
  }

  return Math.floor(Math.random() * (move.maxHits - move.minHits + 1)) + move.minHits;
};

const getSampledHitPowers = (move: SimMove) => {
  if (move.hitCount && move.hitCount > 1 && move.accuracyPerHit) {
    const hitPowers = [getHitPowerAtIndex(move, 1)];

    for (let hitIndex = 2; hitIndex <= move.hitCount; hitIndex += 1) {
      if (!doesMoveHit(move)) {
        break;
      }

      hitPowers.push(getHitPowerAtIndex(move, hitIndex));
    }

    return hitPowers;
  }

  if (move.hitCount && move.hitCount > 1) {
    return Array.from({ length: move.hitCount }, (_, index) =>
      getHitPowerAtIndex(move, index + 1)
    );
  }

  if (move.minHits && move.maxHits) {
    const hitCount = getRandomHitCount(move);
    return Array.from({ length: hitCount }, () => move.power);
  }

  return [move.power];
};

const getRepresentativeHitPowers = (move: SimMove) => {
  if (move.hitCount && move.hitCount > 1 && move.accuracyPerHit) {
    return Array.from({ length: move.hitCount }, (_, index) =>
      getHitPowerAtIndex(move, index + 1)
    );
  }

  if (move.hitCount && move.hitCount > 1) {
    return Array.from({ length: move.hitCount }, (_, index) =>
      getHitPowerAtIndex(move, index + 1)
    );
  }

  if (move.minHits === 2 && move.maxHits === 5) {
    return Array.from({ length: 3 }, () => move.power);
  }

  if (move.minHits && move.maxHits) {
    const representativeHits = Math.floor((move.minHits + move.maxHits) / 2);
    return Array.from({ length: representativeHits }, () => move.power);
  }

  return [move.power];
};

const applyRecoveryEffects = (
  attacker: SimBattlePokemon,
  damageDealt: number,
  move: SimMove
) => {
  if (!move.drainRatio || damageDealt <= 0 || attacker.currentHp <= 0) {
    return;
  }

  const recovery = Math.floor(damageDealt * move.drainRatio);
  attacker.currentHp = Math.min(attacker.stats.hp, attacker.currentHp + recovery);
};

const applyRecoilEffects = (
  attacker: SimBattlePokemon,
  damageDealt: number,
  move: SimMove
) => {
  if (!move.recoilRatio || damageDealt <= 0 || attacker.currentHp <= 0) {
    return;
  }

  const recoil = Math.max(1, Math.floor(damageDealt * move.recoilRatio));
  attacker.currentHp = Math.max(0, attacker.currentHp - recoil);
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

const maybeApplyBurn = (
  defender: SimBattlePokemon,
  move: SimMove,
  damageDealt: number
) => {
  if (!move.burnChance || damageDealt <= 0 || !canApplyBurn(defender)) {
    return;
  }

  if (Math.random() < move.burnChance) {
    defender.burned = true;
  }
};

const maybeApplyFlinch = (
  defender: SimBattlePokemon,
  move: SimMove,
  damageDealt: number,
  canFlinchTarget: boolean
) => {
  if (!canFlinchTarget || !move.flinchChance || damageDealt <= 0 || defender.currentHp <= 0) {
    return;
  }

  if (Math.random() < move.flinchChance) {
    defender.flinched = true;
  }
};

const maybeFullyParalyzed = (pokemon: SimBattlePokemon) => {
  return pokemon.paralyzed && Math.random() < 0.25;
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
    return "やけど";
  }

  if (move.targetStatus === "paralysis" && canApplyParalysis(defender, move)) {
    defender.paralyzed = true;
    refreshEffectiveSpeed(defender);
    return "まひ";
  }

  return null;
};

const canUseProtect = (pokemon: SimBattlePokemon) => {
  return !pokemon.protectUsedLastTurn;
};

const finishTurnState = (leftPokemon: SimBattlePokemon, rightPokemon: SimBattlePokemon) => {
  leftPokemon.protectUsedLastTurn = leftPokemon.protectActive;
  rightPokemon.protectUsedLastTurn = rightPokemon.protectActive;
  leftPokemon.protectActive = false;
  rightPokemon.protectActive = false;
};

const applyEndOfTurnEffects = (
  leftPokemon: SimBattlePokemon,
  rightPokemon: SimBattlePokemon
): SimulationSide | null => {
  if (leftPokemon.currentHp <= 0 || rightPokemon.currentHp <= 0) {
    return null;
  }

  if (leftPokemon.burned) {
    leftPokemon.currentHp = Math.max(0, leftPokemon.currentHp - getBurnDamage(leftPokemon));
  }

  if (rightPokemon.burned) {
    rightPokemon.currentHp = Math.max(0, rightPokemon.currentHp - getBurnDamage(rightPokemon));
  }

  if (leftPokemon.currentHp <= 0 && rightPokemon.currentHp <= 0) {
    return "draw";
  }

  if (leftPokemon.currentHp <= 0) {
    return "right";
  }

  if (rightPokemon.currentHp <= 0) {
    return "left";
  }

  return null;
};

const applyRepresentativeEndOfTurnEffects = (
  leftPokemon: SimBattlePokemon,
  rightPokemon: SimBattlePokemon
) => {
  if (leftPokemon.currentHp <= 0 || rightPokemon.currentHp <= 0) {
    return null;
  }

  if (leftPokemon.burned) {
    leftPokemon.currentHp = Math.max(0, leftPokemon.currentHp - getBurnDamage(leftPokemon));
  }

  if (rightPokemon.burned) {
    rightPokemon.currentHp = Math.max(0, rightPokemon.currentHp - getBurnDamage(rightPokemon));
  }

  if (leftPokemon.currentHp <= 0 && rightPokemon.currentHp <= 0) {
    return "draw";
  }

  if (leftPokemon.currentHp <= 0) {
    return "right";
  }

  if (rightPokemon.currentHp <= 0) {
    return "left";
  }

  finishTurnState(leftPokemon, rightPokemon);

  return null;
};

const resolveMoveAction = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  selectedMove: SimMove,
  battleResult: Pick<SimulationBattleResult, "moveUsage" | "koHitCount" | "moveKoCounts">,
  canFlinchTarget = false
): ActionResult => {
  battleResult.moveUsage[attacker.side][selectedMove.id] =
    (battleResult.moveUsage[attacker.side][selectedMove.id] ?? 0) + 1;

  if (maybeFullyParalyzed(attacker)) {
    return "none";
  }

  if (selectedMove.protect) {
    if (canUseProtect(attacker)) {
      attacker.protectActive = true;
    }
    return "none";
  }

  if (!doesMoveHit(selectedMove)) {
    return "none";
  }

  if (selectedMove.category === "status") {
    if (!defender.protectActive) {
      applyTargetStatus(defender, selectedMove);
    }
    applySelfStatChanges(attacker, selectedMove);
    return "none";
  }

  if (defender.protectActive) {
    applySelfStatChanges(attacker, selectedMove);
    return "none";
  }

  const defenderHpBeforeMove = defender.currentHp;

  for (const power of getSampledHitPowers(selectedMove)) {
    if (attacker.currentHp <= 0 || defender.currentHp <= 0) {
      break;
    }

    const defenderHpBeforeHit = defender.currentHp;
    const damage = calcAttackDamage(attacker, defender, selectedMove, power);
    const wouldBeKo = damage >= defender.currentHp;
    const focusSashActivates =
      defender.itemId === "focusSash" &&
      !defender.focusSashUsed &&
      defender.currentHp === defender.stats.hp &&
      wouldBeKo;

    if (focusSashActivates) {
      defender.focusSashUsed = true;
      defender.currentHp = 1;
    } else {
      defender.currentHp = Math.max(0, defender.currentHp - damage);
    }

    const damageDealt = Math.max(defenderHpBeforeHit - defender.currentHp, 0);
    applyRockyHelmetDamage(attacker, defender, selectedMove, damageDealt);
    applyRecoveryEffects(attacker, damageDealt, selectedMove);
    applyRecoilEffects(attacker, damageDealt, selectedMove);

    if (attacker.currentHp <= 0) {
      if (defender.currentHp <= 0) {
        battleResult.koHitCount[attacker.side] =
          (battleResult.koHitCount[attacker.side] ?? 0) + 1;
        battleResult.moveKoCounts[attacker.side][selectedMove.id] =
          (battleResult.moveKoCounts[attacker.side][selectedMove.id] ?? 0) + 1;
        return "doubleFainted";
      }
      return "attackerFainted";
    }

    if (defender.currentHp <= 0) {
      battleResult.koHitCount[attacker.side] =
        (battleResult.koHitCount[attacker.side] ?? 0) + 1;
      battleResult.moveKoCounts[attacker.side][selectedMove.id] =
        (battleResult.moveKoCounts[attacker.side][selectedMove.id] ?? 0) + 1;
      return "defenderFainted";
    }
  }

  const totalDamageDealt = Math.max(defenderHpBeforeMove - defender.currentHp, 0);
  applySelfStatChanges(attacker, selectedMove);
  if (attacker.currentHp > 0 && defender.currentHp > 0) {
    maybeApplyBurn(defender, selectedMove, totalDamageDealt);
    maybeApplyFlinch(defender, selectedMove, totalDamageDealt, canFlinchTarget);
  }

  return "none";
};

const getRepresentativeDamage = (
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

const doesRepresentativeMoveHit = (move: SimMove) => {
  return (move.accuracy ?? 100) >= 50;
};

const applyRepresentativeAttack = (
  attacker: SimBattlePokemon,
  defender: SimBattlePokemon,
  selectedMove: SimMove,
  forcedHit?: boolean
): {
  result: ActionResult;
  action: ProjectedBattleAction;
} => {
  const willHit = forcedHit ?? doesRepresentativeMoveHit(selectedMove);

  if (selectedMove.protect) {
    const protectSuccess = canUseProtect(attacker);
    if (protectSuccess) {
      attacker.protectActive = true;
    }

    return {
      result: "none",
      action: {
        side: attacker.side,
        moveId: selectedMove.id,
        moveName: selectedMove.name,
        hit: protectSuccess,
        hitCount: 0,
        hitDamages: [],
        statusTexts: [protectSuccess ? "まもる" : "まもる失敗"],
        damage: 0,
        targetSide: defender.side,
        targetRemainingHp: defender.currentHp,
      },
    };
  }

  if (!willHit) {
    return {
      result: "none",
      action: {
        side: attacker.side,
        moveId: selectedMove.id,
        moveName: selectedMove.name,
        hit: false,
        hitCount: 0,
        hitDamages: [],
        statusTexts: [],
        damage: 0,
        targetSide: defender.side,
        targetRemainingHp: defender.currentHp,
      },
    };
  }

  if (selectedMove.category === "status") {
    const statusTexts = applySelfStatChanges(attacker, selectedMove);
    if (!defender.protectActive) {
      const targetStatusText = applyTargetStatus(defender, selectedMove);
      if (targetStatusText) {
        statusTexts.push(targetStatusText);
      }
    } else if (selectedMove.targetStatus) {
      statusTexts.push("まもる");
    }

    return {
      result: "none",
      action: {
        side: attacker.side,
        moveId: selectedMove.id,
        moveName: selectedMove.name,
        hit: true,
        hitCount: 0,
        hitDamages: [],
        statusTexts,
        damage: 0,
        targetSide: defender.side,
        targetRemainingHp: defender.currentHp,
      },
    };
  }

  if (defender.protectActive) {
    return {
      result: "none",
      action: {
        side: attacker.side,
        moveId: selectedMove.id,
        moveName: selectedMove.name,
        hit: true,
        hitCount: 0,
        hitDamages: [],
        statusTexts: [...applySelfStatChanges(attacker, selectedMove), "まもる"],
        damage: 0,
        targetSide: defender.side,
        targetRemainingHp: defender.currentHp,
      },
    };
  }

  const defenderHpBeforeHit = defender.currentHp;
  const hitDamages: number[] = [];

  for (const power of getRepresentativeHitPowers(selectedMove)) {
    if (attacker.currentHp <= 0 || defender.currentHp <= 0) {
      break;
    }

    const defenderHpBeforeSingleHit = defender.currentHp;
    const damage = getRepresentativeDamage(attacker, defender, selectedMove, power);
    const wouldBeKo = damage >= defender.currentHp;
    const focusSashActivates =
      defender.itemId === "focusSash" &&
      !defender.focusSashUsed &&
      defender.currentHp === defender.stats.hp &&
      wouldBeKo;

    if (focusSashActivates) {
      defender.focusSashUsed = true;
      defender.currentHp = 1;
    } else {
      defender.currentHp = Math.max(0, defender.currentHp - damage);
    }

    hitDamages.push(Math.max(defenderHpBeforeSingleHit - defender.currentHp, 0));
    applyRockyHelmetDamage(
      attacker,
      defender,
      selectedMove,
      Math.max(defenderHpBeforeSingleHit - defender.currentHp, 0)
    );
  }

  const damageDealt = Math.max(defenderHpBeforeHit - defender.currentHp, 0);
  applyRecoveryEffects(attacker, damageDealt, selectedMove);
  applyRecoilEffects(attacker, damageDealt, selectedMove);
  const selfStageTexts = applySelfStatChanges(attacker, selectedMove);

  const action: ProjectedBattleAction = {
    side: attacker.side,
    moveId: selectedMove.id,
    moveName: selectedMove.name,
    hit: true,
    hitCount: hitDamages.length,
    hitDamages,
    statusTexts: selfStageTexts,
    damage: damageDealt,
    targetSide: defender.side,
    targetRemainingHp: defender.currentHp,
  };

  if (defender.currentHp <= 0) {
    if (attacker.currentHp <= 0) {
      return { result: "doubleFainted", action };
    }

    return { result: "defenderFainted", action };
  }

  if (attacker.currentHp <= 0) {
    return { result: "attackerFainted", action };
  }

  return { result: "none", action };
};

const getProjectedBattleParticipants = (
  leftPokemon: SimBattlePokemon,
  rightPokemon: SimBattlePokemon,
  actingSide: Exclude<SimulationSide, "draw">
) => {
  return actingSide === "left"
    ? {
        attacker: leftPokemon,
        defender: rightPokemon,
      }
    : {
        attacker: rightPokemon,
        defender: leftPokemon,
      };
};

const branchProjectedStatusOutcomes = (
  branches: ProjectedStatusOutcome[],
  chance: number,
  statusText: string,
  actingSide: Exclude<SimulationSide, "draw">,
  canApply: (attacker: SimBattlePokemon, defender: SimBattlePokemon) => boolean,
  apply: (attacker: SimBattlePokemon, defender: SimBattlePokemon) => void
) => {
  const normalizedChance = Math.max(0, Math.min(1, chance));
  if (normalizedChance <= 0) {
    return branches;
  }

  return branches.flatMap((branch) => {
    const currentLeft = cloneBattlePokemon(branch.leftPokemon);
    const currentRight = cloneBattlePokemon(branch.rightPokemon);
    const { attacker, defender } = getProjectedBattleParticipants(
      currentLeft,
      currentRight,
      actingSide
    );

    if (!canApply(attacker, defender)) {
      return [branch];
    }

    const outcomes: ProjectedStatusOutcome[] = [];

    if (normalizedChance < 1) {
      outcomes.push({
        leftPokemon: branch.leftPokemon,
        rightPokemon: branch.rightPokemon,
        action: {
          ...branch.action,
          statusTexts: [...branch.action.statusTexts],
        },
        probability: branch.probability * (1 - normalizedChance),
      });
    }

    apply(attacker, defender);
    outcomes.push({
      leftPokemon: currentLeft,
      rightPokemon: currentRight,
      action: {
        ...branch.action,
        statusTexts: [...branch.action.statusTexts, statusText],
      },
      probability: branch.probability * normalizedChance,
    });

    return outcomes.filter((outcome) => outcome.probability > 0);
  });
};

const getProjectedStatusOutcomeOptions = (
  leftPokemon: SimBattlePokemon,
  rightPokemon: SimBattlePokemon,
  actingSide: Exclude<SimulationSide, "draw">,
  move: SimMove,
  action: ProjectedBattleAction,
  canFlinchTarget: boolean
): ProjectedStatusOutcome[] => {
  const initialBranches: ProjectedStatusOutcome[] = [
    {
      leftPokemon,
      rightPokemon,
      action: {
        ...action,
        statusTexts: [...action.statusTexts],
      },
      probability: 1,
    },
  ];

  if (action.damage <= 0) {
    return initialBranches;
  }

  const { attacker, defender } = getProjectedBattleParticipants(
    leftPokemon,
    rightPokemon,
    actingSide
  );

  if (attacker.currentHp <= 0 || defender.currentHp <= 0) {
    return initialBranches;
  }

  let branches = initialBranches;

  if (move.burnChance) {
    branches = branchProjectedStatusOutcomes(
      branches,
      move.burnChance,
      "やけど",
      actingSide,
      (_, projectedDefender) => canApplyBurn(projectedDefender),
      (_, projectedDefender) => {
        projectedDefender.burned = true;
      }
    );
  }

  if (canFlinchTarget && move.flinchChance) {
    branches = branchProjectedStatusOutcomes(
      branches,
      move.flinchChance,
      "ひるみ",
      actingSide,
      (_, projectedDefender) => projectedDefender.currentHp > 0,
      (_, projectedDefender) => {
        projectedDefender.flinched = true;
      }
    );
  }

  return branches;
};

const getTurnOrder = (
  left: SimBattlePokemon,
  right: SimBattlePokemon,
  leftMove: SimMove,
  rightMove: SimMove
): TurnOrderResult => {
  const options = getTurnOrderOptions(left, right, leftMove, rightMove);

  if (options.length === 1) {
    return options[0];
  }

  return Math.random() < 0.5 ? options[0] : options[1];
};

const getTurnOrderOptions = (
  left: SimBattlePokemon,
  right: SimBattlePokemon,
  leftMove: SimMove,
  rightMove: SimMove
): TurnOrderOption[] => {
  const leftPriority = getMovePriority(leftMove);
  const rightPriority = getMovePriority(rightMove);

  if (leftPriority > rightPriority) {
    return [
      {
        first: left,
        second: right,
        firstMove: leftMove,
        secondMove: rightMove,
        reason: "priority",
        probability: 1,
      },
    ];
  }

  if (rightPriority > leftPriority) {
    return [
      {
        first: right,
        second: left,
        firstMove: rightMove,
        secondMove: leftMove,
        reason: "priority",
        probability: 1,
      },
    ];
  }

  if (left.effectiveSpeed > right.effectiveSpeed) {
    return [
      {
        first: left,
        second: right,
        firstMove: leftMove,
        secondMove: rightMove,
        reason: "faster",
        probability: 1,
      },
    ];
  }

  if (right.effectiveSpeed > left.effectiveSpeed) {
    return [
      {
        first: right,
        second: left,
        firstMove: rightMove,
        secondMove: leftMove,
        reason: "faster",
        probability: 1,
      },
    ];
  }

  return [
    {
      first: left,
      second: right,
      firstMove: leftMove,
      secondMove: rightMove,
      reason: "speedTie",
      probability: 0.5,
    },
    {
      first: right,
      second: left,
      firstMove: rightMove,
      secondMove: leftMove,
      reason: "speedTie",
      probability: 0.5,
    },
  ];
};

const selectTurnMoves = (
  left: SimBattlePokemon,
  right: SimBattlePokemon
): TurnMoveSelection => {
  const leftMove = chooseBestMove(left, right);
  const rightMove = chooseBestMove(right, left);

  applyChoiceLock(left, leftMove);
  applyChoiceLock(right, rightMove);

  return {
    leftMove,
    rightMove,
  };
};

const getForcedWinner = (
  turnMoves: TurnMoveSelection
): SimulationSide | null => {
  if (!turnMoves.leftMove && !turnMoves.rightMove) {
    return "draw";
  }
  if (!turnMoves.leftMove) {
    return "right";
  }
  if (!turnMoves.rightMove) {
    return "left";
  }
  return null;
};

const finalizeBattle = (
  leftPokemon: SimBattlePokemon,
  rightPokemon: SimBattlePokemon,
  battleStats: SimulationBattleStats,
  winner: SimulationSide,
  turns: number
): SimulationBattleResult => {
  battleStats.endingHp.left = leftPokemon.currentHp;
  battleStats.endingHp.right = rightPokemon.currentHp;
  battleStats.endingHpPercent.left = (leftPokemon.currentHp / leftPokemon.stats.hp) * 100;
  battleStats.endingHpPercent.right = (rightPokemon.currentHp / rightPokemon.stats.hp) * 100;

  return {
    winner,
    turns,
    ...battleStats,
  };
};

const resolveTurn = (
  turn: number,
  leftPokemon: SimBattlePokemon,
  rightPokemon: SimBattlePokemon,
  attackCounts: Record<"left" | "right", number>,
  battleStats: SimulationBattleStats
): SimulationSide | null => {
  leftPokemon.flinched = false;
  rightPokemon.flinched = false;
  leftPokemon.protectActive = false;
  rightPokemon.protectActive = false;

  const turnMoves = selectTurnMoves(leftPokemon, rightPokemon);
  const forcedWinner = getForcedWinner(turnMoves);

  if (forcedWinner) {
    return forcedWinner;
  }

  if (!turnMoves.leftMove || !turnMoves.rightMove) {
    return "draw";
  }

  const order = getTurnOrder(leftPokemon, rightPokemon, turnMoves.leftMove, turnMoves.rightMove);
  battleStats.firstMoveCounts[order.first.side] += 1;
  battleStats.firstMoveByReason[order.first.side][order.reason] += 1;

  if (turn === 1) {
    battleStats.openingOrderReason = order.reason;
    battleStats.openingFirstSide = order.first.side;
  }

  attackCounts[order.first.side] += 1;
  const firstAction = resolveMoveAction(order.first, order.second, order.firstMove, battleStats, true);
  if (firstAction === "doubleFainted") {
    battleStats.koHitCount[order.first.side] = attackCounts[order.first.side];
    return "draw";
  }
  if (firstAction === "defenderFainted") {
    battleStats.koHitCount[order.first.side] = attackCounts[order.first.side];
    return order.first.side;
  }
  if (firstAction === "attackerFainted") {
    return order.second.side;
  }

  if (!order.second.flinched) {
    attackCounts[order.second.side] += 1;
    const secondAction = resolveMoveAction(order.second, order.first, order.secondMove, battleStats);
    if (secondAction === "doubleFainted") {
      battleStats.koHitCount[order.second.side] = attackCounts[order.second.side];
      return "draw";
    }
    if (secondAction === "defenderFainted") {
      battleStats.koHitCount[order.second.side] = attackCounts[order.second.side];
      return order.second.side;
    }
    if (secondAction === "attackerFainted") {
      return order.first.side;
    }
  }

  const burnWinner = applyEndOfTurnEffects(leftPokemon, rightPokemon);
  finishTurnState(leftPokemon, rightPokemon);
  if (burnWinner) {
    return burnWinner;
  }

  return null;
};

export const simulateSingleBattle = (
  left: SimulatorInput,
  right: SimulatorInput,
  moveMap: Map<string, SimMove>,
  level = DEFAULT_LEVEL
): SimulationBattleResult => {
  const leftPokemon = buildBattlePokemon("left", left, moveMap, level);
  const rightPokemon = buildBattlePokemon("right", right, moveMap, level);
  const attackCounts = {
    left: 0,
    right: 0,
  };
  const battleStats = createBattleStats();

  for (let turn = 1; turn <= MAX_TURNS; turn += 1) {
    const winner = resolveTurn(
      turn,
      leftPokemon,
      rightPokemon,
      attackCounts,
      battleStats
    );

    if (winner) {
      return finalizeBattle(leftPokemon, rightPokemon, battleStats, winner, turn);
    }
  }

  if (leftPokemon.currentHp === rightPokemon.currentHp) {
    return finalizeBattle(leftPokemon, rightPokemon, battleStats, "draw", MAX_TURNS);
  }

  return leftPokemon.currentHp > rightPokemon.currentHp
    ? finalizeBattle(leftPokemon, rightPokemon, battleStats, "left", MAX_TURNS)
    : finalizeBattle(leftPokemon, rightPokemon, battleStats, "right", MAX_TURNS);
};

export const simulateMatchup = ({
  left,
  right,
  moveMap,
  battleCount,
  level = DEFAULT_LEVEL,
}: SimulateBattleArgs): SimulationResult => {
  clearAiCaches();
  const battles: SimulationBattleResult[] = [];

  for (let i = 0; i < battleCount; i += 1) {
    battles.push(simulateSingleBattle(left, right, moveMap, level));
  }

  return { battles };
};

export const simulateMatchupByRightItemCandidates = ({
  left,
  right,
  rightItemIds,
  moveMap,
  battleCount,
  level = DEFAULT_LEVEL,
}: Omit<SimulateBattleArgs, "right"> & {
  right: SimulatorInput;
  rightItemIds: string[];
}): ItemCandidateSimulationGroup => {
  const normalizedItemIds = Array.from(
    new Set(rightItemIds.map((itemId) => itemId.trim()).filter((itemId) => itemId.length > 0))
  );
  const byRightItem: ItemCandidateSimulationResult[] = [];

  for (const itemId of normalizedItemIds) {
    clearAiCaches();

    const battles: SimulationBattleResult[] = [];
    const rightWithCandidate = {
      ...right,
      itemId,
    };

    for (let i = 0; i < battleCount; i += 1) {
      battles.push(simulateSingleBattle(left, rightWithCandidate, moveMap, level));
    }

    byRightItem.push({
      itemId,
      battles,
    });
  }

  return {
    battles: byRightItem.flatMap((entry) => entry.battles),
    byRightItem,
  };
};

const getRepresentativeMoveOutcomeOptions = (move: SimMove) => {
  const accuracy = Math.max(0, Math.min(100, move.accuracy ?? 100)) / 100;

  if (accuracy <= 0) {
    return [{ hit: false, probability: 1 }];
  }

  if (accuracy >= 1) {
    return [{ hit: true, probability: 1 }];
  }

  return [
    { hit: true, probability: accuracy },
    { hit: false, probability: 1 - accuracy },
  ].sort((a, b) => b.probability - a.probability);
};

const finalizeProjectedWinner = (
  leftPokemon: SimBattlePokemon,
  rightPokemon: SimBattlePokemon
): SimulationSide => {
  if (leftPokemon.currentHp === rightPokemon.currentHp) {
    return "draw";
  }

  return leftPokemon.currentHp > rightPokemon.currentHp ? "left" : "right";
};

const buildProjectedTurn = (
  turn: number,
  order: TurnOrderOption,
  actions: ProjectedBattleAction[],
  leftPokemon: SimBattlePokemon,
  rightPokemon: SimBattlePokemon
): ProjectedBattleTurn => ({
  turn,
  firstSide: order.first.side,
  reason: order.reason,
  actions,
  endingHp: {
    left: leftPokemon.currentHp,
    right: rightPokemon.currentHp,
  },
});

const expandProjectedBranch = (
  branch: ProjectedBranchState,
  turn: number
): ProjectedBranchState[] => {
  const leftMove = chooseBestMove(branch.leftPokemon, branch.rightPokemon);
  const rightMove = chooseBestMove(branch.rightPokemon, branch.leftPokemon);
  const forcedWinner = getForcedWinner({ leftMove, rightMove });

  if (forcedWinner) {
    return [{ ...branch, winner: forcedWinner }];
  }

  if (!leftMove || !rightMove) {
    return [{ ...branch, winner: "draw" }];
  }

  const expandedBranches: ProjectedBranchState[] = [];

  for (const order of getTurnOrderOptions(
    branch.leftPokemon,
    branch.rightPokemon,
    leftMove,
    rightMove
  )) {
    const baseLeft = cloneBattlePokemon(branch.leftPokemon);
    const baseRight = cloneBattlePokemon(branch.rightPokemon);
    baseLeft.flinched = false;
    baseRight.flinched = false;

    applyChoiceLock(baseLeft, leftMove);
    applyChoiceLock(baseRight, rightMove);

    for (const firstOutcome of getRepresentativeMoveOutcomeOptions(order.firstMove)) {
      const leftAfterFirst = cloneBattlePokemon(baseLeft);
      const rightAfterFirst = cloneBattlePokemon(baseRight);
      const firstActor = order.first.side === "left" ? leftAfterFirst : rightAfterFirst;
      const firstDefender = order.first.side === "left" ? rightAfterFirst : leftAfterFirst;
      const firstAction = applyRepresentativeAttack(
        firstActor,
        firstDefender,
        order.firstMove,
        firstOutcome.hit
      );
      const firstProbability = branch.probability * order.probability * firstOutcome.probability;

      if (firstProbability <= 0) {
        continue;
      }

      const firstStatusOutcomes =
        firstAction.result === "none"
          ? getProjectedStatusOutcomeOptions(
              leftAfterFirst,
              rightAfterFirst,
              order.first.side,
              order.firstMove,
              firstAction.action,
              true
            )
          : [
              {
                leftPokemon: leftAfterFirst,
                rightPokemon: rightAfterFirst,
                action: firstAction.action,
                probability: 1,
              },
            ];

      for (const firstStatusOutcome of firstStatusOutcomes) {
        const firstResolvedProbability = firstProbability * firstStatusOutcome.probability;
        if (firstResolvedProbability <= 0) {
          continue;
        }

        const leftAfterStatuses = cloneBattlePokemon(firstStatusOutcome.leftPokemon);
        const rightAfterStatuses = cloneBattlePokemon(firstStatusOutcome.rightPokemon);
        const firstActions = [firstStatusOutcome.action];

        if (firstAction.result === "doubleFainted") {
          expandedBranches.push({
            leftPokemon: leftAfterStatuses,
            rightPokemon: rightAfterStatuses,
            turns: [
              ...branch.turns,
              buildProjectedTurn(turn, order, firstActions, leftAfterStatuses, rightAfterStatuses),
            ],
            probability: firstResolvedProbability,
            winner: "draw",
          });
          continue;
        }

        if (firstAction.result === "defenderFainted") {
          expandedBranches.push({
            leftPokemon: leftAfterStatuses,
            rightPokemon: rightAfterStatuses,
            turns: [
              ...branch.turns,
              buildProjectedTurn(turn, order, firstActions, leftAfterStatuses, rightAfterStatuses),
            ],
            probability: firstResolvedProbability,
            winner: order.first.side,
          });
          continue;
        }

        if (firstAction.result === "attackerFainted") {
          expandedBranches.push({
            leftPokemon: leftAfterStatuses,
            rightPokemon: rightAfterStatuses,
            turns: [
              ...branch.turns,
              buildProjectedTurn(turn, order, firstActions, leftAfterStatuses, rightAfterStatuses),
            ],
            probability: firstResolvedProbability,
            winner: order.second.side,
          });
          continue;
        }

        if (order.second.side === "left" ? leftAfterStatuses.flinched : rightAfterStatuses.flinched) {
          const burnWinner = applyRepresentativeEndOfTurnEffects(leftAfterStatuses, rightAfterStatuses);
          expandedBranches.push({
            leftPokemon: leftAfterStatuses,
            rightPokemon: rightAfterStatuses,
            turns: [
              ...branch.turns,
              buildProjectedTurn(turn, order, firstActions, leftAfterStatuses, rightAfterStatuses),
            ],
            probability: firstResolvedProbability,
            winner: burnWinner,
          });
          continue;
        }

        for (const secondOutcome of getRepresentativeMoveOutcomeOptions(order.secondMove)) {
          const leftAfterSecond = cloneBattlePokemon(leftAfterStatuses);
          const rightAfterSecond = cloneBattlePokemon(rightAfterStatuses);
          const secondActor = order.second.side === "left" ? leftAfterSecond : rightAfterSecond;
          const secondDefender = order.second.side === "left" ? rightAfterSecond : leftAfterSecond;
          const secondAction = applyRepresentativeAttack(
            secondActor,
            secondDefender,
            order.secondMove,
            secondOutcome.hit
          );
          const secondProbability = firstResolvedProbability * secondOutcome.probability;

          if (secondProbability <= 0) {
            continue;
          }

          const secondStatusOutcomes =
            secondAction.result === "none"
              ? getProjectedStatusOutcomeOptions(
                  leftAfterSecond,
                  rightAfterSecond,
                  order.second.side,
                  order.secondMove,
                  secondAction.action,
                  false
                )
              : [
                  {
                    leftPokemon: leftAfterSecond,
                    rightPokemon: rightAfterSecond,
                    action: secondAction.action,
                    probability: 1,
                  },
                ];

          for (const secondStatusOutcome of secondStatusOutcomes) {
            const secondResolvedProbability =
              secondProbability * secondStatusOutcome.probability;

            if (secondResolvedProbability <= 0) {
              continue;
            }

            const leftAfterSecondStatuses = cloneBattlePokemon(secondStatusOutcome.leftPokemon);
            const rightAfterSecondStatuses = cloneBattlePokemon(secondStatusOutcome.rightPokemon);
            const actions = [...firstActions, secondStatusOutcome.action];

            let winner: SimulationSide | null = null;
            if (secondAction.result === "doubleFainted") {
              winner = "draw";
            } else if (secondAction.result === "defenderFainted") {
              winner = order.second.side;
            } else if (secondAction.result === "attackerFainted") {
              winner = order.first.side;
            } else {
              winner = applyRepresentativeEndOfTurnEffects(
                leftAfterSecondStatuses,
                rightAfterSecondStatuses
              );
            }

            expandedBranches.push({
              leftPokemon: leftAfterSecondStatuses,
              rightPokemon: rightAfterSecondStatuses,
              turns: [
                ...branch.turns,
                buildProjectedTurn(
                  turn,
                  order,
                  actions,
                  leftAfterSecondStatuses,
                  rightAfterSecondStatuses
                ),
              ],
              probability: secondResolvedProbability,
              winner,
            });
          }
        }
      }
    }
  }

  return expandedBranches;
};

export const buildStrongestWinningPlans = (
  left: SimulatorInput,
  right: SimulatorInput,
  moveMap: Map<string, SimMove>,
  level = DEFAULT_LEVEL,
  maxTurns = 5
): ProjectedWinningPlans => {
  clearAiCaches();

  let branches: ProjectedBranchState[] = [
    {
      leftPokemon: buildBattlePokemon("left", left, moveMap, level),
      rightPokemon: buildBattlePokemon("right", right, moveMap, level),
      turns: [],
      probability: 1,
      winner: null,
    },
  ];

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    branches = branches
      .flatMap((branch) => (branch.winner ? [branch] : expandProjectedBranch(branch, turn)))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, MAX_PROJECTED_BRANCHES);

    if (branches.every((branch) => branch.winner)) {
      break;
    }
  }

  const finalizedBranches = branches.map((branch) => ({
    ...branch,
    winner: branch.winner ?? finalizeProjectedWinner(branch.leftPokemon, branch.rightPokemon),
  }));

  const toProjectedPlan = (branch: ProjectedBranchState): ProjectedBattlePlan => ({
    turns: branch.turns,
    winner: branch.winner,
    probability: branch.probability,
  });

  const strongestLeft = finalizedBranches
    .filter((branch) => branch.winner === "left")
    .sort((a, b) => b.probability - a.probability)[0];
  const strongestRight = finalizedBranches
    .filter((branch) => branch.winner === "right")
    .sort((a, b) => b.probability - a.probability)[0];

  return {
    left: strongestLeft ? toProjectedPlan(strongestLeft) : null,
    right: strongestRight ? toProjectedPlan(strongestRight) : null,
  };
};

export const buildLikelyBattlePlan = (
  left: SimulatorInput,
  right: SimulatorInput,
  moveMap: Map<string, SimMove>,
  level = DEFAULT_LEVEL,
  maxTurns = 5
): ProjectedBattlePlan => {
  const strongestPlans = buildStrongestWinningPlans(left, right, moveMap, level, maxTurns);

  if (strongestPlans.left && strongestPlans.right) {
    return strongestPlans.left.probability >= strongestPlans.right.probability
      ? strongestPlans.left
      : strongestPlans.right;
  }

  return (
    strongestPlans.left ??
    strongestPlans.right ?? {
      turns: [],
      winner: "draw",
      probability: 0,
    }
  );
};
