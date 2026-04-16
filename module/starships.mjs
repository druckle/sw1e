import { SW1E } from "./config.mjs";
import {
  adjustDiceCode,
  diceCodeToPips,
  evaluateDiceCode,
  formatDiceCode,
  formatDieResults,
  isRollableDiceCode,
  pipsToDiceCode
} from "./dice.mjs";

const STARSHIP_RANGE_OPTIONS = [
  { key: "pointBlank", label: "SW1E.Combat.Range.pointBlank" },
  { key: "short", label: "SW1E.Starship.RangeBands.short" },
  { key: "medium", label: "SW1E.Starship.RangeBands.medium" },
  { key: "long", label: "SW1E.Starship.RangeBands.long" }
];

const STARSHIP_GUNNERY_DIFFICULTIES = {
  pointBlank: 5,
  short: 10,
  medium: 15,
  long: 20
};

const STARSHIP_SHIELD_DIFFICULTIES = {
  long: 10,
  medium: 15,
  short: 20,
  pointBlank: 20
};

const STARSHIP_SYSTEM_DAMAGE = {
  1: {
    key: "ionDrives",
    label: "SW1E.Starship.Systems.ionDrives",
    effect: "Ship cannot move in normal space; no speed or maneuver rolls may be made."
  },
  2: {
    key: "navComputer",
    label: "SW1E.Starship.Systems.navComputer",
    effect: "Standard-duration astrogation difficulty becomes 30 until repaired."
  },
  3: {
    key: "hyperdrives",
    label: "SW1E.Starship.Systems.hyperdrives",
    effect: "The ship may not enter hyperspace until the drives are repaired."
  },
  4: {
    key: "weaponSystem",
    label: "SW1E.Starship.Systems.weaponSystem",
    effect: "One weapon system no longer works and cannot be fired."
  },
  5: {
    key: "shields",
    label: "SW1E.Starship.Systems.shields",
    effect: "The shields no longer work; no shield rolls may be made."
  },
  6: {
    key: "lateralThrusters",
    label: "SW1E.Starship.Systems.lateralThrusters",
    effect: "Evasion may still be made, but maneuverability drops to zero."
  }
};


const ASTROGATION_MISHAPS = {
  2: {
    label: "SW1E.Starship.Astrogation.Mishaps.cutoutDamage",
    effect: "The hyperdrive cuts out and the ship takes damage before the crew can recover."
  },
  3: {
    label: "SW1E.Starship.Astrogation.Mishaps.cutoutDamage",
    effect: "The hyperdrive cuts out and the ship takes damage before the crew can recover."
  },
  4: {
    label: "SW1E.Starship.Astrogation.Mishaps.radiation",
    effect: "Unstable radiation washes through the ship or route and creates an immediate travel complication."
  },
  5: {
    label: "SW1E.Starship.Astrogation.Mishaps.cutoutSafe",
    effect: "The hyperdrive cuts out, but the ship drops safely into realspace."
  },
  6: {
    label: "SW1E.Starship.Astrogation.Mishaps.cutoutSafe",
    effect: "The hyperdrive cuts out, but the ship drops safely into realspace."
  },
  7: {
    label: "SW1E.Starship.Astrogation.Mishaps.offCourse",
    effect: "The ship emerges off course and must determine its actual position before continuing."
  },
  8: {
    label: "SW1E.Starship.Astrogation.Mishaps.mynocks",
    effect: "The jump ends with mynocks or a similar hyperspace hazard attached to or waiting near the ship."
  },
  9: {
    label: "SW1E.Starship.Astrogation.Mishaps.closeCall",
    effect: "The ship avoids disaster by a narrow margin and immediately faces a dangerous near miss."
  },
  10: {
    label: "SW1E.Starship.Astrogation.Mishaps.closeCall",
    effect: "The ship avoids disaster by a narrow margin and immediately faces a dangerous near miss."
  },
  11: {
    label: "SW1E.Starship.Astrogation.Mishaps.collision",
    effect: "A collision or equivalent impact causes heavy damage before the jump stabilizes."
  },
  12: {
    label: "SW1E.Starship.Astrogation.Mishaps.collision",
    effect: "A collision or equivalent impact causes heavy damage before the jump stabilizes."
  }
};

function localize(key) {
  return game.i18n.localize(key);
}

function localizeRange(rangeKey) {
  return localize(STARSHIP_RANGE_OPTIONS.find(option => option.key === rangeKey)?.label ?? rangeKey);
}

function formatRepairTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getStatus(actor) {
  return actor.system?.status ?? {};
}

function getShipSystems(actor) {
  return actor.system?.systems ?? {};
}

function heavyLikeState(actor) {
  return ["heavilyDamaged", "severelyDamaged", "deadInSpace"].includes(getStatus(actor).damageState);
}

function destroyedLike(actor) {
  const status = getStatus(actor);
  return !!status.destroyed || status.damageState === "destroyed";
}

function deadInSpaceLike(actor) {
  const status = getStatus(actor);
  return !!status.deadInSpace || status.damageState === "deadInSpace";
}

function getRawShipCode(actor, key) {
  const code = actor.system?.codes?.[key] ?? {};
  return {
    dice: Number(code.dice) || 0,
    pips: Number(code.pips) || 0
  };
}

function reduceOneD(code) {
  return adjustDiceCode(code, { dice: -1, pips: 0 });
}

function clampToZero(code) {
  const totalPips = Math.max(0, diceCodeToPips(code.dice, code.pips));
  return pipsToDiceCode(totalPips);
}

function buildEffectiveShipCode(actor, key) {
  const base = getRawShipCode(actor, key);
  let effective = { ...base };
  const notes = [];
  let blocked = false;
  let blockedReason = "";

  const status = getStatus(actor);
  const systems = getShipSystems(actor);
  const systemEntry = key === "sublightSpeed"
    ? systems.ionDrives
    : key === "maneuverability"
      ? systems.lateralThrusters
      : key === "shields"
        ? systems.shields
        : null;

  if (destroyedLike(actor)) {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedDestroyed");
  }

  if (!blocked && deadInSpaceLike(actor) && ["sublightSpeed", "maneuverability", "shields"].includes(key)) {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedDeadInSpace");
  }

  if (!blocked && status.ionized && ["sublightSpeed", "maneuverability"].includes(key)) {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedIonized");
  }

  if (!blocked && systemEntry?.disabled && key === "sublightSpeed") {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedIonDrives");
  }

  if (!blocked && systemEntry?.disabled && key === "shields") {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedShieldSystem");
  }

  if (!blocked && heavyLikeState(actor) && ["sublightSpeed", "maneuverability", "shields"].includes(key)) {
    effective = reduceOneD(effective);
    notes.push(localize("SW1E.Starship.Helpers.HeavyDamagePenalty"));
  }

  if (!blocked && key === "shields" && status.blownShields) {
    effective = reduceOneD(effective);
    notes.push(localize("SW1E.Starship.Helpers.BlownShieldsPenalty"));
  }

  if (!blocked && key === "maneuverability" && systemEntry?.disabled) {
    effective = { dice: 0, pips: 0 };
    notes.push(localize("SW1E.Starship.Helpers.LateralThrustersZero"));
  }

  effective = clampToZero(effective);

  if (!blocked && !isRollableDiceCode(effective.dice, effective.pips) && key !== "maneuverability") {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedNoCode");
  }

  return {
    base,
    effective,
    notes,
    blocked,
    blockedReason,
    displayDiceCode: formatDiceCode(effective.dice, effective.pips),
    baseDiceCode: formatDiceCode(base.dice, base.pips),
    changed: effective.dice !== base.dice || effective.pips !== base.pips
  };
}

function buildEffectiveWeaponFireControl(actor, weapon) {
  const base = {
    dice: Number(weapon.system?.fireControlDice) || 0,
    pips: Number(weapon.system?.fireControlPips) || 0
  };
  let effective = { ...base };
  const notes = [];
  let blocked = false;
  let blockedReason = "";

  if (destroyedLike(actor)) {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedDestroyed");
  }

  if (!blocked && (deadInSpaceLike(actor) || getStatus(actor).ionized)) {
    blocked = true;
    blockedReason = deadInSpaceLike(actor)
      ? localize("SW1E.Starship.Helpers.BlockedDeadInSpace")
      : localize("SW1E.Starship.Helpers.BlockedIonized");
  }

  if (!blocked && weapon.system?.operational === false) {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedWeaponDisabled");
  }

  if (!blocked && heavyLikeState(actor)) {
    effective = reduceOneD(effective);
    notes.push(localize("SW1E.Starship.Helpers.HeavyDamagePenalty"));
  }

  effective = clampToZero(effective);

  if (!blocked && !isRollableDiceCode(effective.dice, effective.pips)) {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedNoCode");
  }

  return {
    base,
    effective,
    notes,
    blocked,
    blockedReason,
    displayDiceCode: formatDiceCode(effective.dice, effective.pips),
    baseDiceCode: formatDiceCode(base.dice, base.pips),
    changed: effective.dice !== base.dice || effective.pips !== base.pips
  };
}

function buildWeaponDamageCode(actor, weapon, rangeKey = "medium") {
  const base = {
    dice: Number(weapon.system?.damageDice) || 0,
    pips: Number(weapon.system?.damagePips) || 0
  };
  let effective = { ...base };
  const notes = [];
  let blocked = false;
  let blockedReason = "";

  if (destroyedLike(actor)) {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedDestroyed");
  }

  if (!blocked && (deadInSpaceLike(actor) || getStatus(actor).ionized)) {
    blocked = true;
    blockedReason = deadInSpaceLike(actor)
      ? localize("SW1E.Starship.Helpers.BlockedDeadInSpace")
      : localize("SW1E.Starship.Helpers.BlockedIonized");
  }

  if (!blocked && weapon.system?.operational === false) {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedWeaponDisabled");
  }

  if (!blocked && rangeKey === "medium") {
    effective = reduceOneD(effective);
    notes.push(localize("SW1E.Starship.Helpers.MediumRangeDamagePenalty"));
  }

  if (!blocked && rangeKey === "long") {
    effective = reduceOneD(reduceOneD(effective));
    notes.push(localize("SW1E.Starship.Helpers.LongRangeDamagePenalty"));
  }

  effective = clampToZero(effective);

  if (!blocked && !isRollableDiceCode(effective.dice, effective.pips)) {
    blocked = true;
    blockedReason = localize("SW1E.Starship.Helpers.BlockedNoCode");
  }

  return {
    base,
    effective,
    notes,
    blocked,
    blockedReason,
    displayDiceCode: formatDiceCode(effective.dice, effective.pips),
    baseDiceCode: formatDiceCode(base.dice, base.pips),
    changed: effective.dice !== base.dice || effective.pips !== base.pips
  };
}

const STARSHIP_RANGE_SEQUENCE = ["short", "medium", "long"];

function getSingleTargetStarship(sourceActor = null) {
  const targets = [...(game.user?.targets ?? [])]
    .map(token => token?.actor)
    .filter(actor => actor?.type === "starship" && actor !== sourceActor);

  return targets.length === 1 ? targets[0] : null;
}

function getEngagementRangeMap(actor) {
  return foundry.utils.deepClone(actor?.getFlag?.("sw1e", "engagementRanges") ?? {});
}

function getStoredEngagement(actor, targetId) {
  if (!actor || !targetId) return null;
  return getEngagementRangeMap(actor)[targetId] ?? null;
}

function getRangeBandForTarget(actor, target) {
  if (!target) return getStatus(actor).rangeBand || "medium";
  return getStoredEngagement(actor, target.id)?.rangeBand || getStatus(actor).rangeBand || "medium";
}

function shiftRangeBand(currentRange = "medium", intent = "hold") {
  let index = STARSHIP_RANGE_SEQUENCE.indexOf(currentRange);
  if (index < 0) index = 1;

  if (intent === "close") index = Math.max(0, index - 1);
  if (intent === "run") index = Math.min(STARSHIP_RANGE_SEQUENCE.length - 1, index + 1);

  return STARSHIP_RANGE_SEQUENCE[index] ?? "medium";
}

function resolveEngagementTargetName(targetId, entry = {}) {
  const actor = game.actors?.get(targetId);
  return actor?.name || entry.targetName || targetId;
}

async function setEngagementRange(actor, target, rangeBand, extra = {}) {
  if (!actor || !target || actor.id === target.id) return null;

  const stamp = Date.now();
  const actorRanges = getEngagementRangeMap(actor);
  actorRanges[target.id] = {
    ...(actorRanges[target.id] ?? {}),
    targetId: target.id,
    targetName: target.name,
    rangeBand,
    updatedAt: stamp,
    ...extra
  };
  await actor.setFlag("sw1e", "engagementRanges", actorRanges);

  if (target.type === "starship") {
    const targetRanges = getEngagementRangeMap(target);
    targetRanges[actor.id] = {
      ...(targetRanges[actor.id] ?? {}),
      targetId: actor.id,
      targetName: actor.name,
      rangeBand,
      updatedAt: stamp,
      ...extra
    };
    await target.setFlag("sw1e", "engagementRanges", targetRanges);
  }

  return actorRanges[target.id];
}

async function updateStoredEngagementRange(actor, targetId, rangeBand) {
  if (!actor || !targetId) return null;

  const actorRanges = getEngagementRangeMap(actor);
  const existing = actorRanges[targetId];
  if (!existing) return null;

  const stamp = Date.now();
  actorRanges[targetId] = {
    ...existing,
    targetId,
    targetName: resolveEngagementTargetName(targetId, existing),
    rangeBand,
    updatedAt: stamp
  };
  await actor.setFlag("sw1e", "engagementRanges", actorRanges);

  const target = game.actors?.get(targetId);
  if (target?.type === "starship") {
    const targetRanges = getEngagementRangeMap(target);
    const reverseExisting = targetRanges[actor.id] ?? {};
    targetRanges[actor.id] = {
      ...reverseExisting,
      targetId: actor.id,
      targetName: actor.name,
      rangeBand,
      updatedAt: stamp
    };
    await target.setFlag("sw1e", "engagementRanges", targetRanges);
  }

  return actorRanges[targetId];
}

async function deleteStoredEngagement(actor, targetId) {
  if (!actor || !targetId) return null;

  const actorRanges = getEngagementRangeMap(actor);
  if (!(targetId in actorRanges)) return null;
  delete actorRanges[targetId];
  await actor.setFlag("sw1e", "engagementRanges", actorRanges);

  const target = game.actors?.get(targetId);
  if (target?.type === "starship") {
    const targetRanges = getEngagementRangeMap(target);
    if (actor.id in targetRanges) {
      delete targetRanges[actor.id];
      await target.setFlag("sw1e", "engagementRanges", targetRanges);
    }
  }

  return true;
}

function buildEngagementContexts(actor) {
  const ranges = getEngagementRangeMap(actor);
  const currentTarget = getSingleTargetStarship(actor);

  return Object.entries(ranges)
    .map(([targetId, entry]) => ({
      targetId,
      targetName: resolveEngagementTargetName(targetId, entry),
      rangeBand: entry.rangeBand || getStatus(actor).rangeBand || "medium",
      rangeLabel: localizeRange(entry.rangeBand || getStatus(actor).rangeBand || "medium"),
      updatedAt: entry.updatedAt || 0,
      targeted: currentTarget?.id === targetId
    }))
    .sort((a, b) => a.targetName.localeCompare(b.targetName));
}


function getRepairAttemptLabel(key) {
  return localize(SW1E.starshipRepairAttempts?.[key] ?? key);
}

function stepDamageStateTowardOperational(currentState) {
  if (currentState === "deadInSpace") return "severelyDamaged";
  if (currentState === "severelyDamaged") return "heavilyDamaged";
  if (currentState === "heavilyDamaged") return "lightlyDamaged";
  if (currentState === "lightlyDamaged") return "operational";
  return currentState;
}

function getRepairTargetOptions(actor) {
  const options = [
    { value: "ionized", label: localize("SW1E.Starship.Helpers.RepairTargetIonized") },
    { value: "blownShields", label: localize("SW1E.Starship.Helpers.RepairTargetBlownShields") },
    { value: "allTemporary", label: localize("SW1E.Starship.Helpers.RepairTargetAllTemporary") },
    { value: "structural", label: localize("SW1E.Starship.Helpers.RepairTargetStructural") }
  ];

  for (const [key, value] of Object.entries(SW1E.starshipSystems)) {
    options.push({ value: `system:${key}`, label: `${localize("SW1E.Starship.Helpers.RepairTargetSystem")}: ${localize(value)}` });
  }

  return options;
}

function getRepairTargetLabel(target) {
  if (target === "ionized") return localize("SW1E.Starship.Helpers.RepairTargetIonized");
  if (target === "blownShields") return localize("SW1E.Starship.Helpers.RepairTargetBlownShields");
  if (target === "allTemporary") return localize("SW1E.Starship.Helpers.RepairTargetAllTemporary");
  if (target === "structural") return localize("SW1E.Starship.Helpers.RepairTargetStructural");
  if (typeof target === "string" && target.startsWith("system:")) {
    const systemKey = target.split(":")[1];
    return `${localize("SW1E.Starship.Helpers.RepairTargetSystem")}: ${localize(SW1E.starshipSystems[systemKey] ?? systemKey)}`;
  }
  return String(target ?? "");
}

async function restoreWeaponsFromSystemRepair(actor) {
  const damageNote = localize("SW1E.Starship.Helpers.WeaponSystemDamaged");
  const restore = actor.items
    .filter(item => item.type === "starshipWeapon" && item.system?.operational === false && `${item.system?.notes ?? ""}`.includes(damageNote))
    .map(item => ({
      _id: item.id,
      "system.operational": true,
      "system.notes": `${item.system?.notes ?? ""}`.replace(damageNote, "").replace(/\s{2,}/g, " ").trim()
    }));

  if (restore.length) {
    await actor.updateEmbeddedDocuments("Item", restore);
  }
}

async function applyRepairTarget(actor, response) {
  const target = response.repairTarget;
  const stamp = new Date().toISOString();
  const repairMeta = {
    repaired: true,
    repairedAt: stamp,
    repairedBy: response.repairedBy || "",
    repairDifficulty: String(response.difficulty ?? 15),
    repairAttempt: response.attemptStage || ""
  };

  if (target === "ionized") {
    await actor.update({ "system.status.ionized": false });
    return { applied: true, targetLabel: getRepairTargetLabel(target) };
  }

  if (target === "blownShields") {
    await actor.update({ "system.status.blownShields": false });
    return { applied: true, targetLabel: getRepairTargetLabel(target) };
  }

  if (target === "allTemporary") {
    await actor.update({
      "system.status.ionized": false,
      "system.status.blownShields": false
    });
    return { applied: true, targetLabel: getRepairTargetLabel(target) };
  }

  if (target === "structural") {
    const currentState = getStatus(actor).damageState || "operational";
    const newState = stepDamageStateTowardOperational(currentState);
    if (newState === currentState) {
      return { applied: false, targetLabel: getRepairTargetLabel(target), currentState, newState };
    }
    await updateDamageState(actor, newState);
    return { applied: true, targetLabel: getRepairTargetLabel(target), currentState, newState };
  }

  if (typeof target === "string" && target.startsWith("system:")) {
    const systemKey = target.split(":")[1];
    const current = getShipSystems(actor)?.[systemKey] ?? {};
    await syncSystemEntry(actor, systemKey, {
      damaged: false,
      disabled: false,
      ...repairMeta,
      notes: current.notes ?? ""
    });

    if (systemKey === "shields") {
      await actor.update({ "system.status.blownShields": false });
    }

    if (systemKey === "weaponSystem") {
      await restoreWeaponsFromSystemRepair(actor);
    }

    return { applied: true, targetLabel: getRepairTargetLabel(target) };
  }

  return { applied: false, targetLabel: getRepairTargetLabel(target) };
}

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

async function promptStarshipForm({ title, content, callback }) {
  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title },
      content,
      ok: {
        label: localize("SW1E.RollPrompt.Roll"),
        callback: (event, button) => callback(button.form)
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

function buildOperatorFields({ includeRange = false, rangeKey = "medium", extra = "" } = {}) {
  const rangeOptions = STARSHIP_RANGE_OPTIONS
    .map(option => `<option value="${option.key}" ${option.key === rangeKey ? "selected" : ""}>${foundry.utils.escapeHTML(localize(option.label))}</option>`)
    .join("");

  return `
    <div class="form-group">
      <label>${localize("SW1E.Starship.Helpers.OperatorSkillDice")}</label>
      <div class="form-fields">
        <input type="number" name="skillDice" value="0" min="0" step="1">
        <span>${localize("SW1E.Dice")}</span>
        <input type="number" name="skillPips" value="0" min="0" max="2" step="1">
        <span>${localize("SW1E.Pips")}</span>
      </div>
    </div>
    <div class="form-group">
      <label>${localize("SW1E.Starship.Helpers.OperatorPenaltyDice")}</label>
      <input type="number" name="actionPenaltyDice" value="0" min="0" step="1">
      <p class="notes">${localize("SW1E.Starship.Helpers.OperatorPenaltyHint")}</p>
    </div>
    <div class="form-group">
      <label>${localize("SW1E.RollPrompt.Modifier")}</label>
      <input type="number" name="modifier" value="0" step="1">
    </div>
    ${includeRange ? `
      <div class="form-group">
        <label>${localize("SW1E.RangeBand")}</label>
        <select name="rangeBand">${rangeOptions}</select>
      </div>
    ` : ""}
    ${extra}
  `;
}

function renderCombinedChatCard({ title, subtitle = "", lines = [] }) {
  const safeTitle = foundry.utils.escapeHTML(title);
  const safeSubtitle = subtitle ? `<p><em>${foundry.utils.escapeHTML(subtitle)}</em></p>` : "";
  return `
    <div class="sw1e-chat-card">
      <h3>${safeTitle}</h3>
      ${safeSubtitle}
      ${lines.join("\n")}
    </div>
  `;
}

async function postCombinedRollMessage({ actor, title, subtitle = "", roll, lines = [], flavor = "" }) {
  const contentLines = [
    ...lines,
    `<p><strong>${localize("SW1E.DiceResults")}:</strong> ${formatDieResults(roll)}</p>`,
    `<p><strong>${localize("SW1E.Total")}:</strong> ${roll.total}</p>`
  ];

  const content = renderCombinedChatCard({ title, subtitle, lines: contentLines });

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: flavor || title,
    content
  });

  return roll;
}

function getPenaltyAdjustedSkillCode({ dice = 0, pips = 0 }, penaltyDice = 0) {
  return clampToZero(adjustDiceCode({ dice, pips }, { dice: -Math.max(0, penaltyDice), pips: 0 }));
}

function parseHyperdriveMultiplier(rawValue) {
  const text = String(rawValue ?? "").trim();
  const match = text.match(/(\d+(?:\.\d+)?)/);
  const value = match ? Number(match[1]) : Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function parseDurationDays(rawValue, fallback = 0) {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) return rawValue;
  const text = String(rawValue ?? "").trim();
  const match = text.match(/(\d+(?:\.\d+)?)/);
  const value = match ? Number(match[1]) : Number(text);
  return Number.isFinite(value) ? value : fallback;
}

function toFixedTravelDays(value) {
  const safe = Math.max(1, Number(value) || 1);
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(1).replace(/\.0$/, "");
}

function getAstrogationRoute(actor, routeId = null) {
  if (!routeId) return null;
  return actor?.items?.get?.(routeId) ?? null;
}

function getDefaultAstrogationData(actor, route = null) {
  const systems = getShipSystems(actor);
  const travel = actor.system?.travel ?? {};
  const standardDuration = parseDurationDays(route?.system?.standardDuration, 1);
  const routeExtraDays = 0;
  const hyperdriveMultiplier = parseHyperdriveMultiplier(travel.hyperdriveMultiplier);
  const baseTravelDays = Math.max(1, (standardDuration + routeExtraDays) * hyperdriveMultiplier);
  const noNavComputer = !!systems.navComputer?.disabled || !String(travel.navComputer ?? "").trim();
  const preCalculated = !!route?.system?.preCalculated;
  return {
    routeId: route?.id ?? "",
    routeName: route?.name ?? "",
    origin: route?.system?.origin ?? "",
    destination: route?.system?.destination ?? "",
    standardDuration,
    routeExtraDays,
    hyperdriveMultiplier,
    extraDays: 0,
    daysSaved: 0,
    modifier: 0,
    noNavComputer,
    preCalculated,
    hastyEntry: false,
    baseTravelDays
  };
}

function getAstrogationDamageModifier(actor) {
  const state = getStatus(actor).damageState;
  if (state === "lightlyDamaged") return 5;
  if (state === "heavilyDamaged") return 10;
  return 0;
}

function getAstrogationBlockedReason(actor) {
  if (destroyedLike(actor)) return localize("SW1E.Starship.Helpers.BlockedDestroyed");
  if (getShipSystems(actor).hyperdrives?.disabled) return localize("SW1E.Starship.Astrogation.HyperdriveDisabled");
  return "";
}

function resolveAstrogationMishap(total) {
  return ASTROGATION_MISHAPS[total] ?? ASTROGATION_MISHAPS[7];
}

function buildAstrogationSummary(flag = {}) {
  if (!flag?.createdAt) return null;
  const routeBits = [flag.origin, flag.destination].filter(Boolean).join(" → ");
  return {
    routeLabel: routeBits || flag.routeName || localize("SW1E.Starship.Astrogation.UnspecifiedRoute"),
    targetNumber: flag.targetNumber ?? 0,
    total: flag.total ?? 0,
    travelDays: flag.travelDaysLabel ?? toFixedTravelDays(flag.travelDays ?? 1),
    outcomeLabel: flag.outcomeLabel || "",
    success: !!flag.success,
    createdAt: flag.createdAt
  };
}

export async function syncStarshipTargetEngagement(actor) {
  const target = getSingleTargetStarship(actor);
  if (!target) {
    ui.notifications.warn(localize("SW1E.Starship.Helpers.NoTargetedStarship"));
    return null;
  }

  const rangeBand = getRangeBandForTarget(actor, target);
  await setEngagementRange(actor, target, rangeBand);
  ui.notifications.info(game.i18n.format("SW1E.Starship.Helpers.RangeSynced", {
    target: target.name,
    range: localizeRange(rangeBand)
  }));
  return target;
}

export async function updateStarshipEngagementRange(actor, targetId, rangeBand) {
  return updateStoredEngagementRange(actor, targetId, rangeBand);
}

export async function removeStarshipEngagement(actor, targetId) {
  return deleteStoredEngagement(actor, targetId);
}

export function prepareStarshipSheetContext(actor) {
  return {
    codeCards: Object.entries(SW1E.starshipCodes).map(([key, value]) => {
      const details = buildEffectiveShipCode(actor, key);
      return {
        key,
        label: localize(value),
        dice: details.base.dice,
        pips: details.base.pips,
        diceCode: details.displayDiceCode,
        baseDiceCode: details.baseDiceCode,
        blocked: details.blocked,
        blockedReason: details.blockedReason,
        notes: details.notes,
        changed: details.changed
      };
    }),
    effectiveWeapons: actor.items
      .filter(item => item.type === "starshipWeapon")
      .map(item => {
        const fireControl = buildEffectiveWeaponFireControl(actor, item);
        return {
          id: item.id,
          fireControlCode: fireControl.displayDiceCode,
          fireControlBaseCode: fireControl.baseDiceCode,
          fireControlChanged: fireControl.changed,
          fireControlBlocked: fireControl.blocked,
          fireControlBlockedReason: fireControl.blockedReason,
          fireControlNotes: fireControl.notes
        };
      }),
    engagementRanges: buildEngagementContexts(actor),
    lastAstrogation: buildAstrogationSummary(actor.getFlag("sw1e", "lastAstrogation"))
  };
}

export async function rollStarshipAstrogationMishap(actor, { auto = false } = {}) {
  const mishapRoll = await (new Roll("2d6")).evaluate();
  const mishap = resolveAstrogationMishap(mishapRoll.total);

  const content = renderCombinedChatCard({
    title: `${actor.name}: ${localize("SW1E.Starship.Astrogation.MishapRoll")}`,
    subtitle: auto ? localize("SW1E.Starship.Astrogation.MishapAuto") : "",
    lines: [
      `<p><strong>${localize("SW1E.DiceResults")}:</strong> ${formatDieResults(mishapRoll)}</p>`,
      `<p><strong>${localize("SW1E.Total")}:</strong> ${mishapRoll.total}</p>`,
      `<p><strong>${localize("SW1E.Starship.Astrogation.MishapResult")}:</strong> ${foundry.utils.escapeHTML(localize(mishap.label))}</p>`,
      `<p>${foundry.utils.escapeHTML(mishap.effect)}</p>`
    ]
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${actor.name}: ${localize("SW1E.Starship.Astrogation.MishapRoll")}`,
    content
  });

  return { roll: mishapRoll, mishap };
}

export async function rollStarshipAstrogation(actor, routeId = null) {
  const blockedReason = getAstrogationBlockedReason(actor);
  if (blockedReason) {
    ui.notifications.warn(blockedReason);
    return null;
  }

  const route = getAstrogationRoute(actor, routeId);
  const defaults = getDefaultAstrogationData(actor, route);
  const damageModifier = getAstrogationDamageModifier(actor);

  const response = await promptStarshipForm({
    title: game.i18n.format("SW1E.Starship.Astrogation.Title", { ship: actor.name }),
    content: `
      <form class="sw1e-roll-prompt">
        ${buildOperatorFields({
          extra: `
            <div class="form-group">
              <label>${localize("SW1E.Starship.Astrogation.StandardDurationDays")}</label>
              <input type="number" name="standardDuration" value="${defaults.standardDuration}" min="1" step="0.1">
            </div>
            <div class="form-group">
              <label>${localize("SW1E.Starship.Astrogation.RouteExtraDays")}</label>
              <input type="number" name="routeExtraDays" value="${defaults.routeExtraDays}" min="0" step="0.1">
            </div>
            <div class="form-group">
              <label>${localize("SW1E.HyperdriveMultiplier")}</label>
              <input type="text" name="hyperdriveMultiplier" value="${foundry.utils.escapeHTML(String(actor.system?.travel?.hyperdriveMultiplier ?? defaults.hyperdriveMultiplier))}">
            </div>
            <div class="form-group">
              <label>${localize("SW1E.Starship.Astrogation.ExtraDays")}</label>
              <input type="number" name="extraDays" value="0" min="0" step="1">
            </div>
            <div class="form-group">
              <label>${localize("SW1E.Starship.Astrogation.DaysSaved")}</label>
              <input type="number" name="daysSaved" value="0" min="0" step="1">
            </div>
            <div class="form-group checkbox-row">
              <label>${localize("SW1E.Starship.Astrogation.NoNavComputer")}</label>
              <input type="checkbox" name="noNavComputer" ${defaults.noNavComputer ? "checked" : ""}>
            </div>
            <div class="form-group checkbox-row">
              <label>${localize("SW1E.Starship.Astrogation.PreCalculated")}</label>
              <input type="checkbox" name="preCalculated" ${defaults.preCalculated ? "checked" : ""}>
            </div>
            <div class="form-group checkbox-row">
              <label>${localize("SW1E.Starship.Astrogation.HastyEntry")}</label>
              <input type="checkbox" name="hastyEntry">
            </div>
            <p class="notes">${foundry.utils.escapeHTML(localize("SW1E.Starship.Astrogation.InputHint"))}</p>
          `
        })}
      </form>
    `,
    callback: form => ({
      skillDice: toInt(form.elements.skillDice.value),
      skillPips: toInt(form.elements.skillPips.value),
      actionPenaltyDice: toInt(form.elements.actionPenaltyDice.value),
      modifier: toInt(form.elements.modifier.value),
      standardDuration: parseDurationDays(form.elements.standardDuration.value, defaults.standardDuration),
      routeExtraDays: parseDurationDays(form.elements.routeExtraDays.value, 0),
      hyperdriveMultiplier: parseHyperdriveMultiplier(form.elements.hyperdriveMultiplier.value),
      extraDays: Math.max(0, parseDurationDays(form.elements.extraDays.value, 0)),
      daysSaved: Math.max(0, parseDurationDays(form.elements.daysSaved.value, 0)),
      noNavComputer: form.elements.noNavComputer.checked,
      preCalculated: form.elements.preCalculated.checked,
      hastyEntry: form.elements.hastyEntry.checked
    })
  });

  if (response === null) return null;

  const operatorSkill = getPenaltyAdjustedSkillCode({ dice: response.skillDice, pips: response.skillPips }, response.actionPenaltyDice);
  if (!isRollableDiceCode(operatorSkill.dice, operatorSkill.pips)) {
    ui.notifications.warn(localize("SW1E.RollPrompt.BelowOneD"));
    return null;
  }

  const roll = await evaluateDiceCode({
    dice: operatorSkill.dice,
    pips: operatorSkill.pips,
    modifier: response.modifier
  });

  const routeDays = Math.max(1, response.standardDuration + response.routeExtraDays);
  const baseTravelDays = Math.max(1, routeDays * response.hyperdriveMultiplier);
  const travelDays = Math.max(1, baseTravelDays + response.extraDays - response.daysSaved);
  const navDifficulty = response.noNavComputer && !response.preCalculated ? 30 : 15;
  const pacingModifier = Math.round(response.daysSaved) - Math.round(response.extraDays);
  const targetBeforeHasty = Math.max(1, navDifficulty + pacingModifier + damageModifier);
  const targetNumber = response.hastyEntry ? targetBeforeHasty * 2 : targetBeforeHasty;
  const entrySuccess = response.hastyEntry ? roll.total >= 15 : true;
  const success = entrySuccess && roll.total >= targetNumber;

  let outcomeLabel = localize("SW1E.Starship.Astrogation.Failure");
  if (response.hastyEntry && !entrySuccess) outcomeLabel = localize("SW1E.Starship.Astrogation.NoEntryThisRound");
  else if (success) outcomeLabel = localize("SW1E.Starship.Astrogation.Success");
  else if (response.hastyEntry) outcomeLabel = localize("SW1E.Starship.Astrogation.HastyMishap");

  const lines = [
    `<p><strong>${localize("SW1E.Starship.Helpers.OperatorSkill")}:</strong> ${formatDiceCode(operatorSkill.dice, operatorSkill.pips)}</p>`,
    `<p><strong>${localize("SW1E.Starship.Astrogation.StandardDurationDays")}:</strong> ${toFixedTravelDays(response.standardDuration)}</p>`,
    `<p><strong>${localize("SW1E.Starship.Astrogation.RouteExtraDays")}:</strong> +${toFixedTravelDays(response.routeExtraDays)}</p>`,
    `<p><strong>${localize("SW1E.HyperdriveMultiplier")}:</strong> ×${response.hyperdriveMultiplier}</p>`,
    `<p><strong>${localize("SW1E.Starship.Astrogation.BaseTravelTime")}:</strong> ${toFixedTravelDays(baseTravelDays)} ${localize("SW1E.Days")}</p>`
  ];

  if (route) {
    const routeLabel = [route.system?.origin, route.system?.destination].filter(Boolean).join(" → ");
    lines.unshift(`<p><strong>${localize("SW1E.AstrogationRoute")}:</strong> ${foundry.utils.escapeHTML(route.name)}${routeLabel ? ` (${foundry.utils.escapeHTML(routeLabel)})` : ""}</p>`);
  }
  if (response.daysSaved) lines.push(`<p><strong>${localize("SW1E.Starship.Astrogation.DaysSaved")}:</strong> +${Math.round(response.daysSaved)} ${localize("SW1E.Days")}</p>`);
  if (response.extraDays) lines.push(`<p><strong>${localize("SW1E.Starship.Astrogation.ExtraDays")}:</strong> -${Math.round(response.extraDays)} ${localize("SW1E.Days")}</p>`);
  lines.push(`<p><strong>${localize("SW1E.Starship.Astrogation.PlannedTravelTime")}:</strong> ${toFixedTravelDays(travelDays)} ${localize("SW1E.Days")}</p>`);
  lines.push(`<p><strong>${localize("SW1E.Starship.Astrogation.NavDifficulty")}:</strong> ${navDifficulty}</p>`);
  if (damageModifier) lines.push(`<p><strong>${localize("SW1E.Starship.Astrogation.DamageModifier")}:</strong> +${damageModifier}</p>`);
  if (response.hastyEntry) lines.push(`<p><strong>${localize("SW1E.Starship.Astrogation.HastyEntry")}:</strong> ${localize("SW1E.Yes")}</p>`);
  if (response.hastyEntry) lines.push(`<p><strong>${localize("SW1E.Starship.Astrogation.EntryThreshold")}:</strong> 15</p>`);
  lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.TargetNumber")}:</strong> ${targetNumber}</p>`);
  lines.push(`<p><strong>${localize("SW1E.Starship.Astrogation.Outcome")}:</strong> ${foundry.utils.escapeHTML(outcomeLabel)}</p>`);

  let mishapData = null;
  if (entrySuccess && !success) {
    mishapData = await rollStarshipAstrogationMishap(actor, { auto: true });
    if (mishapData) {
      lines.push(`<p><strong>${localize("SW1E.Starship.Astrogation.MishapResult")}:</strong> ${foundry.utils.escapeHTML(localize(mishapData.mishap.label))}</p>`);
    }
  }

  await actor.setFlag("sw1e", "lastAstrogation", {
    routeId: route?.id || null,
    routeName: route?.name || "",
    origin: route?.system?.origin || "",
    destination: route?.system?.destination || "",
    targetNumber,
    total: roll.total,
    success,
    entrySuccess,
    hastyEntry: response.hastyEntry,
    travelDays,
    travelDaysLabel: toFixedTravelDays(travelDays),
    outcomeLabel,
    mishapKey: mishapData?.mishap?.label || "",
    createdAt: Date.now()
  });

  return postCombinedRollMessage({
    actor,
    title: `${actor.name}: ${localize("SW1E.Starship.Astrogation.Roll")}`,
    subtitle: localize("SW1E.Starship.Astrogation.Subtitle"),
    roll,
    lines,
    flavor: `${actor.name}: ${localize("SW1E.Starship.Astrogation.Roll")}`
  });
}

export async function rollStarshipSpeed(actor) {
  const speed = buildEffectiveShipCode(actor, "sublightSpeed");
  if (speed.blocked) {
    ui.notifications.warn(speed.blockedReason);
    return null;
  }

  const target = getSingleTargetStarship(actor);
  const currentRange = getRangeBandForTarget(actor, target);
  const targetSpeedTotal = target ? Number(await target.getFlag("sw1e", "lastSpeedTotal")) : null;

  const response = await promptStarshipForm({
    title: game.i18n.format("SW1E.Starship.Helpers.SpeedTitle", { ship: actor.name }),
    content: `
      <form class="sw1e-roll-prompt">
        ${buildOperatorFields()}
        <div class="form-group">
          <label>${localize("SW1E.Starship.Helpers.SpeedIntent")}</label>
          <select name="intent">
            <option value="close">${localize("SW1E.Starship.Helpers.Close")}</option>
            <option value="run">${localize("SW1E.Starship.Helpers.Run")}</option>
            <option value="hold">${localize("SW1E.Starship.Helpers.Hold")}</option>
          </select>
        </div>
      </form>
    `,
    callback: form => ({
      skillDice: toInt(form.elements.skillDice.value),
      skillPips: toInt(form.elements.skillPips.value),
      actionPenaltyDice: toInt(form.elements.actionPenaltyDice.value),
      modifier: toInt(form.elements.modifier.value),
      intent: form.elements.intent.value
    })
  });

  if (response === null) return null;

  const pilotSkill = getPenaltyAdjustedSkillCode({ dice: response.skillDice, pips: response.skillPips }, response.actionPenaltyDice);
  const combined = clampToZero(adjustDiceCode(speed.effective, pilotSkill));
  if (!isRollableDiceCode(combined.dice, combined.pips)) {
    ui.notifications.warn(localize("SW1E.RollPrompt.BelowOneD"));
    return null;
  }

  const roll = await evaluateDiceCode({ dice: combined.dice, pips: combined.pips, modifier: response.modifier });
  const lines = [
    `<p><strong>${localize("SW1E.SublightSpeed")}:</strong> ${speed.displayDiceCode}</p>`,
    `<p><strong>${localize("SW1E.Starship.Helpers.OperatorSkill")}:</strong> ${formatDiceCode(pilotSkill.dice, pilotSkill.pips)}</p>`,
    `<p><strong>${localize("SW1E.DiceCode")}:</strong> ${formatDiceCode(combined.dice, combined.pips)}</p>`,
    `<p><strong>${localize("SW1E.Starship.Helpers.SpeedIntent")}</strong>: ${foundry.utils.escapeHTML(localize(`SW1E.Starship.Helpers.${response.intent}`))}</p>`
  ];

  if (response.modifier) {
    lines.splice(3, 0, `<p><strong>${localize("SW1E.RollPrompt.Modifier")}:</strong> ${response.modifier}</p>`);
  }

  if (target) {
    lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.Targeting")}:</strong> ${foundry.utils.escapeHTML(target.name)}</p>`);
    lines.push(`<p><strong>${localize("SW1E.CurrentRange")}:</strong> ${foundry.utils.escapeHTML(localizeRange(currentRange))}</p>`);
  }

  let resolutionText = localize("SW1E.Starship.Helpers.SpeedCompareHint");
  if (target && Number.isFinite(targetSpeedTotal)) {
    lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.OpposingSpeedTotal")}:</strong> ${targetSpeedTotal}</p>`);
    if (response.intent === "hold") {
      resolutionText = localize("SW1E.Starship.Helpers.RangeHeld");
    } else if (roll.total > targetSpeedTotal) {
      if (response.intent === "run" && currentRange === "long") {
        resolutionText = game.i18n.format("SW1E.Starship.Helpers.LeftBattleArea", { target: target.name });
      } else {
        const newRange = shiftRangeBand(currentRange, response.intent);
        await setEngagementRange(actor, target, newRange);
        resolutionText = game.i18n.format("SW1E.Starship.Helpers.RangeChanged", {
          from: localizeRange(currentRange),
          to: localizeRange(newRange),
          target: target.name
        });
      }
    } else {
      resolutionText = game.i18n.format("SW1E.Starship.Helpers.RangeUnchanged", { target: target.name });
    }
  }

  lines.push(`<p>${foundry.utils.escapeHTML(resolutionText)}</p>`);

  await actor.setFlag("sw1e", "lastSpeedTotal", roll.total);
  await actor.setFlag("sw1e", "lastSpeedData", {
    total: roll.total,
    intent: response.intent,
    targetId: target?.id || null,
    createdAt: Date.now()
  });

  return postCombinedRollMessage({
    actor,
    title: `${actor.name}: ${localize("SW1E.Starship.Helpers.SpeedRoll")}`,
    subtitle: localize("SW1E.Starship.Helpers.SpeedSubtitle"),
    roll,
    lines,
    flavor: `${actor.name}: ${localize("SW1E.Starship.Helpers.SpeedRoll")}`
  });
}

export async function rollStarshipEvasion(actor) {
  const maneuver = buildEffectiveShipCode(actor, "maneuverability");
  if (maneuver.blocked) {
    ui.notifications.warn(maneuver.blockedReason);
    return null;
  }

  const response = await promptStarshipForm({
    title: game.i18n.format("SW1E.Starship.Helpers.EvasionTitle", { ship: actor.name }),
    content: `<form class="sw1e-roll-prompt">${buildOperatorFields()}</form>`,
    callback: form => ({
      skillDice: toInt(form.elements.skillDice.value),
      skillPips: toInt(form.elements.skillPips.value),
      actionPenaltyDice: toInt(form.elements.actionPenaltyDice.value),
      modifier: toInt(form.elements.modifier.value)
    })
  });

  if (response === null) return null;

  const pilotSkill = getPenaltyAdjustedSkillCode({ dice: response.skillDice, pips: response.skillPips }, response.actionPenaltyDice);
  const combined = clampToZero(adjustDiceCode(maneuver.effective, pilotSkill));
  if (!isRollableDiceCode(combined.dice, combined.pips)) {
    ui.notifications.warn(localize("SW1E.RollPrompt.BelowOneD"));
    return null;
  }

  const roll = await evaluateDiceCode({ dice: combined.dice, pips: combined.pips, modifier: response.modifier });
  await actor.setFlag("sw1e", "lastEvasionTotal", roll.total);

  const lines = [
    `<p><strong>${localize("SW1E.Maneuverability")}:</strong> ${maneuver.displayDiceCode}</p>`,
    `<p><strong>${localize("SW1E.Starship.Helpers.OperatorSkill")}:</strong> ${formatDiceCode(pilotSkill.dice, pilotSkill.pips)}</p>`,
    `<p><strong>${localize("SW1E.DiceCode")}:</strong> ${formatDiceCode(combined.dice, combined.pips)}</p>`,
    `<p>${localize("SW1E.Starship.Helpers.EvasionApplyHint")}</p>`
  ];

  if (response.modifier) lines.splice(3, 0, `<p><strong>${localize("SW1E.RollPrompt.Modifier")}:</strong> ${response.modifier}</p>`);

  return postCombinedRollMessage({
    actor,
    title: `${actor.name}: ${localize("SW1E.Starship.Helpers.EvasionRoll")}`,
    subtitle: localize("SW1E.Starship.Helpers.EvasionSubtitle"),
    roll,
    lines,
    flavor: `${actor.name}: ${localize("SW1E.Starship.Helpers.EvasionRoll")}`
  });
}

export async function rollStarshipShields(actor) {
  const shields = buildEffectiveShipCode(actor, "shields");
  if (shields.blocked) {
    ui.notifications.warn(shields.blockedReason);
    return null;
  }

  const attacker = getSingleTargetStarship(actor);
  const defaultRange = getRangeBandForTarget(actor, attacker);
  const response = await promptStarshipForm({
    title: game.i18n.format("SW1E.Starship.Helpers.ShieldTitle", { ship: actor.name }),
    content: `<form class="sw1e-roll-prompt">${buildOperatorFields({ includeRange: true, rangeKey: defaultRange })}</form>`,
    callback: form => ({
      skillDice: toInt(form.elements.skillDice.value),
      skillPips: toInt(form.elements.skillPips.value),
      actionPenaltyDice: toInt(form.elements.actionPenaltyDice.value),
      modifier: toInt(form.elements.modifier.value),
      rangeBand: form.elements.rangeBand.value
    })
  });

  if (response === null) return null;

  const operatorSkill = getPenaltyAdjustedSkillCode({ dice: response.skillDice, pips: response.skillPips }, response.actionPenaltyDice);
  if (!isRollableDiceCode(operatorSkill.dice, operatorSkill.pips)) {
    ui.notifications.warn(localize("SW1E.RollPrompt.BelowOneD"));
    return null;
  }

  const roll = await evaluateDiceCode({ dice: operatorSkill.dice, pips: operatorSkill.pips, modifier: response.modifier });
  const difficulty = STARSHIP_SHIELD_DIFFICULTIES[response.rangeBand] ?? 15;
  const success = roll.total >= difficulty;

  if (success) {
    await actor.setFlag("sw1e", "lastShieldData", {
      total: roll.total,
      skillTotal: roll.total,
      rangeBand: response.rangeBand,
      attackerId: attacker?.id || null,
      difficulty,
      successful: true,
      actorId: actor.id,
      actorName: actor.name,
      createdAt: Date.now()
    });
  } else {
    await actor.unsetFlag("sw1e", "lastShieldData");
  }

  const lines = [
    `<p><strong>${localize("SW1E.Shields")}:</strong> ${shields.displayDiceCode}</p>`,
    `<p><strong>${localize("SW1E.Starship.Helpers.OperatorSkill")}:</strong> ${formatDiceCode(operatorSkill.dice, operatorSkill.pips)}</p>`,
    `<p><strong>${localize("SW1E.Starship.Helpers.AttackerRange")}:</strong> ${foundry.utils.escapeHTML(localizeRange(response.rangeBand))}</p>`,
    `<p><strong>${localize("SW1E.Starship.Helpers.TargetNumber")}:</strong> ${difficulty}</p>`,
    `<p><strong>${localize("SW1E.Starship.Helpers.Result")}:</strong> ${success ? localize("SW1E.Yes") : localize("SW1E.No")}</p>`
  ];

  if (success) {
    lines.push(`<p>${localize("SW1E.Starship.Helpers.ShieldSuccessHint")}</p>`);
  }

  return postCombinedRollMessage({
    actor,
    title: `${actor.name}: ${localize("SW1E.Starship.Helpers.ShieldRoll")}`,
    subtitle: localize("SW1E.Starship.Helpers.ShieldSubtitle"),
    roll,
    lines,
    flavor: `${actor.name}: ${localize("SW1E.Starship.Helpers.ShieldRoll")}`
  });
}

export async function rollStarshipGunnery(actor, weapon) {
  const fireControl = buildEffectiveWeaponFireControl(actor, weapon);
  if (fireControl.blocked) {
    ui.notifications.warn(fireControl.blockedReason);
    return null;
  }

  const target = getSingleTargetStarship(actor);
  const targetEvasion = target ? await target.getFlag("sw1e", "lastEvasionTotal") : null;
  const targetSpeedCode = target ? buildEffectiveShipCode(target, "sublightSpeed") : null;
  const defaultRange = getRangeBandForTarget(actor, target);
  const torpedoLike = /torpedo|missile/i.test(`${weapon.name} ${weapon.system?.shortUseNote ?? ""} ${weapon.system?.notes ?? ""}`);

  const response = await promptStarshipForm({
    title: game.i18n.format("SW1E.Starship.Helpers.GunneryTitle", { weapon: weapon.name }),
    content: `
      <form class="sw1e-roll-prompt">
        ${buildOperatorFields({
          includeRange: true,
          rangeKey: defaultRange,
          extra: `
            <div class="form-group">
              <label>${localize("SW1E.Starship.Helpers.TargetEvasion")}</label>
              <input type="number" name="targetEvasion" value="${Number(targetEvasion) || 0}" step="1">
            </div>
            <div class="form-group">
              <label>${localize("SW1E.Starship.Helpers.TargetSpeedDice")}</label>
              <div class="form-fields">
                <input type="number" name="targetSpeedDice" value="${targetSpeedCode?.blocked ? 0 : Number(targetSpeedCode?.effective?.dice) || 0}" min="0" step="1">
                <span>${localize("SW1E.Dice")}</span>
                <input type="number" name="targetSpeedPips" value="${targetSpeedCode?.blocked ? 0 : Number(targetSpeedCode?.effective?.pips) || 0}" min="0" max="2" step="1">
                <span>${localize("SW1E.Pips")}</span>
              </div>
              <p class="notes">${localize("SW1E.Starship.Helpers.TorpedoHint")}</p>
            </div>
          `
        })}
      </form>
    `,
    callback: form => ({
      skillDice: toInt(form.elements.skillDice.value),
      skillPips: toInt(form.elements.skillPips.value),
      actionPenaltyDice: toInt(form.elements.actionPenaltyDice.value),
      modifier: toInt(form.elements.modifier.value),
      rangeBand: form.elements.rangeBand.value,
      targetEvasion: toInt(form.elements.targetEvasion.value),
      targetSpeedDice: toInt(form.elements.targetSpeedDice.value),
      targetSpeedPips: toInt(form.elements.targetSpeedPips.value)
    })
  });

  if (response === null) return null;

  if (torpedoLike && response.rangeBand !== "short") {
    ui.notifications.warn(localize("SW1E.Starship.Helpers.TorpedoShortOnly"));
    return null;
  }

  const operatorSkill = getPenaltyAdjustedSkillCode({ dice: response.skillDice, pips: response.skillPips }, response.actionPenaltyDice);
  const combined = clampToZero(adjustDiceCode(fireControl.effective, operatorSkill));
  if (!isRollableDiceCode(combined.dice, combined.pips)) {
    ui.notifications.warn(localize("SW1E.RollPrompt.BelowOneD"));
    return null;
  }

  const roll = await evaluateDiceCode({ dice: combined.dice, pips: combined.pips, modifier: response.modifier });
  const baseDifficulty = STARSHIP_GUNNERY_DIFFICULTIES[response.rangeBand] ?? 15;
  const targetSpeedPips = diceCodeToPips(response.targetSpeedDice, response.targetSpeedPips);
  const totalDifficulty = baseDifficulty + response.targetEvasion + (torpedoLike ? targetSpeedPips : 0);
  const success = roll.total >= totalDifficulty;

  const lines = [
    `<p><strong>${localize("SW1E.FireControl")}:</strong> ${fireControl.displayDiceCode}</p>`,
    `<p><strong>${localize("SW1E.Starship.Helpers.OperatorSkill")}:</strong> ${formatDiceCode(operatorSkill.dice, operatorSkill.pips)}</p>`,
    `<p><strong>${localize("SW1E.DiceCode")}:</strong> ${formatDiceCode(combined.dice, combined.pips)}</p>`,
    `<p><strong>${localize("SW1E.RangeBand")}:</strong> ${foundry.utils.escapeHTML(localizeRange(response.rangeBand))}</p>`,
    `<p><strong>${localize("SW1E.Starship.Helpers.BaseDifficulty")}:</strong> ${baseDifficulty}</p>`
  ];

  if (response.targetEvasion) lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.TargetEvasion")}:</strong> +${response.targetEvasion}</p>`);
  if (torpedoLike && targetSpeedPips) lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.TargetSpeedAdded")}:</strong> +${targetSpeedPips}</p>`);
  if (response.modifier) lines.push(`<p><strong>${localize("SW1E.RollPrompt.Modifier")}:</strong> ${response.modifier}</p>`);
  lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.TargetNumber")}:</strong> ${totalDifficulty}</p>`);
  lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.Result")}:</strong> ${success ? localize("SW1E.Yes") : localize("SW1E.No")}</p>`);

  return postCombinedRollMessage({
    actor,
    title: `${actor.name}: ${weapon.name} ${localize("SW1E.Starship.Helpers.GunneryRoll")}`,
    subtitle: target ? game.i18n.format("SW1E.Starship.Helpers.Targeting", { target: target.name }) : "",
    roll,
    lines,
    flavor: `${actor.name}: ${weapon.name} ${localize("SW1E.Starship.Helpers.GunneryRoll")}`
  });
}

function damageLevelFromComparison(damageTotal, hullTotal) {
  if (damageTotal < hullTotal) return "lightlyDamaged";
  if (damageTotal < hullTotal * 2) return "heavilyDamaged";
  if (damageTotal < hullTotal * 3) return "severelyDamaged";
  return "destroyed";
}

function nextDamageState(currentState, incomingLevel) {
  if (incomingLevel === "destroyed") return "destroyed";
  if (currentState === "destroyed") return "destroyed";
  if (currentState === "deadInSpace") return incomingLevel === "destroyed" ? "destroyed" : "deadInSpace";
  if (currentState === "severelyDamaged") {
    if (incomingLevel === "severelyDamaged") return "destroyed";
    if (incomingLevel === "heavilyDamaged") return "deadInSpace";
    return "severelyDamaged";
  }
  if (currentState === "heavilyDamaged") {
    if (["heavilyDamaged", "severelyDamaged"].includes(incomingLevel)) return "severelyDamaged";
    return "heavilyDamaged";
  }
  if (currentState === "lightlyDamaged") {
    if (incomingLevel === "lightlyDamaged") return "lightlyDamaged";
    return incomingLevel;
  }
  return incomingLevel;
}

async function consumeShieldFlag(targetActor) {
  const flag = await targetActor.getFlag("sw1e", "lastShieldData");
  if (flag?.successful) await targetActor.unsetFlag("sw1e", "lastShieldData");
  return flag?.successful ? flag : null;
}

async function syncSystemEntry(actor, systemKey, updates) {
  const actorUpdate = {};
  for (const [k, v] of Object.entries(updates)) {
    actorUpdate[`system.systems.${systemKey}.${k}`] = v;
  }
  await actor.update(actorUpdate);

  const matchingItems = actor.items.filter(item => item.type === "shipSystem" && item.system?.systemKey === systemKey);
  if (matchingItems.length) {
    const embedded = matchingItems.map(item => ({ _id: item.id, ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [`system.${k}`, v])) }));
    await actor.updateEmbeddedDocuments("Item", embedded);
  }
}

async function applySystemDamage(actor) {
  const roll = await (new Roll("1d6")).evaluate();
  const result = STARSHIP_SYSTEM_DAMAGE[roll.total];
  if (!result) return null;

  await syncSystemEntry(actor, result.key, {
    damaged: true,
    disabled: true,
    repaired: false,
    repairedAt: "",
    repairedBy: "",
    repairDifficulty: "",
    repairAttempt: "",
    notes: result.effect
  });

  if (result.key === "weaponSystem") {
    const operationalWeapons = actor.items.filter(item => item.type === "starshipWeapon" && item.system?.operational !== false);
    if (operationalWeapons.length) {
      const chosenWeapon = operationalWeapons[0];
      await chosenWeapon.update({
        "system.operational": false,
        "system.notes": [chosenWeapon.system?.notes, localize("SW1E.Starship.Helpers.WeaponSystemDamaged")].filter(Boolean).join(" ")
      });
    }
  }

  if (result.key === "shields") {
    await actor.update({ "system.status.blownShields": true });
  }

  return { roll, result };
}

async function updateDamageState(actor, newState) {
  const updates = {
    "system.status.damageState": newState,
    "system.status.deadInSpace": newState === "deadInSpace",
    "system.status.destroyed": newState === "destroyed"
  };

  if (newState === "destroyed") {
    updates["system.status.deadInSpace"] = false;
  }

  await actor.update(updates);
}

export async function rollStarshipDamage(actor, weapon) {
  const target = getSingleTargetStarship(actor);
  const targetState = target?.system?.status?.damageState ?? "operational";
  const defaultRange = getRangeBandForTarget(actor, target);
  const torpedoLike = /torpedo|missile/i.test(`${weapon.name} ${weapon.system?.shortUseNote ?? ""} ${weapon.system?.notes ?? ""}`);
  const damageCode = buildWeaponDamageCode(actor, weapon, defaultRange);
  if (damageCode.blocked) {
    ui.notifications.warn(damageCode.blockedReason);
    return null;
  }

  const response = await promptStarshipForm({
    title: game.i18n.format("SW1E.Starship.Helpers.DamageTitle", { weapon: weapon.name }),
    content: `
      <form class="sw1e-roll-prompt">
        <div class="form-group">
          <label>${localize("SW1E.RangeBand")}</label>
          <select name="rangeBand">
            ${STARSHIP_RANGE_OPTIONS.filter(option => option.key !== "pointBlank").map(option => `<option value="${option.key}" ${option.key === defaultRange ? "selected" : ""}>${foundry.utils.escapeHTML(localize(option.label))}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>${localize("SW1E.RollPrompt.Modifier")}</label>
          <input type="number" name="modifier" value="0" step="1">
        </div>
        ${target ? `
          <p class="notes">${game.i18n.format("SW1E.Starship.Helpers.Targeting", { target: target.name })}</p>
        ` : `
          <div class="form-group">
            <label>${localize("SW1E.Hull")}</label>
            <div class="form-fields">
              <input type="number" name="targetHullDice" value="0" min="0" step="1">
              <span>${localize("SW1E.Dice")}</span>
              <input type="number" name="targetHullPips" value="0" min="0" max="2" step="1">
              <span>${localize("SW1E.Pips")}</span>
            </div>
          </div>
          <div class="form-group">
            <label>${localize("SW1E.Starship.Helpers.SuccessfulShieldTotal")}</label>
            <input type="number" name="shieldTotal" value="0" step="1">
          </div>
          <div class="form-group">
            <label>${localize("SW1E.DamageState")}</label>
            <select name="currentDamageState">
              ${Object.entries(SW1E.starshipDamageStates).map(([key, value]) => `<option value="${key}" ${key === targetState ? "selected" : ""}>${foundry.utils.escapeHTML(localize(value))}</option>`).join("")}
            </select>
          </div>
        `}
      </form>
    `,
    callback: form => ({
      rangeBand: form.elements.rangeBand.value,
      modifier: toInt(form.elements.modifier.value),
      targetHullDice: form.elements.targetHullDice ? toInt(form.elements.targetHullDice.value) : 0,
      targetHullPips: form.elements.targetHullPips ? toInt(form.elements.targetHullPips.value) : 0,
      shieldTotal: form.elements.shieldTotal ? toInt(form.elements.shieldTotal.value) : 0,
      currentDamageState: form.elements.currentDamageState ? form.elements.currentDamageState.value : targetState
    })
  });

  if (response === null) return null;

  if (torpedoLike && response.rangeBand !== "short") {
    ui.notifications.warn(localize("SW1E.Starship.Helpers.TorpedoShortOnly"));
    return null;
  }

  const effectiveDamage = buildWeaponDamageCode(actor, weapon, response.rangeBand);
  if (effectiveDamage.blocked) {
    ui.notifications.warn(effectiveDamage.blockedReason);
    return null;
  }

  const damageRoll = await evaluateDiceCode({
    dice: effectiveDamage.effective.dice,
    pips: effectiveDamage.effective.pips,
    modifier: response.modifier
  });

  let hullRoll;
  let shieldFlag = null;
  let shieldRoll = null;
  let shieldCode = null;
  let hullCode;
  let currentState;
  let hullTotal;
  if (target) {
    shieldFlag = await consumeShieldFlag(target);
    hullCode = getRawShipCode(target, "hull");
    hullRoll = await evaluateDiceCode({ dice: hullCode.dice, pips: hullCode.pips, modifier: 0 });
    if (shieldFlag) {
      const effectiveShields = buildEffectiveShipCode(target, "shields");
      if (!effectiveShields.blocked && isRollableDiceCode(effectiveShields.effective.dice, effectiveShields.effective.pips)) {
        shieldCode = effectiveShields.effective;
        shieldRoll = await evaluateDiceCode({ dice: shieldCode.dice, pips: shieldCode.pips, modifier: 0 });
      }
    }
    hullTotal = hullRoll.total + (shieldRoll?.total || 0);
    currentState = target.system?.status?.damageState ?? "operational";
  } else {
    hullCode = { dice: response.targetHullDice, pips: response.targetHullPips };
    if (!isRollableDiceCode(hullCode.dice, hullCode.pips)) {
      ui.notifications.warn(localize("SW1E.RollPrompt.BelowOneD"));
      return null;
    }
    hullRoll = await evaluateDiceCode({ dice: hullCode.dice, pips: hullCode.pips, modifier: 0 });
    hullTotal = hullRoll.total + response.shieldTotal;
    currentState = response.currentDamageState || "operational";
    shieldFlag = response.shieldTotal ? { total: response.shieldTotal } : null;
  }

  const successfulShieldTotal = shieldRoll?.total || shieldFlag?.total || 0;
  if (torpedoLike && successfulShieldTotal > 0) {
    const content = renderCombinedChatCard({
      title: `${actor.name}: ${weapon.name} ${localize("SW1E.Starship.Helpers.DamageRoll")}`,
      subtitle: target ? game.i18n.format("SW1E.Starship.Helpers.Targeting", { target: target.name }) : "",
      lines: [
        `<p><strong>${localize("SW1E.DiceCode")}:</strong> ${effectiveDamage.displayDiceCode}</p>`,
        `<p><strong>${localize("SW1E.DiceResults")}:</strong> ${formatDieResults(damageRoll)}</p>`,
        `<p><strong>${localize("SW1E.Total")}:</strong> ${damageRoll.total}</p>`,
        `<p><strong>${localize("SW1E.Starship.Helpers.SuccessfulShieldTotal")}:</strong> +${successfulShieldTotal}</p>`,
        `<p>${localize("SW1E.Starship.Helpers.TorpedoDissipated")}</p>`
      ]
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name}: ${weapon.name} ${localize("SW1E.Starship.Helpers.DamageRoll")}`,
      content
    });

    return { damageRoll, hullRoll: null, resolvedState: currentState, systemDamageData: null };
  }

  const incomingLevel = damageLevelFromComparison(damageRoll.total, hullTotal);
  const resolvedState = nextDamageState(currentState, incomingLevel);

  const lines = [
    `<p><strong>${localize("SW1E.Combat.Damage")}:</strong> ${effectiveDamage.displayDiceCode}</p>`,
    `<p><strong>${localize("SW1E.RangeBand")}:</strong> ${foundry.utils.escapeHTML(localizeRange(response.rangeBand))}</p>`,
    `<p><strong>${localize("SW1E.Hull")}:</strong> ${formatDiceCode(hullCode.dice, hullCode.pips)}</p>`,
    `<p><strong>${localize("SW1E.Starship.Helpers.DamageComparison")}:</strong> ${localize(`SW1E.Starship.DamageStates.${incomingLevel}`)}</p>`
  ];

  if (response.modifier) lines.splice(3, 0, `<p><strong>${localize("SW1E.RollPrompt.Modifier")}:</strong> ${response.modifier}</p>`);
  if (shieldRoll?.total) lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.SuccessfulShieldTotal")}:</strong> +${shieldRoll.total}</p>`);
  else if (shieldFlag?.total) lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.SuccessfulShieldTotal")}:</strong> +${shieldFlag.total}</p>`);
  lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.ResolvedState")}:</strong> ${localize(`SW1E.Starship.DamageStates.${resolvedState}`)}</p>`);

  let systemDamageData = null;
  if (target) {
    const targetUpdates = {};
    const autoAppliedStatuses = [];

    if (incomingLevel === "lightlyDamaged") {
      if (shieldRoll?.total || shieldFlag?.total) {
        targetUpdates["system.status.blownShields"] = true;
        autoAppliedStatuses.push(localize("SW1E.BlownShields"));
        lines.push(`<p>${localize("SW1E.Starship.Helpers.ShieldsBlownText")}</p>`);
      } else {
        targetUpdates["system.status.ionized"] = true;
        autoAppliedStatuses.push(localize("SW1E.Ionized"));
        lines.push(`<p>${localize("SW1E.Starship.Helpers.IonizedText")}</p>`);
      }
    }

    await target.update(targetUpdates);
    await updateDamageState(target, resolvedState);

    if (resolvedState === "severelyDamaged" && currentState !== "severelyDamaged") {
      systemDamageData = await applySystemDamage(target);
      if (systemDamageData) {
        lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.SystemDamageRoll")}:</strong> ${systemDamageData.roll.total} — ${foundry.utils.escapeHTML(localize(systemDamageData.result.label))}</p>`);
        lines.push(`<p>${foundry.utils.escapeHTML(systemDamageData.result.effect)}</p>`);
        if (systemDamageData.result.key === "shields" && !autoAppliedStatuses.includes(localize("SW1E.BlownShields"))) {
          autoAppliedStatuses.push(localize("SW1E.BlownShields"));
        }
      }
    }

    for (const statusLabel of autoAppliedStatuses) {
      lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.AutoAppliedStatus")}:</strong> ${foundry.utils.escapeHTML(statusLabel)}</p>`);
    }
  } else {
    if (incomingLevel === "lightlyDamaged") {
      lines.push(`<p>${shieldFlag?.total ? localize("SW1E.Starship.Helpers.ShieldsBlownText") : localize("SW1E.Starship.Helpers.IonizedText")}</p>`);
    }
    if (resolvedState === "severelyDamaged") {
      lines.push(`<p>${localize("SW1E.Starship.Helpers.SystemDamageManual")}</p>`);
    }
  }

  const chatLines = [
    `<p><strong>${localize("SW1E.DiceCode")}:</strong> ${effectiveDamage.displayDiceCode}</p>`,
    `<p><strong>${localize("SW1E.DiceResults")}:</strong> ${formatDieResults(damageRoll)}</p>`,
    `<p><strong>${localize("SW1E.Total")}:</strong> ${damageRoll.total}</p>`
  ];

  if (shieldRoll) {
    chatLines.push(`<p><strong>${localize("SW1E.Shields")}:</strong> ${formatDieResults(shieldRoll)} = ${shieldRoll.total}</p>`);
  }

  chatLines.push(`<p><strong>${localize("SW1E.Starship.Helpers.HullRoll")}:</strong> ${formatDieResults(hullRoll)} = ${hullRoll.total}${shieldRoll?.total ? ` + ${shieldRoll.total}` : shieldFlag?.total ? ` + ${shieldFlag.total}` : ""} (${hullTotal})</p>`);
  chatLines.push(...lines);

  const content = renderCombinedChatCard({
    title: `${actor.name}: ${weapon.name} ${localize("SW1E.Starship.Helpers.DamageRoll")}`,
    subtitle: target ? game.i18n.format("SW1E.Starship.Helpers.Targeting", { target: target.name }) : "",
    lines: chatLines
  });

  const speaker = ChatMessage.getSpeaker({ actor });
  await ChatMessage.create({
    speaker,
    flavor: `${actor.name}: ${weapon.name} ${localize("SW1E.Starship.Helpers.DamageRoll")}`,
    content
  });

  return { damageRoll, hullRoll, resolvedState, systemDamageData };
}


export async function clearStarshipTemporaryEffects(actor) {
  await actor.update({
    "system.status.ionized": false,
    "system.status.blownShields": false
  });
  ui.notifications.info(localize("SW1E.Starship.Helpers.TemporaryCleared"));
  return actor;
}

export async function clearStarshipIonization(actor) {
  await actor.update({ "system.status.ionized": false });
  ui.notifications.info(localize("SW1E.Starship.Helpers.IonizationCleared"));
  return actor;
}

export async function restoreStarshipShieldStatus(actor) {
  await actor.update({ "system.status.blownShields": false });
  ui.notifications.info(localize("SW1E.Starship.Helpers.ShieldsRestored"));
  return actor;
}

export async function rollStarshipRepair(actor) {
  const repairOptions = getRepairTargetOptions(actor)
    .map(option => `<option value="${option.value}">${foundry.utils.escapeHTML(option.label)}</option>`)
    .join("");
  const attemptOptions = Object.keys(SW1E.starshipRepairAttempts ?? {})
    .map(key => `<option value="${key}">${foundry.utils.escapeHTML(getRepairAttemptLabel(key))}</option>`)
    .join("");

  const response = await promptStarshipForm({
    title: game.i18n.format("SW1E.Starship.Helpers.RepairTitle", { ship: actor.name }),
    content: `
      <form class="sw1e-roll-prompt">
        ${buildOperatorFields({
          extra: `
            <div class="form-group">
              <label>${localize("SW1E.Starship.Helpers.RepairTarget")}</label>
              <select name="repairTarget">${repairOptions}</select>
            </div>
            <div class="form-group">
              <label>${localize("SW1E.RepairDifficulty")}</label>
              <input type="number" name="difficulty" value="15" step="1">
            </div>
            <div class="form-group">
              <label>${localize("SW1E.RepairAttempt")}</label>
              <select name="attemptStage">${attemptOptions}</select>
            </div>
            <div class="form-group">
              <label>${localize("SW1E.RepairedBy")}</label>
              <input type="text" name="repairedBy" value="">
            </div>
            <div class="form-group checkbox-row">
              <label>${localize("SW1E.Starship.Helpers.RepairAutoApply")}</label>
              <input type="checkbox" name="applyOnSuccess" checked>
            </div>
            <p class="notes">${foundry.utils.escapeHTML(localize("SW1E.Starship.Helpers.RepairHelperHint"))}</p>
          `
        })}
      </form>
    `,
    callback: form => ({
      skillDice: toInt(form.elements.skillDice.value),
      skillPips: toInt(form.elements.skillPips.value),
      actionPenaltyDice: toInt(form.elements.actionPenaltyDice.value),
      modifier: toInt(form.elements.modifier.value),
      difficulty: toInt(form.elements.difficulty.value, 15),
      attemptStage: form.elements.attemptStage.value,
      repairTarget: form.elements.repairTarget.value,
      repairedBy: form.elements.repairedBy.value.trim(),
      applyOnSuccess: form.elements.applyOnSuccess.checked
    })
  });

  if (response === null) return null;

  const operatorSkill = getPenaltyAdjustedSkillCode({ dice: response.skillDice, pips: response.skillPips }, response.actionPenaltyDice);
  if (!isRollableDiceCode(operatorSkill.dice, operatorSkill.pips)) {
    ui.notifications.warn(localize("SW1E.RollPrompt.BelowOneD"));
    return null;
  }

  const roll = await evaluateDiceCode({
    dice: operatorSkill.dice,
    pips: operatorSkill.pips,
    modifier: response.modifier
  });

  const success = roll.total >= response.difficulty;
  let repairData = null;
  if (success && response.applyOnSuccess) {
    repairData = await applyRepairTarget(actor, response);
  }

  const lines = [
    `<p><strong>${localize("SW1E.Starship.Helpers.OperatorSkill")}:</strong> ${formatDiceCode(operatorSkill.dice, operatorSkill.pips)}</p>`,
    `<p><strong>${localize("SW1E.Starship.Helpers.RepairTarget")}:</strong> ${foundry.utils.escapeHTML(getRepairTargetLabel(response.repairTarget))}</p>`,
    `<p><strong>${localize("SW1E.RepairDifficulty")}:</strong> ${response.difficulty}</p>`,
    `<p><strong>${localize("SW1E.RepairAttempt")}:</strong> ${foundry.utils.escapeHTML(getRepairAttemptLabel(response.attemptStage))}</p>`
  ];

  if (response.repairedBy) {
    lines.push(`<p><strong>${localize("SW1E.RepairedBy")}:</strong> ${foundry.utils.escapeHTML(response.repairedBy)}</p>`);
  }
  if (response.modifier) {
    lines.push(`<p><strong>${localize("SW1E.RollPrompt.Modifier")}:</strong> ${response.modifier}</p>`);
  }
  lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.Result")}:</strong> ${success ? localize("SW1E.Yes") : localize("SW1E.No")}</p>`);
  lines.push(`<p>${localize(success ? "SW1E.Starship.Helpers.RepairSuccess" : "SW1E.Starship.Helpers.RepairFailure")}</p>`);

  if (repairData?.currentState) {
    lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.RepairCurrentState")}:</strong> ${localize(`SW1E.Starship.DamageStates.${repairData.currentState}`)}</p>`);
    lines.push(`<p><strong>${localize("SW1E.Starship.Helpers.RepairNewState")}:</strong> ${localize(`SW1E.Starship.DamageStates.${repairData.newState}`)}</p>`);
  }

  if (success) {
    if (response.applyOnSuccess && repairData?.applied) lines.push(`<p>${localize("SW1E.Starship.Helpers.RepairApplied")}</p>`);
    else if (response.applyOnSuccess && repairData && !repairData.applied) lines.push(`<p>${localize("SW1E.Starship.Helpers.NothingToRepair")}</p>`);
    else lines.push(`<p>${localize("SW1E.Starship.Helpers.RepairNotApplied")}</p>`);
  }

  return postCombinedRollMessage({
    actor,
    title: `${actor.name}: ${localize("SW1E.Starship.Helpers.RepairRoll")}`,
    roll,
    lines,
    flavor: `${actor.name}: ${localize("SW1E.Starship.Helpers.RepairRoll")}`
  });
}

export async function rollStarshipSystemDamage(actor) {
  const data = await applySystemDamage(actor);
  if (!data) return null;

  const content = renderCombinedChatCard({
    title: `${actor.name}: ${localize("SW1E.Starship.Helpers.SystemDamageRoll")}`,
    lines: [
      `<p><strong>${localize("SW1E.DiceResults")}:</strong> [${data.roll.total}]</p>`,
      `<p><strong>${localize("SW1E.SystemKey")}:</strong> ${foundry.utils.escapeHTML(localize(data.result.label))}</p>`,
      `<p>${foundry.utils.escapeHTML(data.result.effect)}</p>`
    ]
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${actor.name}: ${localize("SW1E.Starship.Helpers.SystemDamageRoll")}`,
    content
  });

  return data;
}
