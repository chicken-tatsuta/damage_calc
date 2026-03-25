import React, { startTransition, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Backdrop,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Collapse,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import pokemonData from "../data/pokemons.json";
import moveData from "../data/moves.json";
import { POKEMON_PRESETS } from "../data/pokemonPresets";
import { evaluateMoves } from "../lib/ai";
import { summarizeSimulationResults } from "../lib/result";
import {
  buildStrongestWinningPlans,
  simulateMatchup,
  simulateMatchupByRightItemCandidates,
  type SimBattlePokemon,
  type SimMove,
  type SimPokemon,
  type SimulatorInput,
} from "../lib/simulator";
import { EMPTY_BATTLE_STAGES, getEffectiveSpeed } from "../lib/battleStages";
import type { EVs, Nature } from "../lib/stats";
import NatureMatrixPicker, { NATURE_MATRIX } from "../components/NatureMatrixPicker";
import MovePicker from "../components/MovePicker";
import { calcAllStats } from "../lib/stats";

type StatKey = keyof EVs;

type MatchupFormState = {
  pokemonId: string | null;
  itemId: string;
  moveIds: string[];
  evs: EVs;
  nature: Nature;
};

type ItemBreakdownSummary = {
  itemId: string;
  label: string;
  summary: ReturnType<typeof summarizeSimulationResults>;
};

type MoveData = SimMove | (Omit<SimMove, "category"> & { category: "status" });

const POKEMONS = pokemonData as SimPokemon[];
const MOVES = moveData as MoveData[];
const MOVE_MAP = new Map(MOVES.map((move) => [move.id, move]));

const EMPTY_EVS: EVs = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const DEFAULT_NATURE = NATURE_MATRIX.spe.spe;

const ITEM_OPTIONS = [
  { value: "", label: "なし" },
  { value: "focusSash", label: "きあいのタスキ" },
  { value: "rockyHelmet", label: "ゴツゴツメット" },
  { value: "choiceBand", label: "こだわりハチマキ" },
  { value: "choiceSpecs", label: "こだわりメガネ" },
  { value: "choiceScarf", label: "こだわりスカーフ" },
  { value: "lifeOrb", label: "いのちのたま" },
  { value: "assaultVest", label: "とつげきチョッキ" },
  { value: "expertBelt", label: "たつじんのおび" },
] as const;

const ITEM_LABEL_MAP = new Map<string, string>(
  ITEM_OPTIONS.map((option) => [option.value, option.label])
);

const getDefaultMoveIds = (pokemonId: string | null) => {
  if (!pokemonId) return [];

  const preset = POKEMON_PRESETS[pokemonId];
  if (preset) {
    return preset.moveIds.filter((moveId) =>
      MOVES.some((move) => move.id === moveId && move.targets.includes(pokemonId))
    );
  }

  return MOVES.filter((move) => move.targets.includes(pokemonId))
    .slice(0, 4)
    .map((move) => move.id);
};

const createInitialFormState = (pokemonId: string | null = null): MatchupFormState => {
  if (!pokemonId) {
    return {
      pokemonId,
      itemId: "",
      moveIds: [],
      evs: { ...EMPTY_EVS },
      nature: DEFAULT_NATURE,
    };
  }

  const preset = POKEMON_PRESETS[pokemonId];
  if (preset) {
    return {
      pokemonId,
      itemId: preset.itemId,
      moveIds: [...getDefaultMoveIds(pokemonId)],
      evs: { ...preset.evs },
      nature: { ...preset.nature },
    };
  }

  return {
    pokemonId,
    itemId: "",
    moveIds: getDefaultMoveIds(pokemonId),
    evs: { ...EMPTY_EVS },
    nature: DEFAULT_NATURE,
  };
};

const MAX_TOTAL_EVS = 510;

const clampEv = (value: number) => {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(252, value));
};

const getTotalEvs = (evs: EVs) => {
  return Object.values(evs).reduce((sum, value) => sum + value, 0);
};

const statLabels: Record<StatKey, string> = {
  hp: "HP",
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
};

const DEFAULT_IVS = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
} as const;

const getHpBarColor = (percent: number) => {
  if (percent <= 20) return "#e53935";
  if (percent <= 50) return "#fb8c00";
  return "#43a047";
};

const getHpPercent = (value: number, max: number) => {
  if (max <= 0) return 0;
  return (value / max) * 100;
};

const TURN_REASON_LABELS = {
  priority: "優先度順",
  faster: "すばやさ順",
  speedTie: "同速想定",
} as const;

const waitForNextPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

type ProjectedActionView = {
  side: "left" | "right";
  moveName: string;
  damage: number;
  hit: boolean;
  hitCount?: number;
  hitDamages?: number[];
  statusTexts?: string[];
};

const ProjectedTurnSideCard = ({
  name,
  maxHp,
  remainingHp,
  action,
  actedFirst,
}: {
  name: string;
  maxHp: number;
  remainingHp: number;
  action?: ProjectedActionView;
  actedFirst: boolean;
}) => {
  const hpPercent = getHpPercent(remainingHp, maxHp);
  const hpBarColor = getHpBarColor(hpPercent);
  const isMultiHit = Boolean(action?.hit && (action.hitCount ?? 0) > 1);
  const actionText = !action
    ? "行動なし"
    : !action.hit
      ? `${action.moveName} は外れた！`
      : action.damage <= 0 && !(action.hitCount && action.hitCount > 1)
        ? action.moveName
      : isMultiHit
        ? `${action.moveName} ${action.hitCount}ヒットで ${action.damage.toFixed(0)} ダメージ`
        : `${action.moveName} で ${action.damage.toFixed(0)} ダメージ`;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        borderRadius: 3,
        height: "100%",
        bgcolor: "rgba(255,255,255,0.92)",
        borderColor: actedFirst ? "rgba(229,57,53,0.45)" : "rgba(0,0,0,0.08)",
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          <Typography variant="subtitle2" fontWeight={900}>
            {name}
          </Typography>
          {actedFirst ? <Chip size="small" color="error" label="先手" /> : null}
        </Stack>

        <Typography variant="body2" fontWeight={700}>
          {actionText}
        </Typography>

        {action?.statusTexts?.length ? (
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            {action.statusTexts.map((statusText) => (
              <Chip
                key={`${action.moveName}-${statusText}`}
                size="small"
                color={statusText === "ひるみ" ? "warning" : "error"}
                variant={statusText === "ひるみ" ? "outlined" : "filled"}
                label={statusText}
              />
            ))}
          </Stack>
        ) : null}

        {isMultiHit && action?.hitDamages?.length ? (
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
              <Chip size="small" color="warning" label={`${action.hitCount}ヒット`} />
              <Typography variant="caption" color="text.secondary">
                連続技
              </Typography>
            </Stack>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: `repeat(${action.hitDamages.length}, minmax(0, 1fr))`,
                gap: 0.5,
              }}
            >
              {action.hitDamages.map((damage, index) => (
                <Box
                  key={`${action.moveName}-${index}`}
                  sx={{
                    px: 0.75,
                    py: 0.35,
                    borderRadius: 999,
                    bgcolor: "rgba(251, 140, 0, 0.14)",
                    border: "1px solid rgba(251, 140, 0, 0.3)",
                    textAlign: "center",
                  }}
                >
                  <Typography variant="caption" fontWeight={800} color="warning.dark">
                    {damage.toFixed(0)}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Stack>
        ) : null}

        <Box>
          <Typography variant="caption" color="text.secondary">
            ターン終了時HP
          </Typography>
          <Box
            sx={{
              mt: 0.75,
              height: 12,
              borderRadius: 999,
              bgcolor: "rgba(0,0,0,0.08)",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                width: `${Math.max(0, Math.min(100, hpPercent))}%`,
                height: "100%",
                borderRadius: 999,
                background: `linear-gradient(90deg, ${hpBarColor} 0%, ${hpBarColor}CC 100%)`,
              }}
            />
          </Box>
          <Box sx={{ mt: 0.5, display: "flex", justifyContent: "space-between" }}>
            <Typography variant="caption" fontWeight={700}>
              {remainingHp.toFixed(0)} / {maxHp}
            </Typography>
            <Typography variant="caption" fontWeight={700}>
              {hpPercent.toFixed(1)}%
            </Typography>
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
};

const getProjectedAction = (
  actions: ProjectedActionView[],
  side: "left" | "right"
) => {
  return actions.find((entry) => entry.side === side);
};

const SummarySideCard = ({
  title,
  name,
  itemLabel,
  natureName,
  selectedMoveNames,
  winRate,
  wins,
  totalBattles,
  averageRemainingHp,
  averageRemainingHpPercent,
  averageRemainingHpPercentWhenWin,
  firstMoveRate,
  averageKoHits,
  speedTieLeadRate,
  speedTieWinRate,
  winWhenMovingFirst,
  winWhenMovingSecond,
  moveUsageText,
  moveKoText,
}: {
  title: string;
  name: string;
  itemLabel: string;
  natureName: string;
  selectedMoveNames: string[];
  winRate: number;
  wins: number;
  totalBattles: number;
  averageRemainingHp: number;
  averageRemainingHpPercent: number;
  averageRemainingHpPercentWhenWin: number;
  firstMoveRate: number;
  averageKoHits: number;
  speedTieLeadRate: number;
  speedTieWinRate: number;
  winWhenMovingFirst: number;
  winWhenMovingSecond: number;
  moveUsageText: string;
  moveKoText: string;
}) => {
  const hpBarColor = getHpBarColor(averageRemainingHpPercent);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 4,
        background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,247,251,0.98) 100%)",
      }}
    >
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2 }}>
            {title}
          </Typography>
          <Typography variant="h6" fontWeight={900}>
            {name}
          </Typography>
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
            <Chip size="small" label={itemLabel} />
            <Chip size="small" variant="outlined" label={natureName} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
            {selectedMoveNames.length > 0 ? selectedMoveNames.join(" / ") : "技なし"}
          </Typography>
        </Box>

        <Box
          sx={{
            borderRadius: 3,
            px: 2,
            py: 1.5,
            bgcolor: "rgba(25, 118, 210, 0.06)",
            border: "1px solid rgba(25, 118, 210, 0.12)",
          }}
        >
          <Typography variant="caption" color="text.secondary">
            勝率
          </Typography>
          <Typography variant="h4" fontWeight={900} lineHeight={1.1}>
            {winRate.toFixed(1)}%
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {wins} / {totalBattles} 勝
          </Typography>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary">
            平均残HP
          </Typography>
          <Box
            sx={{
              mt: 0.75,
              height: 16,
              borderRadius: 999,
              bgcolor: "rgba(0,0,0,0.08)",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                width: `${Math.max(0, Math.min(100, averageRemainingHpPercent))}%`,
                height: "100%",
                borderRadius: 999,
                background: `linear-gradient(90deg, ${hpBarColor} 0%, ${hpBarColor}CC 100%)`,
              }}
            />
          </Box>
          <Box sx={{ mt: 0.75, display: "flex", justifyContent: "space-between" }}>
            <Typography variant="body2" fontWeight={700}>
              {averageRemainingHp.toFixed(1)} HP
            </Typography>
            <Typography variant="body2" fontWeight={700}>
              {averageRemainingHpPercent.toFixed(1)}%
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            勝利時平均残HP {averageRemainingHpPercentWhenWin.toFixed(1)}%
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Chip size="small" label={`初手先手率 ${firstMoveRate.toFixed(1)}%`} />
          <Chip size="small" label={`平均撃破打数 ${averageKoHits.toFixed(2)}`} />
          <Chip size="small" label={`同速先手 ${speedTieLeadRate.toFixed(1)}%`} />
          <Chip size="small" label={`同速勝率 ${speedTieWinRate.toFixed(1)}%`} />
        </Stack>

        <Box
          sx={{
            p: 1.25,
            borderRadius: 3,
            bgcolor: "rgba(0,0,0,0.025)",
          }}
        >
          <Typography variant="caption" color="text.secondary">
            勝ち筋
          </Typography>
          <Typography variant="body2">
            初手先行勝ち {winWhenMovingFirst} / 初手後攻勝ち {winWhenMovingSecond}
          </Typography>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary">
            技使用率
          </Typography>
          <Typography variant="body2">{moveUsageText}</Typography>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary">
            KO技内訳
          </Typography>
          <Typography variant="body2">{moveKoText}</Typography>
        </Box>
      </Stack>
    </Paper>
  );
};

const ItemBreakdownCard = ({
  itemLabel,
  summary,
  selected,
  onClick,
}: {
  itemLabel: string;
  summary: ReturnType<typeof summarizeSimulationResults>;
  selected?: boolean;
  onClick?: () => void;
}) => {
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 1.5,
        borderRadius: 3,
        background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,247,251,0.98) 100%)",
        cursor: onClick ? "pointer" : "default",
        borderColor: selected ? "primary.main" : undefined,
        boxShadow: selected ? "0 0 0 1px rgba(25, 118, 210, 0.16)" : "none",
        transition: "border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease",
        "&:hover": onClick
          ? {
              borderColor: "primary.main",
              transform: "translateY(-1px)",
            }
          : undefined,
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2" fontWeight={900}>
            {itemLabel}
          </Typography>
          <Chip size="small" variant="outlined" label={`${summary.totalBattles}戦`} />
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
          <Typography variant="body2" fontWeight={800}>
            左 {summary.leftWinRate.toFixed(1)}%
          </Typography>
          <Typography variant="body2" fontWeight={800}>
            右 {summary.rightWinRate.toFixed(1)}%
          </Typography>
          <Typography variant="caption" color="text.secondary">
            平均 {summary.averageTurns.toFixed(2)}T
          </Typography>
        </Stack>
        {onClick ? (
          <Typography variant="caption" color="text.secondary">
            押すとこの持ち物前提の勝ち筋を表示
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
};


const buildSimulatorInput = (
  form: MatchupFormState,
  fallbackPokemon: SimPokemon
): SimulatorInput => {
  const pokemon = POKEMONS.find((candidate) => candidate.id === form.pokemonId) ?? fallbackPokemon;

  return {
    pokemon,
    evs: form.evs,
    moveIds: form.moveIds,
    itemId: form.itemId || undefined,
    nature: form.nature,
  };
};

const buildPreviewBattlePokemon = (
  side: "left" | "right",
  input: SimulatorInput
): SimBattlePokemon => {
  const stats = calcAllStats(input.pokemon.baseStats, input.evs, DEFAULT_IVS, 50, input.nature);
  const moves = input.moveIds
    .map((moveId) => MOVE_MAP.get(moveId))
    .filter((move): move is SimMove => Boolean(move));

  return {
    side,
    level: 50,
    pokemon: input.pokemon,
    itemId: input.itemId,
    evs: input.evs,
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

const MatchupPokemonCard = ({
  title,
  form,
  onFormChange,
  useItemCandidates = false,
  onUseItemCandidatesChange,
  itemCandidateIds = [],
  onItemCandidateIdsChange,
}: {
  title: string;
  form: MatchupFormState;
  onFormChange: (next: MatchupFormState) => void;
  useItemCandidates?: boolean;
  onUseItemCandidatesChange?: (checked: boolean) => void;
  itemCandidateIds?: string[];
  onItemCandidateIdsChange?: (itemIds: string[]) => void;
}) => {
  const selectedPokemon = useMemo(
    () => POKEMONS.find((pokemon) => pokemon.id === form.pokemonId) ?? null,
    [form.pokemonId]
  );

  const allAvailableMoves = useMemo(() => {
    if (!selectedPokemon) {
      return [];
    }

    return MOVES.filter((move) => move.targets.includes(selectedPokemon.id));
  }, [selectedPokemon]);

  const selectedMoves = useMemo(
    () =>
      form.moveIds
        .map((moveId) => MOVE_MAP.get(moveId))
        .filter((move): move is SimMove => Boolean(move)),
    [form.moveIds]
  );

  const totalEvs = useMemo(() => getTotalEvs(form.evs), [form.evs]);
  const itemCandidateOptions = useMemo(
    () => ITEM_OPTIONS.filter((option) => option.value !== ""),
    []
  );
  const selectedItemCandidates = useMemo(
    () =>
      itemCandidateIds
        .map((itemId) => itemCandidateOptions.find((option) => option.value === itemId) ?? null)
        .filter((option): option is (typeof itemCandidateOptions)[number] => Boolean(option)),
    [itemCandidateIds, itemCandidateOptions]
  );

  const updateEv = (stat: StatKey, rawValue: string) => {
    const nextValue = clampEv(parseInt(rawValue || "0", 10));
    const otherTotal = totalEvs - form.evs[stat];
    const allowedValue = Math.max(0, Math.min(nextValue, MAX_TOTAL_EVS - otherTotal));

    onFormChange({
      ...form,
      evs: {
        ...form.evs,
        [stat]: allowedValue,
      },
    });
  };

  return (
    <Card sx={{ height: "100%" }}>
      <CardHeader title={title} subheader="Lv.50 / 6V固定 / 一部持ち物に対応" />
      <CardContent>
        <Stack spacing={2}>
          <Autocomplete
            options={POKEMONS}
            value={selectedPokemon}
            onChange={(_, value) => onFormChange(createInitialFormState(value?.id ?? null))}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={(params) => <TextField {...params} label="ポケモン" size="small" />}
          />

          {onUseItemCandidatesChange ? (
            <FormControlLabel
              control={
                <Switch
                  checked={useItemCandidates}
                  onChange={(_, checked) => onUseItemCandidatesChange(checked)}
                />
              }
              label="相手持ち物候補モード"
            />
          ) : null}

          {useItemCandidates && onItemCandidateIdsChange ? (
            <Autocomplete
              multiple
              options={itemCandidateOptions}
              value={selectedItemCandidates}
              disableCloseOnSelect
              onChange={(_, values) =>
                onItemCandidateIdsChange(values.slice(0, 4).map((option) => option.value))
              }
              getOptionLabel={(option) => option.label}
              isOptionEqualToValue={(option, value) => option.value === value.value}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="持ち物候補"
                  size="small"
                  helperText="候補を最大4つまで選べます。各候補を等確率で別集計します"
                />
              )}
            />
          ) : (
            <TextField
              select
              label="持ち物"
              size="small"
              value={form.itemId}
              onChange={(event) => onFormChange({ ...form, itemId: event.target.value })}
            >
              {ITEM_OPTIONS.map((option) => (
                <MenuItem key={option.value || "none"} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          )}

          <NatureMatrixPicker
            value={form.nature}
            onChange={(nature) => onFormChange({ ...form, nature })}
          />

          <MovePicker
            multiple
            options={allAvailableMoves}
            value={selectedMoves}
            onChange={(moves) =>
              onFormChange({
                ...form,
                moveIds: moves.slice(0, 4).map((move) => move.id),
              })
            }
            label="技4つ"
            helperText="攻撃技と一部変化技に対応。タイプで絞り込みできます"
          />
          <Divider />

          <Box>
            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
              努力値 ({totalEvs}/{MAX_TOTAL_EVS})
            </Typography>
            <Grid container spacing={1.5}>
              {(Object.keys(form.evs) as StatKey[]).map((stat) => (
                <Grid key={stat} size={{ xs: 6, sm: 4 }}>
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label={statLabels[stat]}
                    value={form.evs[stat]}
                    onChange={(event) => updateEv(stat, event.target.value)}
                    inputProps={{ min: 0, max: 252, step: 4 }}
                  />
                </Grid>
              ))}
            </Grid>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              合計努力値は 510 までです。超える入力は自動で調整されます。
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

const MatchupSimulatorPage: React.FC = () => {
  const [leftForm, setLeftForm] = useState<MatchupFormState>(() => createInitialFormState("macchan"));
  const [rightForm, setRightForm] = useState<MatchupFormState>(() => createInitialFormState("haruta"));
  const [useRightItemCandidates, setUseRightItemCandidates] = useState(false);
  const [rightItemCandidateIds, setRightItemCandidateIds] = useState<string[]>([]);
  const [battleCount, setBattleCount] = useState(100);
  const [errorMessage, setErrorMessage] = useState("");
  const [summary, setSummary] = useState<ReturnType<typeof summarizeSimulationResults> | null>(null);
  const [itemBreakdownSummaries, setItemBreakdownSummaries] = useState<ItemBreakdownSummary[]>([]);
  const [selectedRightItemDetailId, setSelectedRightItemDetailId] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [openWinningPlans, setOpenWinningPlans] = useState({
    left: false,
    right: false,
  });
  const moveNameMap = useMemo(
    () => new Map(MOVES.map((move) => [move.id, move.name])),
    []
  );
  const leftPokemonName = useMemo(
    () => POKEMONS.find((pokemon) => pokemon.id === leftForm.pokemonId)?.name ?? "左側",
    [leftForm.pokemonId]
  );
  const rightPokemonName = useMemo(
    () => POKEMONS.find((pokemon) => pokemon.id === rightForm.pokemonId)?.name ?? "右側",
    [rightForm.pokemonId]
  );
  const leftSelectedMoveNames = useMemo(
    () => leftForm.moveIds.map((moveId) => moveNameMap.get(moveId) ?? moveId),
    [leftForm.moveIds, moveNameMap]
  );
  const rightSelectedMoveNames = useMemo(
    () => rightForm.moveIds.map((moveId) => moveNameMap.get(moveId) ?? moveId),
    [rightForm.moveIds, moveNameMap]
  );
  const normalizedRightItemCandidateIds = useMemo(
    () => Array.from(new Set(rightItemCandidateIds.filter((itemId) => itemId.length > 0))),
    [rightItemCandidateIds]
  );
  const previewRightItemId = useMemo(() => {
    if (!useRightItemCandidates) {
      return rightForm.itemId;
    }

    return normalizedRightItemCandidateIds[0] ?? rightForm.itemId;
  }, [normalizedRightItemCandidateIds, rightForm.itemId, useRightItemCandidates]);
  const previewInputs = useMemo(() => {
    const fallbackPokemon = POKEMONS[0];
    if (!fallbackPokemon) return null;

    return {
      left: buildSimulatorInput(leftForm, fallbackPokemon),
      right: buildSimulatorInput(
        {
          ...rightForm,
          itemId: previewRightItemId,
        },
        fallbackPokemon
      ),
    };
  }, [leftForm, previewRightItemId, rightForm]);
  const aiPreview = useMemo(() => {
    if (useRightItemCandidates) return null;
    if (!previewInputs) return null;

    const leftBattlePokemon = buildPreviewBattlePokemon("left", previewInputs.left);
    const rightBattlePokemon = buildPreviewBattlePokemon("right", previewInputs.right);

    return {
      left: evaluateMoves(leftBattlePokemon, rightBattlePokemon)[0] ?? null,
      right: evaluateMoves(rightBattlePokemon, leftBattlePokemon)[0] ?? null,
    };
  }, [previewInputs, useRightItemCandidates]);
  const previewMaxHp = useMemo(() => {
    if (!previewInputs) return null;

    const leftBattlePokemon = buildPreviewBattlePokemon("left", previewInputs.left);
    const rightBattlePokemon = buildPreviewBattlePokemon("right", previewInputs.right);

    return {
      left: leftBattlePokemon.stats.hp,
      right: rightBattlePokemon.stats.hp,
    };
  }, [previewInputs]);
  const strongestWinningPlans = useMemo(() => {
    if (useRightItemCandidates) return null;
    if (!previewInputs) return null;

    return buildStrongestWinningPlans(previewInputs.left, previewInputs.right, MOVE_MAP);
  }, [previewInputs, useRightItemCandidates]);
  const selectedRightItemDetail = useMemo(() => {
    if (!useRightItemCandidates) return null;

    const selectedSummary = itemBreakdownSummaries.find(
      (entry) => entry.itemId === selectedRightItemDetailId
    );
    const fallbackPokemon = POKEMONS[0];

    if (!selectedSummary || !fallbackPokemon) {
      return null;
    }

    const leftInput = buildSimulatorInput(leftForm, fallbackPokemon);
    const rightInput = buildSimulatorInput(
      {
        ...rightForm,
        itemId: selectedSummary.itemId,
      },
      fallbackPokemon
    );
    const leftBattlePokemon = buildPreviewBattlePokemon("left", leftInput);
    const rightBattlePokemon = buildPreviewBattlePokemon("right", rightInput);

    return {
      itemId: selectedSummary.itemId,
      itemLabel: selectedSummary.label,
      summary: selectedSummary.summary,
      strongestWinningPlans: buildStrongestWinningPlans(leftInput, rightInput, MOVE_MAP),
      previewMaxHp: {
        left: leftBattlePokemon.stats.hp,
        right: rightBattlePokemon.stats.hp,
      },
    };
  }, [itemBreakdownSummaries, leftForm, rightForm, selectedRightItemDetailId, useRightItemCandidates]);

  const canSimulate =
    Boolean(leftForm.pokemonId) &&
    Boolean(rightForm.pokemonId) &&
    leftForm.moveIds.length > 0 &&
    rightForm.moveIds.length > 0 &&
    (!useRightItemCandidates || normalizedRightItemCandidateIds.length > 0);

  const handleUseRightItemCandidatesChange = (checked: boolean) => {
    setUseRightItemCandidates(checked);

    if (checked && rightItemCandidateIds.length === 0 && rightForm.itemId) {
      setRightItemCandidateIds([rightForm.itemId]);
    }

    if (!checked) {
      setSelectedRightItemDetailId(null);
    }
  };

  const runSimulation = async () => {
    if (!canSimulate) {
      setErrorMessage("左右のポケモンと攻撃技を最低1つずつ設定してください。");
      return;
    }

    const fallbackPokemon = POKEMONS[0];
    if (!fallbackPokemon) {
      setErrorMessage("ポケモンデータが見つかりません。");
      return;
    }

    setIsSimulating(true);
    setErrorMessage("");
    await waitForNextPaint();

    try {
      const leftInput = buildSimulatorInput(leftForm, fallbackPokemon);
      const rightInput = buildSimulatorInput(rightForm, fallbackPokemon);
      const totalBattleCount = Math.max(1, battleCount);

      if (useRightItemCandidates) {
        const result = simulateMatchupByRightItemCandidates({
          left: leftInput,
          right: rightInput,
          rightItemIds: normalizedRightItemCandidateIds,
          moveMap: MOVE_MAP,
          battleCount: totalBattleCount,
        });

        startTransition(() => {
          const nextBreakdowns = result.byRightItem.map((entry) => ({
              itemId: entry.itemId,
              label: ITEM_LABEL_MAP.get(entry.itemId) ?? entry.itemId,
              summary: summarizeSimulationResults(entry.battles),
            }));

          setSummary(summarizeSimulationResults(result.battles));
          setItemBreakdownSummaries(nextBreakdowns);
          setSelectedRightItemDetailId((current) =>
            nextBreakdowns.some((entry) => entry.itemId === current)
              ? current
              : nextBreakdowns[0]?.itemId ?? null
          );
        });
      } else {
        const result = simulateMatchup({
          left: leftInput,
          right: rightInput,
          moveMap: MOVE_MAP,
          battleCount: totalBattleCount,
        });

        startTransition(() => {
          setSummary(summarizeSimulationResults(result.battles));
          setItemBreakdownSummaries([]);
          setSelectedRightItemDetailId(null);
        });
      }
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Backdrop
        open={isSimulating}
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          color: "#fff",
          backdropFilter: "blur(4px)",
        }}
      >
        <Stack spacing={1.5} alignItems="center">
          <CircularProgress color="inherit" />
          <Typography variant="h6" fontWeight={900}>
            シミュレーション中...
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.85 }}>
            試行回数が多いと少し時間がかかります
          </Typography>
        </Stack>
      </Backdrop>

      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h5" fontWeight={900}>
            対面勝率シミュレーション
          </Typography>
          <Typography variant="body2" color="text.secondary">
            1vs1 / Lv.50 / 6V固定。各ターンで最大期待打点の技を選んで殴り合います。
          </Typography>
        </Box>

        {errorMessage ? <Alert severity="warning">{errorMessage}</Alert> : null}

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <MatchupPokemonCard title="左側ポケモン" form={leftForm} onFormChange={setLeftForm} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <MatchupPokemonCard
              title="右側ポケモン"
              form={rightForm}
              onFormChange={setRightForm}
              useItemCandidates={useRightItemCandidates}
              onUseItemCandidatesChange={handleUseRightItemCandidatesChange}
              itemCandidateIds={rightItemCandidateIds}
              onItemCandidateIdsChange={setRightItemCandidateIds}
            />
          </Grid>
        </Grid>

        <Card>
          <CardHeader title="シミュレーション実行" />
          <CardContent>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
              <TextField
                label="試行回数"
                size="small"
                type="number"
                value={battleCount}
                onChange={(event) => setBattleCount(Math.max(1, parseInt(event.target.value || "1", 10)))}
                inputProps={{ min: 1, step: 1000 }}
                sx={{ width: 180 }}
                disabled={isSimulating}
              />
              <Button
                variant="contained"
                onClick={runSimulation}
                disabled={!canSimulate || isSimulating}
              >
                {isSimulating ? "シミュレーション中..." : "シミュレーションGO!"}
              </Button>
              {isSimulating ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={18} />
                  <Typography variant="body2" color="text.secondary">
                    勝率を計算しています
                  </Typography>
                </Stack>
              ) : null}
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="結果"
            subheader={
              useRightItemCandidates
                ? "右側の持ち物候補ごとの勝率と、候補をまとめた総合勝率を表示します"
                : "勝率と残HPを中心に見える形へ整理"
            }
          />
          <CardContent>
            {summary ? (
              <Stack spacing={2}>
                {useRightItemCandidates ? (
                  <Alert severity="info">
                    持ち物候補モードでは、右側の候補ごとに同数試行して総合結果を出しています。AI想定技と勝ち筋表示は単一持ち物前提なので非表示です。
                  </Alert>
                ) : null}
                <Grid container spacing={2} alignItems="stretch">
                  <Grid size={{ xs: 12, lg: 5 }}>
                    <SummarySideCard
                      title="LEFT"
                      name={leftPokemonName}
                      itemLabel={ITEM_LABEL_MAP.get(leftForm.itemId) ?? "なし"}
                      natureName={leftForm.nature.name}
                      selectedMoveNames={leftSelectedMoveNames}
                      winRate={summary.leftWinRate}
                      wins={summary.leftWins}
                      totalBattles={summary.totalBattles}
                      averageRemainingHp={summary.left.averageRemainingHp}
                      averageRemainingHpPercent={summary.left.averageRemainingHpPercent}
                      averageRemainingHpPercentWhenWin={summary.left.averageRemainingHpPercentWhenWin}
                      firstMoveRate={summary.left.firstMoveRate}
                      averageKoHits={summary.left.averageKoHits}
                      speedTieLeadRate={summary.left.speedTieLeadRate}
                      speedTieWinRate={summary.left.speedTieWinRate}
                      winWhenMovingFirst={summary.left.winWhenMovingFirst}
                      winWhenMovingSecond={summary.left.winWhenMovingSecond}
                      moveUsageText={
                        summary.left.moveUsageRates.length > 0
                          ? summary.left.moveUsageRates
                              .slice(0, 4)
                              .map(
                                (entry) =>
                                  `${moveNameMap.get(entry.moveId) ?? entry.moveId} ${entry.rate.toFixed(1)}%`
                              )
                              .join(" / ")
                          : "なし"
                      }
                      moveKoText={
                        summary.left.moveKoRates.length > 0
                          ? summary.left.moveKoRates
                              .slice(0, 4)
                              .map(
                                (entry) =>
                                  `${moveNameMap.get(entry.moveId) ?? entry.moveId} ${entry.koRate.toFixed(1)}%`
                              )
                              .join(" / ")
                          : "なし"
                      }
                    />
                    {aiPreview?.left ? (
                      <Paper variant="outlined" sx={{ mt: 1.5, p: 1.5, borderRadius: 3 }}>
                        <Typography variant="caption" color="text.secondary">
                          AI想定技
                        </Typography>
                        <Typography variant="body2" fontWeight={800}>
                          {aiPreview.left.move.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          期待ダメ {aiPreview.left.expectedDamage.toFixed(1)} / KO率 {(aiPreview.left.koChance * 100).toFixed(1)}% / 2手勝ち筋 {(aiPreview.left.twoTurnKoChance * 100).toFixed(1)}% / 命中 {aiPreview.left.accuracy}% / 優先度 {aiPreview.left.priority} / score {aiPreview.left.score.toFixed(1)}
                        </Typography>
                      </Paper>
                    ) : null}
                  </Grid>

                  <Grid size={{ xs: 12, lg: 2 }}>
                    <Paper
                      variant="outlined"
                      sx={{
                        height: "100%",
                        minHeight: 240,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 4,
                        background:
                          "radial-gradient(circle at top, rgba(229,57,53,0.12), transparent 40%), linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,247,251,0.98) 100%)",
                      }}
                    >
                      <Stack spacing={1.5} alignItems="center">
                        <Typography variant="overline" color="text.secondary">
                          MATCHUP
                        </Typography>
                        <Typography variant="h3" fontWeight={900} color="primary.main">
                          VS
                        </Typography>
                        <Chip label={`平均 ${summary.averageTurns.toFixed(2)}T`} />
                        <Chip label={`引き分け ${summary.draws}`} variant="outlined" />
                        {useRightItemCandidates ? (
                          <Chip
                            label={`右候補 ${normalizedRightItemCandidateIds.length}件`}
                            color="secondary"
                            variant="outlined"
                          />
                        ) : null}
                      </Stack>
                    </Paper>
                  </Grid>

                  <Grid size={{ xs: 12, lg: 5 }}>
                    <SummarySideCard
                      title="RIGHT"
                      name={rightPokemonName}
                      itemLabel={
                        useRightItemCandidates
                          ? `持ち物候補 ${normalizedRightItemCandidateIds.length}件`
                          : ITEM_LABEL_MAP.get(rightForm.itemId) ?? "なし"
                      }
                      natureName={rightForm.nature.name}
                      selectedMoveNames={rightSelectedMoveNames}
                      winRate={summary.rightWinRate}
                      wins={summary.rightWins}
                      totalBattles={summary.totalBattles}
                      averageRemainingHp={summary.right.averageRemainingHp}
                      averageRemainingHpPercent={summary.right.averageRemainingHpPercent}
                      averageRemainingHpPercentWhenWin={summary.right.averageRemainingHpPercentWhenWin}
                      firstMoveRate={summary.right.firstMoveRate}
                      averageKoHits={summary.right.averageKoHits}
                      speedTieLeadRate={summary.right.speedTieLeadRate}
                      speedTieWinRate={summary.right.speedTieWinRate}
                      winWhenMovingFirst={summary.right.winWhenMovingFirst}
                      winWhenMovingSecond={summary.right.winWhenMovingSecond}
                      moveUsageText={
                        summary.right.moveUsageRates.length > 0
                          ? summary.right.moveUsageRates
                              .slice(0, 4)
                              .map(
                                (entry) =>
                                  `${moveNameMap.get(entry.moveId) ?? entry.moveId} ${entry.rate.toFixed(1)}%`
                              )
                              .join(" / ")
                          : "なし"
                      }
                      moveKoText={
                        summary.right.moveKoRates.length > 0
                          ? summary.right.moveKoRates
                              .slice(0, 4)
                              .map(
                                (entry) =>
                                  `${moveNameMap.get(entry.moveId) ?? entry.moveId} ${entry.koRate.toFixed(1)}%`
                              )
                              .join(" / ")
                          : "なし"
                      }
                    />
                    {aiPreview?.right ? (
                      <Paper variant="outlined" sx={{ mt: 1.5, p: 1.5, borderRadius: 3 }}>
                        <Typography variant="caption" color="text.secondary">
                          AI想定技
                        </Typography>
                        <Typography variant="body2" fontWeight={800}>
                          {aiPreview.right.move.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          期待ダメ {aiPreview.right.expectedDamage.toFixed(1)} / KO率 {(aiPreview.right.koChance * 100).toFixed(1)}% / 2手勝ち筋 {(aiPreview.right.twoTurnKoChance * 100).toFixed(1)}% / 命中 {aiPreview.right.accuracy}% / 優先度 {aiPreview.right.priority} / score {aiPreview.right.score.toFixed(1)}
                        </Typography>
                      </Paper>
                    ) : null}
                  </Grid>
                </Grid>

                {itemBreakdownSummaries.length > 0 ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderRadius: 4,
                      background:
                        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,247,251,0.98) 100%)",
                    }}
                  >
                    <Stack spacing={1.5}>
                      <Box>
                        <Typography variant="subtitle1" fontWeight={900}>
                          相手持ち物別勝率
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          スカーフなら負ける、タスキなら勝てる、といった差をここで見ます
                        </Typography>
                      </Box>
                      <Grid container spacing={1.5}>
                        {itemBreakdownSummaries.map((entry) => (
                          <Grid key={entry.itemId} size={{ xs: 12, sm: 6, lg: 4 }}>
                            <ItemBreakdownCard
                              itemLabel={entry.label}
                              summary={entry.summary}
                              selected={entry.itemId === selectedRightItemDetailId}
                              onClick={() =>
                                setSelectedRightItemDetailId((current) =>
                                  current === entry.itemId ? null : entry.itemId
                                )
                              }
                            />
                          </Grid>
                        ))}
                      </Grid>
                    </Stack>
                  </Paper>
                ) : null}

                {selectedRightItemDetail?.strongestWinningPlans ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderRadius: 4,
                      background:
                        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,247,251,0.98) 100%)",
                    }}
                  >
                    <Stack spacing={1.5}>
                      <Box>
                        <Typography variant="subtitle1" fontWeight={900}>
                          {selectedRightItemDetail.itemLabel} 前提の勝ち筋
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          その持ち物が判明した前提で、左右それぞれで最も太い勝ち筋を表示します
                        </Typography>
                      </Box>

                      {(
                        [
                          {
                            side: "left" as const,
                            title: `${leftPokemonName} の勝ち筋`,
                            plan: selectedRightItemDetail.strongestWinningPlans.left,
                          },
                          {
                            side: "right" as const,
                            title: `${rightPokemonName} の勝ち筋`,
                            plan: selectedRightItemDetail.strongestWinningPlans.right,
                          },
                        ] as const
                      ).map(({ side, title, plan }) => (
                        <Paper
                          key={`candidate-${selectedRightItemDetail.itemId}-${side}`}
                          variant="outlined"
                          sx={{ p: 1.5, borderRadius: 3, bgcolor: "rgba(0,0,0,0.02)" }}
                        >
                          <Stack spacing={1.25}>
                            <Stack
                              direction={{ xs: "column", sm: "row" }}
                              spacing={1}
                              alignItems={{ sm: "center" }}
                              justifyContent="space-between"
                            >
                              <Box>
                                <Typography variant="subtitle2" fontWeight={900}>
                                  {title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {plan
                                    ? `分岐確率 ${(plan.probability * 100).toFixed(1)}%`
                                    : "この条件では太い勝ち筋を作れていません"}
                                </Typography>
                              </Box>

                              <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                                {plan ? (
                                  <Chip
                                    size="small"
                                    label={`想定勝者 ${
                                      side === "left" ? leftPokemonName : rightPokemonName
                                    }`}
                                  />
                                ) : null}
                                <Button
                                  size="small"
                                  variant={openWinningPlans[side] ? "contained" : "outlined"}
                                  onClick={() =>
                                    setOpenWinningPlans((current) => ({
                                      ...current,
                                      [side]: !current[side],
                                    }))
                                  }
                                  disabled={!plan}
                                >
                                  {openWinningPlans[side] ? "閉じる" : "開く"}
                                </Button>
                              </Stack>
                            </Stack>

                            <Collapse in={openWinningPlans[side] && Boolean(plan)} timeout="auto" unmountOnExit>
                              <Stack spacing={1.25}>
                                {plan?.turns.map((turn) => (
                                  <Paper
                                    key={`candidate-${selectedRightItemDetail.itemId}-${side}-${turn.turn}`}
                                    variant="outlined"
                                    sx={{ p: 1.5, borderRadius: 3, bgcolor: "rgba(255,255,255,0.92)" }}
                                  >
                                    <Stack spacing={1}>
                                      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                                        <Typography variant="subtitle2" fontWeight={900}>
                                          {turn.turn}ターン目
                                        </Typography>
                                        <Chip
                                          size="small"
                                          label={`先手 ${
                                            turn.firstSide === "left" ? leftPokemonName : rightPokemonName
                                          }`}
                                        />
                                        <Chip
                                          size="small"
                                          variant="outlined"
                                          label={TURN_REASON_LABELS[turn.reason]}
                                        />
                                      </Stack>

                                      <Grid container spacing={1.5}>
                                        <Grid size={{ xs: 12, md: 6 }}>
                                          <ProjectedTurnSideCard
                                            name={leftPokemonName}
                                            maxHp={selectedRightItemDetail.previewMaxHp.left}
                                            remainingHp={turn.endingHp.left}
                                            action={getProjectedAction(turn.actions, "left")}
                                            actedFirst={turn.firstSide === "left"}
                                          />
                                        </Grid>
                                        <Grid size={{ xs: 12, md: 6 }}>
                                          <ProjectedTurnSideCard
                                            name={rightPokemonName}
                                            maxHp={selectedRightItemDetail.previewMaxHp.right}
                                            remainingHp={turn.endingHp.right}
                                            action={getProjectedAction(turn.actions, "right")}
                                            actedFirst={turn.firstSide === "right"}
                                          />
                                        </Grid>
                                      </Grid>
                                    </Stack>
                                  </Paper>
                                ))}
                              </Stack>
                            </Collapse>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  </Paper>
                ) : null}

                {strongestWinningPlans ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderRadius: 4,
                      background:
                        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,247,251,0.98) 100%)",
                    }}
                  >
                    <Stack spacing={1.5}>
                      <Box>
                        <Typography variant="subtitle1" fontWeight={900}>
                          勝ち筋ターン進行
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          左右それぞれで最も太い勝ち筋だけを表示します
                        </Typography>
                      </Box>

                      {(
                        [
                          {
                            side: "left" as const,
                            title: `${leftPokemonName} の勝ち筋`,
                            plan: strongestWinningPlans.left,
                          },
                          {
                            side: "right" as const,
                            title: `${rightPokemonName} の勝ち筋`,
                            plan: strongestWinningPlans.right,
                          },
                        ] as const
                      ).map(({ side, title, plan }) => (
                        <Paper
                          key={side}
                          variant="outlined"
                          sx={{ p: 1.5, borderRadius: 3, bgcolor: "rgba(0,0,0,0.02)" }}
                        >
                          <Stack spacing={1.25}>
                            <Stack
                              direction={{ xs: "column", sm: "row" }}
                              spacing={1}
                              alignItems={{ sm: "center" }}
                              justifyContent="space-between"
                            >
                              <Box>
                                <Typography variant="subtitle2" fontWeight={900}>
                                  {title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {plan
                                    ? `分岐確率 ${(plan.probability * 100).toFixed(1)}%`
                                    : "この条件では太い勝ち筋を作れていません"}
                                </Typography>
                              </Box>

                              <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                                {plan ? (
                                  <Chip
                                    size="small"
                                    label={`想定勝者 ${
                                      side === "left" ? leftPokemonName : rightPokemonName
                                    }`}
                                  />
                                ) : null}
                                <Button
                                  size="small"
                                  variant={openWinningPlans[side] ? "contained" : "outlined"}
                                  onClick={() =>
                                    setOpenWinningPlans((current) => ({
                                      ...current,
                                      [side]: !current[side],
                                    }))
                                  }
                                  disabled={!plan}
                                >
                                  {openWinningPlans[side] ? "閉じる" : "開く"}
                                </Button>
                              </Stack>
                            </Stack>

                            <Collapse in={openWinningPlans[side] && Boolean(plan)} timeout="auto" unmountOnExit>
                              <Stack spacing={1.25}>
                                {plan?.turns.map((turn) => (
                                  <Paper
                                    key={`${side}-${turn.turn}`}
                                    variant="outlined"
                                    sx={{ p: 1.5, borderRadius: 3, bgcolor: "rgba(255,255,255,0.92)" }}
                                  >
                                    <Stack spacing={1}>
                                      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                                        <Typography variant="subtitle2" fontWeight={900}>
                                          {turn.turn}ターン目
                                        </Typography>
                                        <Chip
                                          size="small"
                                          label={`先手 ${
                                            turn.firstSide === "left" ? leftPokemonName : rightPokemonName
                                          }`}
                                        />
                                        <Chip
                                          size="small"
                                          variant="outlined"
                                          label={TURN_REASON_LABELS[turn.reason]}
                                        />
                                      </Stack>

                                      <Grid container spacing={1.5}>
                                        <Grid size={{ xs: 12, md: 6 }}>
                                          <ProjectedTurnSideCard
                                            name={leftPokemonName}
                                            maxHp={previewMaxHp?.left ?? 0}
                                            remainingHp={turn.endingHp.left}
                                            action={getProjectedAction(turn.actions, "left")}
                                            actedFirst={turn.firstSide === "left"}
                                          />
                                        </Grid>
                                        <Grid size={{ xs: 12, md: 6 }}>
                                          <ProjectedTurnSideCard
                                            name={rightPokemonName}
                                            maxHp={previewMaxHp?.right ?? 0}
                                            remainingHp={turn.endingHp.right}
                                            action={getProjectedAction(turn.actions, "right")}
                                            actedFirst={turn.firstSide === "right"}
                                          />
                                        </Grid>
                                      </Grid>
                                    </Stack>
                                  </Paper>
                                ))}
                              </Stack>
                            </Collapse>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  </Paper>
                ) : null}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                入力後にシミュレーションを実行すると結果を表示します。
              </Typography>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
};

export default MatchupSimulatorPage;
