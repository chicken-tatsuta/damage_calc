import type { EVs, Nature } from "../lib/stats";

export type PokemonPreset = {
  itemId: string;
  nature: Nature;
  evs: EVs;
  moveIds: string[];
};

const createEvs = (evs: Partial<EVs>): EVs => ({
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
  ...evs,
});

const MODEST: Nature = { name: "ひかえめ", increased: "spa", decreased: "atk" };
const TIMID: Nature = { name: "おくびょう", increased: "spe", decreased: "atk" };
const ADAMANT: Nature = { name: "いじっぱり", increased: "atk", decreased: "spa" };
const JOLLY: Nature = { name: "ようき", increased: "spe", decreased: "spa" };

export const POKEMON_PRESETS: Record<string, PokemonPreset> = {
  eiraku: {
    itemId: "choiceSpecs",
    nature: MODEST,
    evs: createEvs({ spa: 252, spe: 252, def: 4 }),
    moveIds: ["ハイドロポンプ", "ばくおんぱ", "はどうだん", "フレアソング"],
  },
  tatsuta: {
    itemId: "choiceScarf",
    nature: TIMID,
    evs: createEvs({ spa: 252, spe: 252, def: 4 }),
    moveIds: ["リーフストーム", "りゅうせいぐん", "フレアソング", "わるだくみ"],
  },
  morimitsu: {
    itemId: "lifeOrb",
    nature: TIMID,
    evs: createEvs({ spa: 252, spe: 252, def: 4 }),
    moveIds: ["オーバーヒート", "エアスラッシュ", "10まんボルト", "ゴールドラッシュ"],
  },
  takaho: {
    itemId: "assaultVest",
    nature: ADAMANT,
    evs: createEvs({ hp: 252, atk: 252, spd: 4 }),
    moveIds: ["ウッドホーン", "ストーンエッジ", "つるぎのまい", "アクセルロック"],
  },
  ume: {
    itemId: "choiceSpecs",
    nature: MODEST,
    evs: createEvs({ spa: 252, spe: 252, def: 4 }),
    moveIds: ["おにび", "10まんボルト", "ボルトチェンジ", "たたりめ"],
  },
  machida: {
    itemId: "choiceBand",
    nature: JOLLY,
    evs: createEvs({ atk: 252, spe: 252, hp: 4 }),
    moveIds: ["じしん", "アクアブレイク", "クイックターン", "かえんボール"],
  },
  touma: {
    itemId: "choiceScarf",
    nature: JOLLY,
    evs: createEvs({ atk: 252, spe: 252, hp: 4 }),
    moveIds: ["インファイト", "はたきおとす", "つるぎのまい", "ふいうち"],
  },
  morimori: {
    itemId: "assaultVest",
    nature: ADAMANT,
    evs: createEvs({ hp: 252, atk: 252, def: 4 }),
    moveIds: ["じしん", "すてみタックル", "ボディプレス", "とんぼがえり"],
  },
  ayuma: {
    itemId: "lifeOrb",
    nature: TIMID,
    evs: createEvs({ spa: 252, spe: 252, def: 4 }),
    moveIds: ["わるだくみ", "あくのはどう", "ラスターカノン", "はどうだん"],
  },
  bucchi: {
    itemId: "assaultVest",
    nature: MODEST,
    evs: createEvs({ hp: 252, def: 252, spd: 4 }),
    moveIds: ["ムーンフォース", "むしのさざめき", "サイコショック", "マジカルフレイム"],
  },
  tomoki: {
    itemId: "choiceSpecs",
    nature: TIMID,
    evs: createEvs({ spa: 252, spe: 252, def: 4 }),
    moveIds: ["れいとうビーム", "ぼうふう", "10まんボルト", "かえんほうしゃ"],
  },
  haruta: {
    itemId: "choiceBand",
    nature: JOLLY,
    evs: createEvs({ atk: 252, spe: 252, hp: 4 }),
    moveIds: ["しんそく", "じゃれつく", "かえんボール", "まもる"],
  },
  macchan: {
    itemId: "choiceBand",
    nature: JOLLY,
    evs: createEvs({ atk: 252, spe: 252, hp: 4 }),
    moveIds: ["インファイト", "バレットパンチ", "コメットパンチ", "りゅうのまい"],
  },
  micchi: {
    itemId: "choiceSpecs",
    nature: TIMID,
    evs: createEvs({ spa: 252, spe: 252, def: 4 }),
    moveIds: ["サイコキネシス", "あくのはどう", "10まんボルト", "わるだくみ"],
  },
  nishiki: {
    itemId: "focusSash",
    nature: TIMID,
    evs: createEvs({ spa: 252, spe: 252, def: 4 }),
    moveIds: ["シャドーレイ", "サイコキネシス", "フリーズドライ", "おにび"],
  },
  sena: {
    itemId: "choiceBand",
    nature: ADAMANT,
    evs: createEvs({ hp: 252, atk: 252, spd: 4 }),
    moveIds: ["であいがしら", "ボルテッカー", "アイアンヘッド", "ぶちかまし"],
  },
  ikkun: {
    itemId: "assaultVest",
    nature: ADAMANT,
    evs: createEvs({ hp: 252, atk: 252, spd: 4 }),
    moveIds: ["ストーンエッジ", "ダストシュート", "ぶちかまし", "アクセルロック"],
  },
  fuuto: {
    itemId: "choiceScarf",
    nature: JOLLY,
    evs: createEvs({ atk: 252, spe: 252, hp: 4 }),
    moveIds: ["せいなるほのお", "フレアドライブ", "メガホーン", "とんぼがえり"],
  },
  makocchan: {
    itemId: "lifeOrb",
    nature: MODEST,
    evs: createEvs({ hp: 252, spa: 252, spd: 4 }),
    moveIds: ["ムーンフォース", "サイコキネシス", "めいそう", "マジカルフレイム"],
  },
  reosan: {
    itemId: "choiceBand",
    nature: ADAMANT,
    evs: createEvs({ hp: 252, atk: 252, spd: 4 }),
    moveIds: ["ポルターガイスト", "メガホーン", "であいがしら", "まもる"],
  },
};
