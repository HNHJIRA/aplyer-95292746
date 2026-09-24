/**
 * Closed-class English word lists used for COUNTING only. These are
 * linguistic category definitions, not reference distributions: they say
 * which words belong to a category, never how often an ordinary writer uses
 * them. All entries are lowercase with straight apostrophes.
 */
const set = (s: string) => new Set(s.trim().split(/\s+/));

export const ARTICLES = set("a an the");
export const DETERMINERS = set(
  "a an the this that these those my your his her its our their some any no every each either neither much many more most few fewer little less least several all both enough such what which whose another other",
);
export const COORD_CONJ = set("and but or nor for yet so");
export const SUBORD_CONJ = set(
  "after although as because before if once since than though unless until when whenever where whereas wherever whether while",
);
export const CONJUNCTIONS = new Set([...COORD_CONJ, ...SUBORD_CONJ]);
export const PREPOSITIONS = set(
  "about above across after against along among around at before behind below beneath beside between beyond by despite down during except for from in inside into like near of off on onto out outside over past since through throughout till to toward towards under underneath until up upon with within without via per",
);
export const AUXILIARIES = set(
  "am is are was were be been being have has had having do does did will would shall should can could may might must",
);
export const MODALS = set("will would shall should can could may might must ought");
export const FIRST_SINGULAR = set("i me my mine myself");
export const FIRST_PLURAL = set("we us our ours ourselves");
export const SECOND = set("you your yours yourself yourselves");
export const THIRD = set("he him his himself she her hers herself it its itself they them their theirs themselves");
export const POSSESSIVES = set("my mine our ours your yours his her hers its their theirs");
export const PERSONAL_PRONOUNS = new Set([...FIRST_SINGULAR, ...FIRST_PLURAL, ...SECOND, ...THIRD]);
export const OTHER_PRONOUNS = set(
  "this that these those who whom whose which what someone somebody something anyone anybody anything everyone everybody everything noone nobody nothing one oneself",
);
export const PRONOUNS = new Set([...PERSONAL_PRONOUNS, ...OTHER_PRONOUNS]);
export const NEGATIONS = set("not no never none nobody nothing nowhere neither nor cannot without");
export const INTENSIFIERS = set(
  "very really extremely incredibly highly truly deeply totally completely absolutely so too quite especially particularly remarkably exceptionally",
);
export const HEDGES = set(
  "maybe perhaps possibly probably likely unlikely seem seems seemed appear appears apparently somewhat fairly rather arguably roughly approximately generally usually often sometimes guess suppose",
);
export const HEDGE_PHRASES = ["i think", "i believe", "i feel", "sort of", "kind of", "in my opinion", "to some extent", "more or less"];
export const FILLERS = set("just basically actually literally honestly like anyway well okay ok");
export const FILLER_PHRASES = ["you know", "i mean", "kind of", "sort of"];
export const CONNECTIVES = set(
  "and but or so because although though however therefore thus hence also then while whereas since unless yet moreover furthermore meanwhile otherwise instead consequently",
);
export const TRANSITIONS = set(
  "however therefore thus hence moreover furthermore additionally consequently meanwhile nevertheless nonetheless otherwise instead similarly likewise accordingly finally first second third next then subsequently ultimately overall",
);
export const TRANSITION_PHRASES = ["for example", "for instance", "in addition", "as a result", "on the other hand", "in contrast", "in fact", "in short", "that said", "even so", "after all"];
export const DISCOURSE_MARKERS = set("well so now anyway actually honestly look right okay ok still besides");
export const DISCOURSE_PHRASES = ["you know", "i mean", "to be honest", "by the way", "in any case", "that said", "mind you"];
/** Contraction suffixes after an apostrophe; "'s" is ambiguous (possessive) and handled separately. */
export const CONTRACTION_SUFFIX = /'(?:t|re|ve|ll|d|m)$/;
export const S_CONTRACTION = set("it's that's there's here's what's who's where's when's how's let's he's she's");

/** Function words = union of closed classes above. */
export const FUNCTION_WORDS = new Set([
  ...DETERMINERS,
  ...CONJUNCTIONS,
  ...PREPOSITIONS,
  ...AUXILIARIES,
  ...MODALS,
  ...PRONOUNS,
  ...set("not no to there here than as"),
]);
