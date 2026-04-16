import { SW1E } from "./config.mjs";
import {
  adjustDiceCode,
  formatDiceCode,
  isRollableDiceCode,
  multiplyDiceCode,
  postDiceCodeMessage
} from "./dice.mjs";
import { getActorCombatant, getCombatState, getSW1EActionPenalty, registerSW1EReactionRoll, registerSW1EReactionUse } from "./initiative.mjs";

function escapeHtml(value = "") {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function capitalize(value = "") {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function localizeForceSkill(key) {
  return game.i18n.localize(SW1E.forceSkills[key] ?? key);
}

const FORCE_POINT_SCOPE = "sw1e";
const FORCE_POINT_FLAG = "forcePoint";

function getStoredForcePointState(actor) {
  return actor?.getFlag?.(FORCE_POINT_SCOPE, FORCE_POINT_FLAG) ?? null;
}

function formatForcePointStateLabel(state = {}) {
  if (!state?.active) return "";
  if (state.mode === "combat") {
    return game.i18n.format("SW1E.ForcePoint.ActiveCombat", { round: Number(state.round) || 1 });
  }
  return game.i18n.localize("SW1E.ForcePoint.ActiveManual");
}

export function getActiveForcePointState(actor) {
  const stored = getStoredForcePointState(actor);
  if (!stored?.active) return { active: false, mode: "", label: "", raw: stored };

  if (stored.mode === "combat") {
    const combatant = getActorCombatant(actor);
    const combat = combatant?.combat ?? null;
    const currentRound = Math.max(1, Number(combat?.round) || 0);
    const storedRound = Math.max(1, Number(stored.round) || 1);
    const active = Boolean(combat && combat.id === stored.combatId && currentRound === storedRound);
    return {
      active,
      mode: "combat",
      combatId: stored.combatId ?? "",
      round: storedRound,
      segment: Math.max(1, Number(stored.segment) || 1),
      label: active ? formatForcePointStateLabel(stored) : "",
      raw: stored
    };
  }

  return {
    active: true,
    mode: "manual",
    label: formatForcePointStateLabel(stored),
    raw: stored
  };
}

export function isForcePointActive(actor) {
  return getActiveForcePointState(actor).active;
}

export async function clearForcePointState({ actor, silent = false } = {}) {
  if (!actor) return false;
  const stored = getStoredForcePointState(actor);
  if (!stored?.active) return false;

  await actor.unsetFlag(FORCE_POINT_SCOPE, FORCE_POINT_FLAG);

  if (!silent) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="sw1e-chat-card"><h3>${escapeHtml(`${actor.name} — ${game.i18n.localize("SW1E.ForcePoint.Title")}`)}</h3><p>${escapeHtml(game.i18n.localize("SW1E.ForcePoint.Ended"))}</p></div>`
    });
  }

  return true;
}

export async function spendForcePoint({ actor } = {}) {
  if (!actor) return null;

  const activeState = getActiveForcePointState(actor);
  if (activeState.active) {
    ui.notifications.warn(game.i18n.localize("SW1E.ForcePoint.AlreadyActive"));
    return null;
  }

  const current = Math.max(0, Number(actor.system.resources?.forcePoints) || 0);
  if (current < 1) {
    ui.notifications.warn(game.i18n.localize("SW1E.ForcePoint.NoneAvailable"));
    return null;
  }

  const combatant = getActorCombatant(actor);
  const combat = combatant?.combat ?? null;
  const combatState = combat ? getCombatState(combat) : null;
  const nextState = combat && (Number(combat.round) || 0) >= 1
    ? {
        active: true,
        mode: "combat",
        combatId: combat.id ?? "",
        round: Math.max(1, Number(combat.round) || 1),
        segment: Math.max(1, Number(combatState?.segment) || 1),
        activatedAt: Date.now()
      }
    : {
        active: true,
        mode: "manual",
        activatedAt: Date.now()
      };

  await actor.update({ "system.resources.forcePoints": current - 1 });
  await actor.setFlag(FORCE_POINT_SCOPE, FORCE_POINT_FLAG, nextState);

  const lines = [
    `<p><strong>${game.i18n.localize("SW1E.ForcePoints")}:</strong> ${Math.max(0, current - 1)} ${game.i18n.localize("SW1E.ForcePoint.Remaining")}</p>`,
    `<p>${escapeHtml(game.i18n.localize("SW1E.ForcePoint.EffectSummary"))}</p>`,
    `<p>${escapeHtml(nextState.mode === "combat" ? game.i18n.format("SW1E.ForcePoint.ChatCombat", { round: nextState.round }) : game.i18n.localize("SW1E.ForcePoint.ChatManual"))}</p>`
  ];

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="sw1e-chat-card"><h3>${escapeHtml(`${actor.name} — ${game.i18n.localize("SW1E.ForcePoint.Title")}`)}</h3>${lines.join("")}</div>`
  });

  return nextState;
}


function getForceActionState(actor) {
  const status = actor.system.status?.woundStatus ?? "healthy";
  const forcePointActive = isForcePointActive(actor);
  switch (status) {
    case "stunned":
      return forcePointActive
        ? { blocked: false, woundPenaltyDice: 0, reason: "", ignoresStun: true }
        : { blocked: true, reason: game.i18n.localize("SW1E.Combat.Blocked.stunned") };
    case "incapacitated":
      return { blocked: true, reason: game.i18n.localize("SW1E.Combat.Blocked.incapacitated") };
    case "mortallyWounded":
      return { blocked: true, reason: game.i18n.localize("SW1E.Combat.Blocked.mortallyWounded") };
    case "dead":
      return { blocked: true, reason: game.i18n.localize("SW1E.Combat.Blocked.dead") };
    case "wounded":
      return { blocked: false, woundPenaltyDice: -1 };
    default:
      return { blocked: false, woundPenaltyDice: 0 };
  }
}

function getForceSkillCode(actor, skillKey) {
  const data = actor.system.force?.[skillKey] ?? {};
  return {
    dice: Number(data.dice) || 0,
    pips: Number(data.pips) || 0
  };
}

function isLightsaberWeapon(weapon) {
  if (!weapon || weapon.type !== "weapon") return false;
  if (weapon.system?.isLightsaber || weapon.system?.lightsaberUsesControlDamage || weapon.system?.lightsaberUsesSenseParry) return true;
  return String(weapon.name ?? "").trim().toLowerCase() === "lightsaber";
}

export function getEffectiveForceSkillCode(actor, skillKey, { applyForcePoint = true, applyDarkSide = true } = {}) {
  const base = getForceSkillCode(actor, skillKey);
  let code = { dice: base.dice, pips: base.pips };
  const modifiers = [];

  if (applyForcePoint && isForcePointActive(actor)) {
    code = multiplyDiceCode(code, 2);
    modifiers.push(game.i18n.localize("SW1E.ForcePoint.AutoModifier"));
  }

  const darkSideDice = applyDarkSide ? Math.max(0, Number(actor?.system?.resources?.darkSidePoints) || 0) : 0;
  if (darkSideDice > 0) {
    code = adjustDiceCode(code, { dice: darkSideDice, pips: 0 });
    modifiers.push(game.i18n.format("SW1E.Force.DarkSideBonus", { dice: `${darkSideDice}D` }));
  }

  return {
    base,
    dice: code.dice,
    pips: code.pips,
    modifiers,
    darkSideDice
  };
}

function prepareLightsaberParryDice(actor) {
  const state = getForceActionState(actor);
  const base = getForceSkillCode(actor, "sense");

  if (!isRollableDiceCode(base.dice, base.pips)) {
    return {
      blocked: true,
      reason: game.i18n.format("SW1E.Force.Untrained", { skill: localizeForceSkill("sense") }),
      dice: base.dice,
      pips: base.pips,
      modifiers: []
    };
  }

  if (state.blocked) {
    return {
      blocked: true,
      reason: state.reason,
      dice: base.dice,
      pips: base.pips,
      modifiers: []
    };
  }

  const effective = getEffectiveForceSkillCode(actor, "sense");
  let code = { dice: effective.dice, pips: effective.pips };
  const modifiers = [...effective.modifiers];

  if (state.ignoresStun) {
    modifiers.push(game.i18n.localize("SW1E.ForcePoint.StunIgnored"));
  }

  if (state.woundPenaltyDice) {
    code = adjustDiceCode(code, { dice: state.woundPenaltyDice, pips: 0 });
    modifiers.push(game.i18n.localize("SW1E.Combat.WoundPenalty"));
  }

  const combatPenalty = getSW1EActionPenalty(actor, { reactionIncrement: 1 });
  if (combatPenalty.active && combatPenalty.penaltyDice > 0) {
    code = adjustDiceCode(code, { dice: -combatPenalty.penaltyDice, pips: 0 });
    modifiers.push(combatPenalty.label);
  } else if (combatPenalty.active && combatPenalty.label) {
    modifiers.push(combatPenalty.label);
  }

  if (!isRollableDiceCode(code.dice, code.pips)) {
    return {
      blocked: true,
      reason: game.i18n.localize("SW1E.Combat.BelowOneD"),
      dice: code.dice,
      pips: code.pips,
      modifiers,
      combatPenalty
    };
  }

  return {
    blocked: false,
    reason: "",
    dice: code.dice,
    pips: code.pips,
    modifiers,
    combatPenalty
  };
}

async function promptLightsaberParry(actor, weapon, prepared) {
  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Force.LightsaberParry.Title", { weapon: weapon.name }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.Skill")}</label>
            <input type="text" value="${escapeHtml(localizeForceSkill("sense"))} (${escapeHtml(formatDiceCode(prepared.dice, prepared.pips))})" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.Modifier")}</label>
            <input type="number" name="modifier" value="0" step="1" autofocus>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.DiceModifier")}</label>
            <input type="text" name="diceModifier" value="" placeholder="+1D, -2D, +2">
          </div>
        </form>
      `,
      ok: {
        label: game.i18n.localize("SW1E.RollPrompt.Roll"),
        callback: (event, button) => ({
          modifier: Number(button.form.elements.modifier.value || 0),
          diceModifier: button.form.elements.diceModifier.value?.trim() || "",
          modifierLabel: ""
        })
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

export function getRequiredForceSkills(system = {}) {
  return SW1E.forceSkillKeys.filter(key => system[`requires${capitalize(key)}`]);
}

export function getForcePowerRequirementLabel(system = {}) {
  const required = getRequiredForceSkills(system);
  if (!required.length) return game.i18n.localize("SW1E.None");
  return required.map(localizeForceSkill).join(" + ");
}

export function getForcePowerDifficultySummary(system = {}) {
  const required = getRequiredForceSkills(system);
  if (!required.length) return game.i18n.localize("SW1E.None");

  const parts = required.map(key => {
    const label = localizeForceSkill(key);
    const target = Number(system[`${key}Target`]) || 0;
    const note = String(system[`${key}Difficulty`] ?? "").trim();
    if (target && note) return `${label} ${target} (${note})`;
    if (target) return `${label} ${target}`;
    if (note) return `${label} ${note}`;
    return `${label} -`;
  });

  return parts.join(" • ");
}

export function getKeptUpPowers(actor) {
  return actor.items.filter(item => item.type === "forcePower" && item.system.isUp);
}

export function getKeptUpSkillCount(actor, { excludePowerId = null } = {}) {
  return getKeptUpPowers(actor)
    .filter(item => item.id !== excludePowerId)
    .reduce((total, item) => total + getRequiredForceSkills(item.system).length, 0);
}

function prepareForceDice(actor, skillKey, { extraActions = 0 } = {}) {
  const state = getForceActionState(actor);
  const base = getForceSkillCode(actor, skillKey);

  if (!isRollableDiceCode(base.dice, base.pips)) {
    return {
      blocked: true,
      reason: game.i18n.format("SW1E.Force.Untrained", { skill: localizeForceSkill(skillKey) }),
      dice: base.dice,
      pips: base.pips,
      modifiers: []
    };
  }

  if (state.blocked) {
    return {
      blocked: true,
      reason: state.reason,
      dice: base.dice,
      pips: base.pips,
      modifiers: []
    };
  }

  const effective = getEffectiveForceSkillCode(actor, skillKey);
  let code = { dice: effective.dice, pips: effective.pips };
  const modifiers = [...effective.modifiers];

  if (state.ignoresStun) {
    modifiers.push(game.i18n.localize("SW1E.ForcePoint.StunIgnored"));
  }

  if (state.woundPenaltyDice) {
    code = adjustDiceCode(code, { dice: state.woundPenaltyDice, pips: 0 });
    modifiers.push(game.i18n.localize("SW1E.Combat.WoundPenalty"));
  }

  const darkSideDice = effective.darkSideDice;

  const multiPenalty = Math.max(0, Number(extraActions) || 0);
  if (multiPenalty > 0) {
    code = adjustDiceCode(code, { dice: -multiPenalty, pips: 0 });
    modifiers.push(game.i18n.format("SW1E.Force.MultiActionPenalty", { dice: `${multiPenalty}D` }));
  }

  if (!isRollableDiceCode(code.dice, code.pips)) {
    return {
      blocked: true,
      reason: game.i18n.localize("SW1E.Combat.BelowOneD"),
      dice: code.dice,
      pips: code.pips,
      modifiers
    };
  }

  return {
    blocked: false,
    reason: "",
    dice: code.dice,
    pips: code.pips,
    modifiers,
    darkSideDice,
    multiPenalty
  };
}

async function promptForceSkillRoll(actor, skillKey, keptUpCount = 0) {
  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Force.RollPrompt.Title", { skill: localizeForceSkill(skillKey) }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Force.KeptUpPowers")}</label>
            <input type="text" value="${keptUpCount}" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Force.RollPrompt.AdditionalActions")}</label>
            <input type="number" name="additionalActions" value="0" min="0" step="1" autofocus>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Force.RollPrompt.TargetNumber")}</label>
            <input type="number" name="targetNumber" value="0" min="0" step="1">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.Modifier")}</label>
            <input type="number" name="modifier" value="0" step="1">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.DiceModifier")}</label>
            <input type="text" name="diceModifier" value="" placeholder="+1D, -2D, +2">
          </div>
        </form>
      `,
      ok: {
        label: game.i18n.localize("SW1E.RollPrompt.Roll"),
        callback: (event, button) => ({
          additionalActions: Number(button.form.elements.additionalActions.value || 0),
          targetNumber: Number(button.form.elements.targetNumber.value || 0),
          modifier: Number(button.form.elements.modifier.value || 0),
          diceModifier: button.form.elements.diceModifier.value?.trim() || "",
          modifierLabel: ""
        })
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

async function promptForcePowerUse(actor, power, keptUpCount = 0) {
  const required = getRequiredForceSkills(power.system);
  const difficultyInputs = required.map(key => {
    const label = localizeForceSkill(key);
    const note = String(power.system[`${key}Difficulty`] ?? "").trim();
    const target = Number(power.system[`${key}Target`]) || 0;
    const noteHtml = note ? `<div class="notes">${escapeHtml(note)}</div>` : "";
    return `
      <div class="form-group force-target-group">
        <label>${label}</label>
        <input type="number" name="${key}Target" value="${target}" min="0" step="1">
        ${noteHtml}
      </div>
    `;
  }).join("");

  const keepUpBlock = power.system.keepUp ? `
    <div class="form-group">
      <label>
        <input type="checkbox" name="keepUpIfSuccessful" ${power.system.isUp ? "checked" : ""}>
        ${game.i18n.localize("SW1E.Force.RollPrompt.KeepUp")}
      </label>
    </div>
  ` : "";

  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Force.PowerPrompt.Title", { power: power.name }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Force.RequiredSkills")}</label>
            <input type="text" value="${escapeHtml(getForcePowerRequirementLabel(power.system))}" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Force.KeptUpPowers")}</label>
            <input type="text" value="${keptUpCount}" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Force.RollPrompt.AdditionalActions")}</label>
            <input type="number" name="additionalActions" value="0" min="0" step="1" autofocus>
          </div>
          ${difficultyInputs}
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.Modifier")}</label>
            <input type="number" name="modifier" value="0" step="1">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.DiceModifier")}</label>
            <input type="text" name="diceModifier" value="" placeholder="+1D, -2D, +2">
          </div>
          ${keepUpBlock}
        </form>
      `,
      ok: {
        label: game.i18n.localize("SW1E.Force.Activate"),
        callback: (event, button) => {
          const form = button.form.elements;
          return {
            additionalActions: Number(form.additionalActions.value || 0),
            modifier: Number(form.modifier.value || 0),
            diceModifier: form.diceModifier.value?.trim() || "",
            modifierLabel: "",
            keepUpIfSuccessful: power.system.keepUp ? form.keepUpIfSuccessful.checked : false,
            targets: Object.fromEntries(required.map(key => [key, Number(form[`${key}Target`].value || 0)]))
          };
        }
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

export async function rollLightsaberParry({ actor, weapon = null } = {}) {
  if (!actor) return null;

  const lightsaber = weapon && isLightsaberWeapon(weapon)
    ? weapon
    : actor.items.find(item => isLightsaberWeapon(item));

  if (!lightsaber) {
    ui.notifications.warn(game.i18n.localize("SW1E.Force.LightsaberParry.NoLightsaber"));
    return null;
  }

  const prepared = prepareLightsaberParryDice(actor);
  if (prepared.blocked) {
    ui.notifications.warn(prepared.reason);
    return null;
  }

  const promptData = await promptLightsaberParry(actor, lightsaber, prepared);
  if (!promptData) return null;

  const label = game.i18n.localize("SW1E.Combat.LightsaberParry");
  const roll = await postDiceCodeMessage({
    actor,
    label,
    dice: prepared.dice,
    pips: prepared.pips,
    modifier: promptData.modifier,
    diceModifier: promptData.diceModifier,
    modifierLabel: promptData.modifierLabel,
    flavor: `${lightsaber.name} ${label}`,
    extraLines: [
      `<p><strong>${game.i18n.localize("SW1E.Combat.AttackPrompt.Skill")}:</strong> ${escapeHtml(localizeForceSkill("sense"))}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Weapon")}:</strong> ${escapeHtml(lightsaber.name)}</p>`,
      `<p>${escapeHtml(game.i18n.localize("SW1E.Combat.LightsaberParryNote"))}</p>`,
      prepared.modifiers.length ? `<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${prepared.modifiers.map(escapeHtml).join("; ")}</p>` : ""
    ]
  });

  if (roll && prepared.combatPenalty?.active) {
    await registerSW1EReactionUse(actor, 1);
    await registerSW1EReactionRoll(actor, label, roll.total);
  }

  return roll;
}

function buildOutcomeLabel(total, target) {
  if (!(Number(target) > 0)) return game.i18n.format("SW1E.Force.ManualTarget", { total });
  const margin = total - target;
  if (margin >= 0) return game.i18n.format("SW1E.Force.SuccessBy", { margin });
  return game.i18n.format("SW1E.Force.FailedBy", { margin: Math.abs(margin) });
}

export async function rollForceSkill({ actor, skillKey } = {}) {
  if (!actor || !skillKey) return null;

  const keptUpCount = getKeptUpSkillCount(actor);
  const promptData = await promptForceSkillRoll(actor, skillKey, keptUpCount);
  if (!promptData) return null;

  const combatPenalty = getSW1EActionPenalty(actor);
  const extraActions = keptUpCount + Math.max(0, promptData.additionalActions || 0) + Math.max(0, combatPenalty.penaltyDice || 0);
  const prepared = prepareForceDice(actor, skillKey, { extraActions });
  if (prepared.blocked) {
    ui.notifications.warn(prepared.reason);
    return null;
  }

  const label = localizeForceSkill(skillKey);
  const roll = await postDiceCodeMessage({
    actor,
    label,
    dice: prepared.dice,
    pips: prepared.pips,
    modifier: promptData.modifier,
    diceModifier: promptData.diceModifier,
    modifierLabel: promptData.modifierLabel,
    flavor: label,
    extraLines: [
      `<p><strong>${game.i18n.localize("SW1E.Force.KeptUpPowers")}:</strong> ${keptUpCount}</p>`,
      promptData.targetNumber > 0 ? `<p><strong>${game.i18n.localize("SW1E.Force.TargetNumber")}:</strong> ${promptData.targetNumber}</p>` : "",
      prepared.modifiers.length ? `<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${prepared.modifiers.map(escapeHtml).join("; ")}</p>` : "",
      combatPenalty.active && combatPenalty.label ? `<p><strong>${game.i18n.localize("SW1E.Combat.Tracker.Segment")}:</strong> ${escapeHtml(combatPenalty.label)}</p>` : ""
    ]
  });

  if (!roll || !(promptData.targetNumber > 0)) return roll;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="sw1e-chat-card"><h3>${escapeHtml(`${label} — ${game.i18n.localize("SW1E.Force.Result")}`)}</h3><p><strong>${game.i18n.localize("SW1E.Combat.Result")}:</strong> ${escapeHtml(buildOutcomeLabel(roll.total, promptData.targetNumber))}</p></div>`
  });

  return roll;
}

export async function activateForcePower({ actor, power } = {}) {
  if (!actor || !power) return null;

  const required = getRequiredForceSkills(power.system);
  if (!required.length) {
    ui.notifications.warn(game.i18n.localize("SW1E.Force.NoRequiredSkills"));
    return null;
  }

  const keptUpCount = getKeptUpSkillCount(actor, { excludePowerId: power.id });
  const promptData = await promptForcePowerUse(actor, power, keptUpCount);
  if (!promptData) return null;

  const combatPenalty = getSW1EActionPenalty(actor);
  const extraActions = keptUpCount + Math.max(0, promptData.additionalActions || 0) + (required.length - 1) + Math.max(0, combatPenalty.penaltyDice || 0);
  const results = [];
  let allResolved = true;
  let allSucceeded = true;

  for (const skillKey of required) {
    const prepared = prepareForceDice(actor, skillKey, { extraActions });
    if (prepared.blocked) {
      ui.notifications.warn(prepared.reason);
      return null;
    }

    const target = Number(promptData.targets?.[skillKey]) || 0;
    const skillLabel = localizeForceSkill(skillKey);
    const roll = await postDiceCodeMessage({
      actor,
      label: `${power.name} — ${skillLabel}`,
      dice: prepared.dice,
      pips: prepared.pips,
      modifier: promptData.modifier,
      diceModifier: promptData.diceModifier,
      modifierLabel: promptData.modifierLabel,
      flavor: `${power.name} (${skillLabel})`,
      extraLines: [
        target > 0 ? `<p><strong>${game.i18n.localize("SW1E.Force.TargetNumber")}:</strong> ${target}</p>` : "",
        prepared.modifiers.length ? `<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${prepared.modifiers.map(escapeHtml).join("; ")}</p>` : "",
        combatPenalty.active && combatPenalty.label ? `<p><strong>${game.i18n.localize("SW1E.Combat.Tracker.Segment")}:</strong> ${escapeHtml(combatPenalty.label)}</p>` : ""
      ]
    });

    if (!roll) return null;
    const resolved = target > 0;
    const succeeded = resolved ? roll.total >= target : false;
    if (!resolved) allResolved = false;
    if (resolved && !succeeded) allSucceeded = false;

    results.push({
      key: skillKey,
      label: skillLabel,
      total: roll.total,
      target,
      resolved,
      succeeded,
      outcome: buildOutcomeLabel(roll.total, target)
    });
  }

  if (power.system.keepUp && allResolved && allSucceeded) {
    await power.update({ "system.isUp": !!promptData.keepUpIfSuccessful });
  }

  const resultLines = [
    `<p><strong>${game.i18n.localize("SW1E.Force.RequiredSkills")}:</strong> ${escapeHtml(getForcePowerRequirementLabel(power.system))}</p>`
  ];

  for (const result of results) {
    resultLines.push(`<p><strong>${escapeHtml(result.label)}:</strong> ${escapeHtml(result.outcome)}</p>`);
  }

  if (power.system.keepUp) {
    const willBeUp = (allResolved && allSucceeded) ? !!promptData.keepUpIfSuccessful : !!power.system.isUp;
    resultLines.push(`<p><strong>${game.i18n.localize("SW1E.Force.PowerUp")}:</strong> ${willBeUp ? game.i18n.localize("SW1E.Yes") : game.i18n.localize("SW1E.No")}</p>`);
  }

  if (power.system.darkSideWarning) {
    resultLines.push(`<p><strong>${game.i18n.localize("SW1E.Warning")}:</strong> ${game.i18n.localize("SW1E.Force.DarkSideWarning")}</p>`);
  }

  if (!allResolved) {
    resultLines.push(`<p><strong>${game.i18n.localize("SW1E.Notes")}:</strong> ${game.i18n.localize("SW1E.Force.ManualResolution")}</p>`);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="sw1e-chat-card"><h3>${escapeHtml(`${power.name} — ${game.i18n.localize("SW1E.Force.Result")}`)}</h3>${resultLines.join("")}</div>`
  });

  return results;
}

export async function toggleForcePowerUp({ power } = {}) {
  if (!power || power.type !== "forcePower") return null;
  await power.update({ "system.isUp": !power.system.isUp });
  return power.system.isUp;
}
