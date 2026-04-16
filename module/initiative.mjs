const SW1E_SCOPE = "sw1e";
const PERSONAL_ACTOR_TYPES = new Set(["character", "npc"]);
const STARSHIP_ACTOR_TYPES = new Set(["starship"]);
const TRACKED_ACTOR_TYPES = new Set([...PERSONAL_ACTOR_TYPES, ...STARSHIP_ACTOR_TYPES]);
const STARSHIP_DEFAULT_FIRE_SEGMENTS = 2;
const REACTION_ACTIONS = new Set(["dodge", "melee parry", "brawling parry", "lightsaber parry"]);
const REACTION_DEFENSE_PROFILES = {
  dodge: {
    normalized: "dodge",
    categories: ["blaster", "ranged", "grenade"]
  },
  "melee parry": {
    normalized: "melee parry",
    categories: ["melee"]
  },
  "brawling parry": {
    normalized: "brawling parry",
    categories: ["brawling"]
  },
  "lightsaber parry": {
    normalized: "lightsaber parry",
    categories: ["melee", "blaster"]
  }
};

function normalizeName(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clampInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const safe = Number(value);
  if (!Number.isFinite(safe)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(safe)));
}

export function isReactionActionLabel(label = "") {
  return REACTION_ACTIONS.has(normalizeName(label));
}

function getReactionDefenseProfile(label = "") {
  return REACTION_DEFENSE_PROFILES[normalizeName(label)] ?? null;
}

export function isSW1EPersonalCombatant(combatant) {
  return PERSONAL_ACTOR_TYPES.has(combatant?.actor?.type);
}

export function isSW1EStarshipCombatant(combatant) {
  return STARSHIP_ACTOR_TYPES.has(combatant?.actor?.type);
}

export function isSW1ETrackedCombatant(combatant) {
  return TRACKED_ACTOR_TYPES.has(combatant?.actor?.type);
}

export function getSW1ECombatMode(combat) {
  const combatants = combat ? [...(combat.combatants?.contents ?? [])] : [];
  if (!combatants.length) return null;

  const hasPersonal = combatants.some(isSW1EPersonalCombatant);
  const hasStarship = combatants.some(isSW1EStarshipCombatant);
  const allTracked = combatants.every(isSW1ETrackedCombatant);

  if (!allTracked) return null;
  if (hasPersonal && hasStarship) return "mixed";
  if (hasPersonal) return "personal";
  if (hasStarship) return "starship";
  return null;
}

export function isSW1ETrackedCombat(combat) {
  return !!getSW1ECombatMode(combat);
}

export function isSW1EPersonalCombat(combat) {
  return getSW1ECombatMode(combat) === "personal";
}

export function isSW1EStarshipCombat(combat) {
  return getSW1ECombatMode(combat) === "starship";
}

export function isSW1EMixedCombat(combat) {
  return getSW1ECombatMode(combat) === "mixed";
}

function defaultCombatantState(existing = {}) {
  return {
    declaredActions: clampInt(existing.declaredActions, { min: 0, max: 10, fallback: 1 }),
    reactionsUsed: clampInt(existing.reactionsUsed, { min: 0, max: 10, fallback: 0 }),
    actedThisSegment: Boolean(existing.actedThisSegment),
    completedActions: clampInt(existing.completedActions, { min: 0, max: 20, fallback: 0 })
  };
}

function defaultCombatState(existing = {}) {
  return {
    mode: "personal",
    segment: clampInt(existing.segment, { min: 1, max: 20, fallback: 1 }),
    maxSegments: clampInt(existing.maxSegments, { min: 1, max: 20, fallback: 1 })
  };
}

export function getCombatantState(combatant) {
  return defaultCombatantState(combatant?.getFlag?.(SW1E_SCOPE, "turnState") ?? {});
}

export function getCombatState(combat) {
  return defaultCombatState(combat?.getFlag?.(SW1E_SCOPE, "combatState") ?? {});
}

function getStarshipFireSegments(combatant) {
  return clampInt(combatant?.getFlag?.(SW1E_SCOPE, "turnState")?.declaredActions, { min: 0, max: 10, fallback: STARSHIP_DEFAULT_FIRE_SEGMENTS });
}

function getDisplayedDeclaredActions(combat, combatant) {
  return isSW1EStarshipCombat(combat) ? getStarshipFireSegments(combatant) : getCombatantState(combatant).declaredActions;
}

function isCombatantEligibleForSegment(combat, combatant, segment) {
  if (!combatant) return false;
  if (isSW1EStarshipCombat(combat)) {
    if (segment <= 2) return true;
    return getStarshipFireSegments(combatant) >= (segment - 2);
  }
  return getCombatantState(combatant).declaredActions >= segment;
}

function getCombatCollectionOrder(combat) {
  const combatants = [...(combat?.combatants?.contents ?? [])];
  if (!combatants.length) return combatants;

  const hasSort = combatants.every(c => Number.isFinite(Number(c.sort)));
  if (hasSort) {
    return combatants.sort((a, b) => {
      const delta = Number(a.sort) - Number(b.sort);
      if (delta !== 0) return delta;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  }

  if (combat?.turns?.length) return [...combat.turns];
  return combatants;
}

export function getCombatantsInSW1EOrder(combat) {
  const combatants = getCombatCollectionOrder(combat);
  return combatants.sort((a, b) => {
    const aInit = Number.isFinite(Number(a.initiative)) ? Number(a.initiative) : null;
    const bInit = Number.isFinite(Number(b.initiative)) ? Number(b.initiative) : null;
    if (aInit !== null || bInit !== null) {
      const delta = (bInit ?? -Infinity) - (aInit ?? -Infinity);
      if (delta !== 0) return delta;
    }
    const sortDelta = (Number(a.sort) || 0) - (Number(b.sort) || 0);
    if (sortDelta !== 0) return sortDelta;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

export function getCurrentSegmentEligibleCombatants(combat, segment = null) {
  const mode = getSW1ECombatMode(combat);
  if (!mode) return [];

  const currentSegment = segment ?? getCombatState(combat).segment;
  return getCombatantsInSW1EOrder(combat).filter(combatant => isCombatantEligibleForSegment(combat, combatant, currentSegment));
}

export function getMaxDeclaredActions(combat) {
  const mode = getSW1ECombatMode(combat);
  if (!combat?.combatants?.size) return mode === "starship" ? 2 : 1;
  if (mode === "starship") {
    return Math.max(2, 2 + Math.max(0, ...[...combat.combatants].map(getStarshipFireSegments)));
  }
  return Math.max(1, ...[...combat.combatants].map(combatant => getCombatantState(combatant).declaredActions));
}

async function updateCombatState(combat, updates = {}) {
  const merged = foundry.utils.mergeObject(getCombatState(combat), updates, { inplace: false, insertKeys: true, insertValues: true });
  await combat.setFlag(SW1E_SCOPE, "combatState", merged);
  return merged;
}

async function updateCombatantState(combatant, updates = {}) {
  const merged = foundry.utils.mergeObject(getCombatantState(combatant), updates, { inplace: false, insertKeys: true, insertValues: true });
  await combatant.setFlag(SW1E_SCOPE, "turnState", merged);
  return merged;
}

function buildCombatantStateUpdate(combatant, updates = {}) {
  return {
    _id: combatant.id,
    [`flags.${SW1E_SCOPE}.turnState`]: foundry.utils.mergeObject(getCombatantState(combatant), updates, { inplace: false, insertKeys: true, insertValues: true })
  };
}

function getCombatTurnIndex(combat, combatantId) {
  return combat?.turns?.findIndex(turn => turn.id === combatantId) ?? -1;
}

function getFirstEligibleTurnIndex(combat, segment = null) {
  const eligible = getCurrentSegmentEligibleCombatants(combat, segment);
  if (!eligible.length) return -1;
  return getCombatTurnIndex(combat, eligible[0].id);
}

function getNextPendingCombatant(combat) {
  const state = getCombatState(combat);
  const eligible = getCurrentSegmentEligibleCombatants(combat, state.segment).filter(combatant => !getCombatantState(combatant).actedThisSegment);
  if (!eligible.length) return null;

  const orderedIds = getCombatantsInSW1EOrder(combat).map(combatant => combatant.id);
  const currentIndex = orderedIds.indexOf(combat?.combatant?.id);

  const afterCurrent = eligible.find(combatant => orderedIds.indexOf(combatant.id) > currentIndex);
  return afterCurrent ?? eligible[0];
}

export async function syncSW1EInitiativeOrder(combat) {
  if (!isSW1ETrackedCombat(combat)) return combat;

  const ordered = getCombatCollectionOrder(combat);
  const count = ordered.length;
  const updates = ordered.map((combatant, index) => ({
    _id: combatant.id,
    initiative: count - index
  }));

  if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
  return combat;
}

export async function initializeSW1EPersonalCombat(combat, { preserveDeclarations = true } = {}) {
  if (!isSW1EPersonalCombat(combat)) return combat;

  await syncSW1EInitiativeOrder(combat);

  const combatantUpdates = [...combat.combatants].map(combatant => {
    const existing = getCombatantState(combatant);
    return {
      _id: combatant.id,
      [`flags.${SW1E_SCOPE}.turnState`]: {
        declaredActions: preserveDeclarations ? existing.declaredActions : 1,
        reactionsUsed: 0,
        actedThisSegment: false,
        completedActions: 0
      }
    };
  });

  if (combatantUpdates.length) await combat.updateEmbeddedDocuments("Combatant", combatantUpdates);

  const maxSegments = getMaxDeclaredActions(combat);
  await updateCombatState(combat, { mode: "personal", segment: 1, maxSegments });

  const firstTurn = getFirstEligibleTurnIndex(combat, 1);
  if (firstTurn >= 0) await combat.update({ turn: firstTurn });
  return combat;
}

export async function initializeSW1EStarshipCombat(combat, { preserveDeclarations = true } = {}) {
  if (!isSW1EStarshipCombat(combat)) return combat;

  await syncSW1EInitiativeOrder(combat);

  const combatantUpdates = [...combat.combatants].map(combatant => {
    const existingRaw = combatant.getFlag?.(SW1E_SCOPE, "turnState") ?? {};
    const fireSegments = preserveDeclarations
      ? clampInt(existingRaw.declaredActions, { min: 0, max: 10, fallback: STARSHIP_DEFAULT_FIRE_SEGMENTS })
      : STARSHIP_DEFAULT_FIRE_SEGMENTS;

    return {
      _id: combatant.id,
      [`flags.${SW1E_SCOPE}.turnState`]: {
        declaredActions: fireSegments,
        reactionsUsed: 0,
        actedThisSegment: false,
        completedActions: 0
      }
    };
  });

  if (combatantUpdates.length) await combat.updateEmbeddedDocuments("Combatant", combatantUpdates);

  const maxSegments = getMaxDeclaredActions(combat);
  await updateCombatState(combat, { mode: "starship", segment: 1, maxSegments });

  const firstTurn = getFirstEligibleTurnIndex(combat, 1);
  if (firstTurn >= 0) await combat.update({ turn: firstTurn });
  return combat;
}

export async function initializeSW1EMixedCombat(combat, { preserveDeclarations = true } = {}) {
  if (!isSW1EMixedCombat(combat)) return combat;

  await syncSW1EInitiativeOrder(combat);

  const combatantUpdates = [...combat.combatants].map(combatant => {
    const existingRaw = combatant.getFlag?.(SW1E_SCOPE, "turnState") ?? {};
    const defaultActions = isSW1EStarshipCombatant(combatant) ? STARSHIP_DEFAULT_FIRE_SEGMENTS : 1;
    const declaredActions = preserveDeclarations
      ? clampInt(existingRaw.declaredActions, { min: 1, max: 10, fallback: defaultActions })
      : defaultActions;

    return {
      _id: combatant.id,
      [`flags.${SW1E_SCOPE}.turnState`]: {
        declaredActions,
        reactionsUsed: 0,
        actedThisSegment: false,
        completedActions: 0
      }
    };
  });

  if (combatantUpdates.length) await combat.updateEmbeddedDocuments("Combatant", combatantUpdates);

  const maxSegments = getMaxDeclaredActions(combat);
  await updateCombatState(combat, { mode: "mixed", segment: 1, maxSegments });

  const firstTurn = getFirstEligibleTurnIndex(combat, 1);
  if (firstTurn >= 0) await combat.update({ turn: firstTurn });
  return combat;
}

export async function initializeSW1ETrackedCombat(combat, options = {}) {
  if (isSW1EPersonalCombat(combat)) return initializeSW1EPersonalCombat(combat, options);
  if (isSW1EStarshipCombat(combat)) return initializeSW1EStarshipCombat(combat, options);
  if (isSW1EMixedCombat(combat)) return initializeSW1EMixedCombat(combat, options);
  return combat;
}

async function advanceToSegment(combat, segment) {
  const maxSegments = getMaxDeclaredActions(combat);
  if (segment > maxSegments) return resetSW1ERound(combat, { incrementRound: true });

  const combatantUpdates = [...combat.combatants].map(combatant => buildCombatantStateUpdate(combatant, { actedThisSegment: false }));
  if (combatantUpdates.length) await combat.updateEmbeddedDocuments("Combatant", combatantUpdates);

  await updateCombatState(combat, { segment, maxSegments });

  const firstTurn = getFirstEligibleTurnIndex(combat, segment);
  if (firstTurn >= 0) await combat.update({ turn: firstTurn });
  return combat;
}

export async function resetSW1ERound(combat, { incrementRound = false } = {}) {
  if (!isSW1ETrackedCombat(combat)) return combat;

  const combatantUpdates = [...combat.combatants].map(combatant => {
    const state = getCombatantState(combatant);
    return {
      _id: combatant.id,
      [`flags.${SW1E_SCOPE}.turnState`]: {
        declaredActions: state.declaredActions,
        reactionsUsed: 0,
        actedThisSegment: false,
        completedActions: 0
      }
    };
  });

  if (combatantUpdates.length) await combat.updateEmbeddedDocuments("Combatant", combatantUpdates);

  const maxSegments = getMaxDeclaredActions(combat);
  await updateCombatState(combat, { segment: 1, maxSegments });

  const updateData = {};
  if (incrementRound) updateData.round = Math.max(1, (Number(combat.round) || 0) + 1);

  const firstTurn = getFirstEligibleTurnIndex(combat, 1);
  if (firstTurn >= 0) updateData.turn = firstTurn;
  if (Object.keys(updateData).length) await combat.update(updateData);
  return combat;
}

export async function advanceSW1ETurn(combat) {
  if (!isSW1ETrackedCombat(combat)) return combat;

  const current = combat.combatant;
  const state = getCombatState(combat);
  if (current) {
    const currentState = getCombatantState(current);
    if (isCombatantEligibleForSegment(combat, current, state.segment) && !currentState.actedThisSegment) {
      await updateCombatantState(current, {
        actedThisSegment: true,
        completedActions: Math.max(currentState.completedActions, state.segment)
      });
    }
  }

  const nextCombatant = getNextPendingCombatant(combat);
  if (nextCombatant) {
    const nextTurn = getCombatTurnIndex(combat, nextCombatant.id);
    if (nextTurn >= 0) await combat.update({ turn: nextTurn });
    return combat;
  }

  return advanceToSegment(combat, state.segment + 1);
}

export function getActorCombatant(actor) {
  if (!actor) return null;

  const combats = [];
  if (game.combat) combats.push(game.combat);
  if (ui.combat?.viewed && ui.combat.viewed !== game.combat) combats.push(ui.combat.viewed);
  for (const combat of game.combats?.contents ?? []) {
    if (!combats.includes(combat)) combats.push(combat);
  }

  for (const combat of combats) {
    if (!combat || !isSW1ETrackedCombat(combat) || (Number(combat.round) || 0) < 1) continue;
    const combatant = [...combat.combatants].find(entry => entry.actor?.id === actor.id);
    if (combatant && isSW1EPersonalCombatant(combatant)) return combatant;
  }

  return null;
}

export function getSW1EActionPenalty(actor, { reactionIncrement = 0 } = {}) {
  const combatant = getActorCombatant(actor);
  if (!combatant) {
    return {
      active: false,
      penaltyDice: 0,
      declaredActions: 0,
      reactionsUsed: 0,
      segment: 0,
      label: ""
    };
  }

  const combat = combatant.combat;
  const combatState = getCombatState(combat);
  const turnState = getCombatantState(combatant);
  const penaltyDice = Math.max(0, turnState.declaredActions - 1 + turnState.reactionsUsed + Math.max(0, Number(reactionIncrement) || 0));
  const reactionCount = turnState.reactionsUsed + Math.max(0, Number(reactionIncrement) || 0);
  const label = penaltyDice > 0
    ? game.i18n.format("SW1E.Combat.ActionPenaltyLabel", {
        dice: `${penaltyDice}D`,
        actions: turnState.declaredActions,
        reactions: reactionCount,
        segment: combatState.segment
      })
    : game.i18n.format("SW1E.Combat.ActionStateLabel", {
        actions: turnState.declaredActions,
        reactions: reactionCount,
        segment: combatState.segment
      });

  return {
    active: true,
    penaltyDice,
    declaredActions: turnState.declaredActions,
    reactionsUsed: reactionCount,
    segment: combatState.segment,
    combat,
    combatant,
    label
  };
}

export async function registerSW1EReactionUse(actor, count = 1) {
  const combatant = getActorCombatant(actor);
  if (!combatant) return null;
  const state = getCombatantState(combatant);
  const next = state.reactionsUsed + Math.max(0, Number(count) || 0);
  await updateCombatantState(combatant, { reactionsUsed: next });
  return next;
}


export async function registerSW1EReactionRoll(actor, label = "", total = 0) {
  const profile = getReactionDefenseProfile(label);
  if (!profile) return null;

  const combatant = getActorCombatant(actor);
  if (!combatant) return null;

  const combat = combatant.combat;
  const combatState = getCombatState(combat);
  const defense = {
    label,
    normalized: profile.normalized,
    categories: profile.categories,
    total: Number(total) || 0,
    segment: combatState.segment,
    round: Math.max(1, Number(combat?.round) || 1),
    combatId: combat?.id ?? ""
  };

  await combatant.setFlag(SW1E_SCOPE, "lastDefenseRoll", defense);
  return defense;
}

export function getSW1EStoredDefense(actor, { attackType = "" } = {}) {
  const combatant = getActorCombatant(actor);
  if (!combatant) return null;

  const defense = combatant.getFlag(SW1E_SCOPE, "lastDefenseRoll") ?? null;
  if (!defense || !Number.isFinite(Number(defense.total))) return null;

  const combat = combatant.combat;
  const combatState = getCombatState(combat);
  const currentRound = Math.max(1, Number(combat?.round) || 1);
  if ((defense.combatId ?? "") !== (combat?.id ?? "")) return null;
  if ((Number(defense.round) || 0) !== currentRound) return null;
  if ((Number(defense.segment) || 0) !== combatState.segment) return null;

  const categories = Array.isArray(defense.categories) ? defense.categories : [];
  if (attackType && !categories.includes(attackType)) return null;

  return {
    label: defense.label || "",
    normalized: defense.normalized || "",
    total: Number(defense.total) || 0,
    categories,
    segment: Number(defense.segment) || combatState.segment,
    round: Number(defense.round) || currentRound
  };
}

export class SW1ECombat extends foundry.documents.Combat {
  async startCombat() {
    const started = await super.startCombat();
    if (isSW1ETrackedCombat(this)) await initializeSW1ETrackedCombat(this);
    return started;
  }

  async nextTurn() {
    if (!isSW1ETrackedCombat(this)) return super.nextTurn();
    if ((Number(this.round) || 0) < 1) return this.startCombat();
    return advanceSW1ETurn(this);
  }

  async nextRound() {
    if (!isSW1ETrackedCombat(this)) return super.nextRound();
    if ((Number(this.round) || 0) < 1) return this.startCombat();
    return resetSW1ERound(this, { incrementRound: true });
  }

  async rollInitiative(ids, options = {}) {
    if (!isSW1ETrackedCombat(this)) return super.rollInitiative(ids, options);
    await syncSW1EInitiativeOrder(this);
    ui.notifications.info(game.i18n.localize("SW1E.Combat.Tracker.OrderLocked"));
    return this;
  }
}

async function onDeclaredActionsChange(combatant, value) {
  const combat = combatant.combat;
  const mode = getSW1ECombatMode(combat);
  if (!mode) return;

  const declaredActions = mode === "starship"
    ? clampInt(value, { min: 0, max: 10, fallback: STARSHIP_DEFAULT_FIRE_SEGMENTS })
    : clampInt(value, { min: 1, max: 10, fallback: 1 });

  await updateCombatantState(combatant, { declaredActions });

  const maxSegments = getMaxDeclaredActions(combat);
  const combatState = getCombatState(combat);
  const segment = Math.min(combatState.segment, maxSegments);
  await updateCombatState(combat, { maxSegments, segment });

  if ((Number(combat.round) || 0) >= 1) {
    const eligible = getCurrentSegmentEligibleCombatants(combat, segment);
    if (!eligible.some(entry => entry.id === combat.combatant?.id)) {
      const firstTurn = getFirstEligibleTurnIndex(combat, segment);
      if (firstTurn >= 0) await combat.update({ turn: firstTurn });
    }
  }
}

async function onReactionAdjust(combatant, delta) {
  const state = getCombatantState(combatant);
  const reactionsUsed = clampInt(state.reactionsUsed + delta, { min: 0, max: 10, fallback: 0 });
  await updateCombatantState(combatant, { reactionsUsed });
}

function getStarshipPhaseLabel(segment) {
  if (segment <= 1) return game.i18n.localize("SW1E.Combat.Tracker.Starship.Piloting");
  if (segment === 2) return game.i18n.localize("SW1E.Combat.Tracker.Starship.Speed");
  if (segment === 3) return game.i18n.localize("SW1E.Combat.Tracker.Starship.FirstFire");
  return game.i18n.format("SW1E.Combat.Tracker.Starship.FirePhase", { number: segment - 2 });
}

function getTrackerSummaryLabel(combat, state, maxSegments) {
  if (isSW1EStarshipCombat(combat)) {
    return `${getStarshipPhaseLabel(state.segment)} (${state.segment}/${maxSegments})`;
  }
  return `${state.segment}/${maxSegments}`;
}

function getTrackerNote(combat) {
  return isSW1EStarshipCombat(combat)
    ? game.i18n.localize("SW1E.Combat.Tracker.Starship.Note")
    : game.i18n.localize("SW1E.Combat.Tracker.Note");
}

function getDeclaredActionLabel(combat) {
  return isSW1EStarshipCombat(combat)
    ? game.i18n.localize("SW1E.Combat.Tracker.FireSegments")
    : game.i18n.localize("SW1E.Combat.Tracker.Actions");
}

function getTrackerAxisLabel(combat) {
  return isSW1EStarshipCombat(combat)
    ? game.i18n.localize("SW1E.Combat.Tracker.Phase")
    : game.i18n.localize("SW1E.Combat.Tracker.Segment");
}

function buildCombatPanel(combat) {
  const state = getCombatState(combat);
  const maxSegments = getMaxDeclaredActions(combat);
  const roundLabel = Math.max(1, Number(combat.round) || 1);
  return `
    <section class="sw1e-tracker-panel">
      <div class="sw1e-tracker-summary">
        <span><strong>${game.i18n.localize("SW1E.Round")}</strong> ${roundLabel}</span>
        <span><strong>${getTrackerAxisLabel(combat)}</strong> ${getTrackerSummaryLabel(combat, state, maxSegments)}</span>
      </div>
      <div class="sw1e-tracker-buttons">
        <button type="button" data-action="sw1e-lock-order">${game.i18n.localize("SW1E.Combat.Tracker.LockOrder")}</button>
        <button type="button" data-action="sw1e-new-round">${game.i18n.localize("SW1E.Combat.Tracker.NewRound")}</button>
      </div>
      <p class="notes">${getTrackerNote(combat)}</p>
    </section>
  `;
}

function getCombatantSegmentStatus(combat, combatant) {
  const state = getCombatState(combat);
  const turnState = getCombatantState(combatant);
  if (!isCombatantEligibleForSegment(combat, combatant, state.segment)) {
    return {
      css: "waiting",
      label: game.i18n.localize("SW1E.Combat.Tracker.Waiting")
    };
  }

  if (turnState.actedThisSegment) {
    return {
      css: "done",
      label: game.i18n.localize("SW1E.Combat.Tracker.Done")
    };
  }

  return {
    css: "ready",
    label: game.i18n.localize("SW1E.Combat.Tracker.Ready")
  };
}

export function renderSW1ECombatTracker(app, html) {
  const jq = globalThis.jQuery ?? globalThis.$;
  if (!jq) return;
  const $html = (globalThis.jQuery && html instanceof globalThis.jQuery) ? html : jq(html);
  const combat = app?.viewed;
  const mode = getSW1ECombatMode(combat);
  if (!combat || !mode) return;

  const $windowApp = $html.closest(".app");
  if ($windowApp.length) $windowApp.addClass("sw1e-combat-tracker-app");

  $html.find(".sw1e-tracker-panel").remove();
  $html.find(".sw1e-combatant-state").remove();

  const panel = $(buildCombatPanel(combat));
  const trackerBody = $html.find("#combat-tracker");
  if (trackerBody.length) trackerBody.before(panel);
  else {
    const contentRoot = $html.find(".directory-list, .window-content, .tab, .combat-tracker").first();
    if (contentRoot.length) contentRoot.prepend(panel);
    else $html.prepend(panel);
  }

  panel.on("click", "button[data-action='sw1e-lock-order']", async event => {
    event.preventDefault();
    await syncSW1EInitiativeOrder(combat);
    app.render(true);
  });

  panel.on("click", "button[data-action='sw1e-new-round']", async event => {
    event.preventDefault();
    if ((Number(combat.round) || 0) < 1) await combat.startCombat();
    else await resetSW1ERound(combat, { incrementRound: true });
    app.render(true);
  });

  $html.find("li.combatant").each((_, element) => {
    const combatant = combat.combatants.get(element.dataset.combatantId);
    if (!combatant) return;
    if (mode === "personal" && !isSW1EPersonalCombatant(combatant)) return;
    if (mode === "starship" && !isSW1EStarshipCombatant(combatant)) return;

    const turnState = getCombatantState(combatant);
    const declaredActions = getDisplayedDeclaredActions(combat, combatant);
    const status = getCombatantSegmentStatus(combat, combatant);
    const showReactionControls = mode !== "starship" && isSW1EPersonalCombatant(combatant);
    const reactionMarkup = showReactionControls ? `
        <div class="sw1e-reaction-controls">
          <span>${game.i18n.localize("SW1E.Combat.Tracker.Reactions")}: ${turnState.reactionsUsed}</span>
          <div class="sw1e-reaction-buttons">
            <button type="button" data-action="reaction-dec">-</button>
            <button type="button" data-action="reaction-inc">+</button>
          </div>
        </div>
      ` : "";

    const minDeclared = mode === "starship" ? 0 : 1;
    const control = $(`
      <div class="sw1e-combatant-state">
        <label>
          <span>${getDeclaredActionLabel(combat)}</span>
          <input type="number" min="${minDeclared}" max="10" step="1" value="${declaredActions}" data-action="declared-actions">
        </label>
        ${reactionMarkup}
        <span class="sw1e-segment-tag ${status.css}">${status.label}</span>
      </div>
    `);

    control.on("change", "input[data-action='declared-actions']", async event => {
      await onDeclaredActionsChange(combatant, event.currentTarget.value);
      app.render(true);
    });

    if (showReactionControls) {
      control.on("click", "button[data-action='reaction-inc']", async event => {
        event.preventDefault();
        await onReactionAdjust(combatant, 1);
        app.render(true);
      });

      control.on("click", "button[data-action='reaction-dec']", async event => {
        event.preventDefault();
        await onReactionAdjust(combatant, -1);
        app.render(true);
      });
    }

    $(element).append(control);
  });
}
