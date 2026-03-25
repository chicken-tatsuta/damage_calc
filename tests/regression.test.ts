import assert from "node:assert/strict";
import test from "node:test";

import pokemons from "../src/data/pokemons.json";
import moves from "../src/data/moves.json";
import { POKEMON_PRESETS } from "../src/data/pokemonPresets";
import { clearAiCaches, chooseBestMove, evaluateMoves } from "../src/lib/ai";
import { EMPTY_BATTLE_STAGES, getEffectiveSpeed } from "../src/lib/battleStages";
import {
  simulateSingleBattle,
  simulateMatchupByRightItemCandidates,
  type SimBattlePokemon,
  type SimMove,
  type SimPokemon,
  type SimulatorInput,
} from "../src/lib/simulator";
import { calcAllStats, type EVs, type IVs, type Nature } from "../src/lib/stats";

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

const pokemonMap = new Map((pokemons as SimPokemon[]).map((pokemon) => [pokemon.id, pokemon]));
const moveMap = new Map((moves as SimMove[]).map((move) => [move.id, move]));

type InputOverrides = Partial<Omit<SimulatorInput, "pokemon">>;

const cloneEvs = (evs?: Partial<EVs>): EVs => ({
  ...DEFAULT_EVS,
  ...evs,
});

const createInput = (
  pokemonId: string,
  overrides: InputOverrides = {}
): SimulatorInput => {
  const pokemon = pokemonMap.get(pokemonId);
  assert.ok(pokemon, `missing pokemon: ${pokemonId}`);

  const preset = POKEMON_PRESETS[pokemonId];

  return {
    pokemon,
    itemId: overrides.itemId ?? preset?.itemId,
    nature: overrides.nature ?? preset?.nature,
    evs: cloneEvs(overrides.evs ?? preset?.evs),
    moveIds: [...(overrides.moveIds ?? preset?.moveIds ?? [])],
  };
};

const buildBattlePokemon = (
  side: "left" | "right",
  input: SimulatorInput
): SimBattlePokemon => {
  const evs = cloneEvs(input.evs);
  const stats = calcAllStats(input.pokemon.baseStats, evs, DEFAULT_IVS, 50, input.nature);

  return {
    side,
    level: 50,
    pokemon: input.pokemon,
    itemId: input.itemId,
    evs,
    ivs: DEFAULT_IVS,
    nature: input.nature,
    stats,
    currentHp: stats.hp,
    moves: input.moveIds
      .map((moveId) => moveMap.get(moveId))
      .filter((move): move is SimMove => Boolean(move)),
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

const withMockedRandom = <T,>(values: number[], callback: () => T): T => {
  const originalRandom = Math.random;
  let index = 0;

  Math.random = () => {
    if (values.length === 0) {
      return 0.5;
    }

    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };

  try {
    return callback();
  } finally {
    Math.random = originalRandom;
    clearAiCaches();
  }
};

const getMoveEvaluation = (
  evaluations: ReturnType<typeof evaluateMoves>,
  moveId: string
) => {
  const evaluation = evaluations.find((entry) => entry.move.id === moveId);
  assert.ok(evaluation, `missing evaluation for move: ${moveId}`);
  return evaluation;
};

test("AI chooses りゅうのまい over a shallow インファイト line when Focus Sash creates a follow-up win", () => {
  clearAiCaches();

  const attacker = buildBattlePokemon(
    "left",
    createInput("macchan", {
      itemId: "focusSash",
      moveIds: ["インファイト", "りゅうのまい"],
    })
  );
  const defender = buildBattlePokemon(
    "right",
    createInput("haruta", {
      itemId: "choiceBand",
      moveIds: ["じゃれつく", "かえんボール"],
    })
  );

  const evaluations = evaluateMoves(attacker, defender);
  const dragonDance = getMoveEvaluation(evaluations, "りゅうのまい");
  const closeCombat = getMoveEvaluation(evaluations, "インファイト");

  assert.equal(chooseBestMove(attacker, defender)?.id, "りゅうのまい");
  assert.ok(dragonDance.score > closeCombat.score);
});

test("AI can prefer りゅうのまい when the opponent may spend the turn on まもる", () => {
  clearAiCaches();

  const attacker = buildBattlePokemon(
    "left",
    createInput("macchan", {
      itemId: "focusSash",
      moveIds: ["インファイト", "りゅうのまい", "バレットパンチ"],
    })
  );
  const defender = buildBattlePokemon(
    "right",
    createInput("haruta", {
      itemId: "",
      moveIds: ["まもる", "じゃれつく"],
    })
  );

  assert.equal(chooseBestMove(attacker, defender)?.id, "りゅうのまい");
});

test("AI keeps preferring つるぎのまい over a low-odds attack in the たかほ vs たつた setup matchup", () => {
  clearAiCaches();

  const attacker = buildBattlePokemon("left", createInput("takaho"));
  const defender = buildBattlePokemon("right", createInput("tatsuta"));

  assert.equal(chooseBestMove(attacker, defender)?.id, "つるぎのまい");
});

test("AI still selects おにび in the prescribed physical shutdown matchup", () => {
  clearAiCaches();

  const attacker = buildBattlePokemon("left", createInput("ume"));
  const defender = buildBattlePokemon("right", createInput("fuuto"));

  assert.equal(chooseBestMove(attacker, defender)?.id, "おにび");
});

test("choice-locked battlers only evaluate the locked move", () => {
  clearAiCaches();

  const attacker = buildBattlePokemon(
    "left",
    createInput("macchan", {
      itemId: "choiceBand",
      moveIds: ["インファイト", "りゅうのまい"],
    })
  );
  const defender = buildBattlePokemon("right", createInput("haruta"));

  attacker.choiceLockedMoveId = "りゅうのまい";

  const evaluations = evaluateMoves(attacker, defender);

  assert.deepEqual(
    evaluations.map((entry) => entry.move.id),
    ["りゅうのまい"]
  );
});

test("multi-hit attacks break Focus Sash in one turn", () => {
  const attacker = createInput("haruta", {
    itemId: "choiceBand",
    moveIds: ["トリプルアクセル"],
  });
  const defender = createInput("nishiki", {
    itemId: "focusSash",
    moveIds: ["サイコキネシス"],
  });

  const result = withMockedRandom(Array(8).fill(0.89), () =>
    simulateSingleBattle(attacker, defender, moveMap)
  );

  assert.equal(result.winner, "left");
  assert.equal(result.turns, 1);
  assert.equal(result.endingHp.right, 0);
  assert.equal(result.moveUsage.left["トリプルアクセル"], 1);
});

test("Rocky Helmet damages contact attackers even when they score the knockout", () => {
  clearAiCaches();

  const attacker = createInput("macchan", {
    itemId: "choiceBand",
    moveIds: ["インファイト"],
  });
  const defender = createInput("ayuma", {
    itemId: "rockyHelmet",
    moveIds: ["わるだくみ"],
  });
  const previewAttacker = buildBattlePokemon("left", attacker);

  const result = withMockedRandom([0.89, 0.89, 0.89, 0.89], () =>
    simulateSingleBattle(attacker, defender, moveMap)
  );

  assert.equal(result.winner, "left");
  assert.equal(
    result.endingHp.left,
    previewAttacker.stats.hp - Math.max(1, Math.floor(previewAttacker.stats.hp / 6))
  );
});

test("unknown-item batch simulation returns one result set per candidate item", () => {
  const result = simulateMatchupByRightItemCandidates({
    left: createInput("macchan"),
    right: createInput("haruta"),
    rightItemIds: ["choiceBand", "choiceScarf"],
    moveMap,
    battleCount: 3,
  });

  assert.equal(result.byRightItem.length, 2);
  assert.deepEqual(
    result.byRightItem.map((entry) => entry.itemId),
    ["choiceBand", "choiceScarf"]
  );
  assert.equal(result.battles.length, 6);
  assert.ok(result.byRightItem.every((entry) => entry.battles.length === 3));
});
