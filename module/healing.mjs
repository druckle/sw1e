import { SW1E } from "./config.mjs";
import { adjustDiceCode, evaluateDiceCode, formatDiceCode, formatDieResults, postDiceCodeMessage } from "./dice.mjs";
import { getSW1EActionPenalty } from "./initiative.mjs";

const MEDPAC_DIFFICULTIES = {
  wounded: 10,
  incapacitated: 15,
  mortallyWounded: 20
};

const NATURAL_HEALING_OUTCOMES = {
  wounded: [
    { min: 2, max: 6, nextStatus: "incapacitated", key: "worse" },
    { min: 7, max: 11, nextStatus: "wounded", key: "noChange" },
    { min: 12, max: Infinity, nextStatus: "healthy", key: "healed" }
  ],
  incapacitated: [
    { min: 2, max: 8, nextStatus: "dead", key: "worse" },
    { min: 9, max: 13, nextStatus: "incapacitated", key: "noChange" },
    { min: 14, max: Infinity, nextStatus: "wounded", key: "healed" }
  ]
};

const REJUVE_TIMES = {
  wounded: { unit: "hours", seconds: 3600 },
  incapacitated: { unit: "days", seconds: 86400 },
  mortallyWounded: { unit: "weeks", seconds: 604800 }
};

const DAY_SECONDS = 86400;

function escapeHtml(value = "") {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function normalizeLookup(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getWorldTime() {
  const worldTime = Number(game.time?.worldTime);
  return Number.isFinite(worldTime) ? worldTime : 0;
}

function getHealingState(actor) {
  return actor.system?.healing ?? {};
}

function localizeWoundStatus(status = "healthy") {
  return game.i18n.localize(SW1E.woundStatuses[status] ?? status);
}

function formatRemainingTime(seconds = 0) {
  const value = Math.max(0, Number(seconds) || 0);
  if (value <= 0) return game.i18n.localize("SW1E.Healing.Ready");

  if (value >= REJUVE_TIMES.mortallyWounded.seconds) {
    const weeks = Math.ceil(value / REJUVE_TIMES.mortallyWounded.seconds);
    return game.i18n.format("SW1E.Healing.TimeUnitValue", {
      value: weeks,
      unit: game.i18n.localize(weeks === 1 ? "SW1E.Healing.TimeUnit.week" : "SW1E.Healing.TimeUnit.weeks")
    });
  }

  if (value >= REJUVE_TIMES.incapacitated.seconds) {
    const days = Math.ceil(value / REJUVE_TIMES.incapacitated.seconds);
    return game.i18n.format("SW1E.Healing.TimeUnitValue", {
      value: days,
      unit: game.i18n.localize(days === 1 ? "SW1E.Healing.TimeUnit.day" : "SW1E.Healing.TimeUnit.days")
    });
  }

  const hours = Math.ceil(value / REJUVE_TIMES.wounded.seconds);
  return game.i18n.format("SW1E.Healing.TimeUnitValue", {
    value: hours,
    unit: game.i18n.localize(hours === 1 ? "SW1E.Healing.TimeUnit.hour" : "SW1E.Healing.TimeUnit.hours")
  });
}

function getMedicineSkill(actor) {
  return actor?.items?.find(item => item.type === "skill" && normalizeLookup(item.name) === "medicine") ?? null;
}

function getPatientStatus(actor) {
  return actor.system?.status?.woundStatus ?? "healthy";
}

function getMedpacItem(actor) {
  return actor?.items?.find(item => item.type === "equipment" && normalizeLookup(item.name) === "medpac") ?? null;
}

function getTrackedMedpacCount(actor) {
  const item = getMedpacItem(actor);
  const quantity = Number(item?.system?.quantity);
  return Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
}

async function consumeTrackedMedpac(actor) {
  const item = getMedpacItem(actor);
  if (!item) return false;

  const quantity = Number(item.system?.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return false;

  await item.update({ "system.quantity": Math.max(0, quantity - 1) });
  return true;
}

function getOwnedMedicineActors(patient) {
  const actors = game.actors?.contents ?? [];
  return actors
    .filter(actor => ["character", "npc"].includes(actor.type) && actor.isOwner && getMedicineSkill(actor))
    .sort((a, b) => a.name.localeCompare(b.name))
    .sort((a, b) => (a.id === patient.id ? -1 : b.id === patient.id ? 1 : 0));
}

function reduceWoundOneDegree(status = "healthy") {
  switch (status) {
    case "mortallyWounded":
      return "incapacitated";
    case "incapacitated":
      return "wounded";
    case "wounded":
      return "healthy";
    default:
      return status;
  }
}

function canUseMedpacOnStatus(status = "healthy") {
  return ["wounded", "incapacitated", "mortallyWounded"].includes(status);
}

function canUseNaturalHealingOnStatus(status = "healthy") {
  return ["wounded", "incapacitated"].includes(status);
}

function canUseRejuveOnStatus(status = "healthy") {
  return ["wounded", "incapacitated", "mortallyWounded"].includes(status);
}

function prepareMedicineRoll(actor) {
  const skill = getMedicineSkill(actor);
  if (!skill) {
    return {
      blocked: true,
      reason: game.i18n.format("SW1E.Healing.NoMedicineSkill", { actor: actor.name }),
      dice: 0,
      pips: 0,
      modifiers: []
    };
  }

  const status = getPatientStatus(actor);
  const modifiers = [];
  let prepared = {
    dice: Number(skill.system?.dice) || 0,
    pips: Number(skill.system?.pips) || 0
  };

  if (["stunned", "incapacitated", "mortallyWounded", "dead"].includes(status)) {
    return {
      blocked: true,
      reason: game.i18n.localize(`SW1E.Combat.Blocked.${status}`),
      dice: prepared.dice,
      pips: prepared.pips,
      modifiers
    };
  }

  if (status === "wounded") {
    prepared = adjustDiceCode(prepared, { dice: -1, pips: 0 });
    modifiers.push(game.i18n.localize("SW1E.Combat.WoundPenalty"));
  }

  const combatPenalty = getSW1EActionPenalty(actor);
  if (combatPenalty.active && combatPenalty.penaltyDice > 0) {
    prepared = adjustDiceCode(prepared, { dice: -combatPenalty.penaltyDice, pips: 0 });
    modifiers.push(combatPenalty.label);
  } else if (combatPenalty.active && combatPenalty.label) {
    modifiers.push(combatPenalty.label);
  }

  const totalPips = (Number(prepared.dice) || 0) * 3 + (Number(prepared.pips) || 0);
  if (totalPips < 3) {
    return {
      blocked: true,
      reason: game.i18n.localize("SW1E.Combat.BelowOneD"),
      dice: prepared.dice,
      pips: prepared.pips,
      modifiers
    };
  }

  return {
    blocked: false,
    reason: "",
    dice: prepared.dice,
    pips: prepared.pips,
    skill,
    modifiers
  };
}

function prepareNaturalHealingRoll(actor) {
  const strength = actor.system?.attributes?.strength ?? {};
  const status = getPatientStatus(actor);
  let prepared = {
    dice: Number(strength.dice) || 0,
    pips: Number(strength.pips) || 0
  };
  const modifiers = [];

  if (status === "wounded") {
    prepared = adjustDiceCode(prepared, { dice: -1, pips: 0 });
    modifiers.push(game.i18n.localize("SW1E.Combat.WoundPenalty"));
  }

  const totalPips = (Number(prepared.dice) || 0) * 3 + (Number(prepared.pips) || 0);
  if (totalPips < 3) {
    return {
      blocked: true,
      reason: game.i18n.localize("SW1E.Combat.BelowOneD"),
      dice: prepared.dice,
      pips: prepared.pips,
      modifiers
    };
  }

  return {
    blocked: false,
    reason: "",
    dice: prepared.dice,
    pips: prepared.pips,
    modifiers
  };
}

function buildSummaryLines(lines = []) {
  return lines.filter(Boolean).join(" ");
}

export function getHealingSummary(actor) {
  const healing = getHealingState(actor);
  const rejuve = healing.rejuveTank ?? {};
  const now = getWorldTime();
  const lines = [];

  if (rejuve.active) {
    const remaining = Math.max(0, (Number(rejuve.endsAt) || 0) - now);
    if (remaining > 0) {
      lines.push(game.i18n.format("SW1E.Healing.Summary.RejuveRemaining", { remaining: formatRemainingTime(remaining) }));
    } else {
      lines.push(game.i18n.localize("SW1E.Healing.Summary.RejuveReady"));
    }
  }

  if (healing.medpacLocked && getPatientStatus(actor) !== "healthy") {
    lines.push(game.i18n.localize("SW1E.Healing.Summary.MedpacLocked"));
  }

  const cooldownRemaining = Math.max(0, (Number(healing.medpacAvailableAt) || 0) - now);
  if (cooldownRemaining > 0) {
    lines.push(game.i18n.format("SW1E.Healing.Summary.MedpacCooldown", { remaining: formatRemainingTime(cooldownRemaining) }));
  }

  return buildSummaryLines(lines);
}

function renderSummaryCard({ speakerActor, title, lines }) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: speakerActor }),
    content: `<div class="sw1e-chat-card"><h3>${escapeHtml(title)}</h3>${lines.join("")}</div>`
  });
}

async function promptHealingMethod(patient) {
  const healing = getHealingState(patient);
  const rejuve = healing.rejuveTank ?? {};
  const options = [
    `<option value="medpac">${game.i18n.localize("SW1E.Healing.Method.medpac")}</option>`,
    `<option value="natural">${game.i18n.localize("SW1E.Healing.Method.natural")}</option>`,
    `<option value="rejuve">${game.i18n.localize("SW1E.Healing.Method.rejuve")}</option>`
  ];

  if (rejuve.active) {
    options.push(`<option value="completeRejuve">${game.i18n.localize("SW1E.Healing.Method.completeRejuve")}</option>`);
  }

  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Healing.MethodPrompt.Title", { actor: patient.name }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Healing.CurrentStatus")}</label>
            <input type="text" value="${escapeHtml(localizeWoundStatus(getPatientStatus(patient)))}" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Healing.MethodPrompt.Method")}</label>
            <select name="method">${options.join("")}</select>
          </div>
        </form>
      `,
      ok: {
        label: game.i18n.localize("SW1E.Healing.MethodPrompt.Continue"),
        callback: (event, button) => button.form.elements.method.value || "medpac"
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

async function promptMedpacTreatment(patient) {
  const healerActors = getOwnedMedicineActors(patient);
  if (!healerActors.length) {
    ui.notifications.warn(game.i18n.localize("SW1E.Healing.NoMedicineActor"));
    return null;
  }

  const healerOptions = healerActors.map(actor => {
    const medpacs = getTrackedMedpacCount(actor);
    const suffix = medpacs > 0 ? ` — ${game.i18n.format("SW1E.Healing.TrackedMedpacs", { count: medpacs })}` : "";
    const selected = actor.id === patient.id ? "selected" : "";
    return `<option value="${escapeHtml(actor.id)}" ${selected}>${escapeHtml(actor.name)}${escapeHtml(suffix)}</option>`;
  }).join("");

  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Healing.MedpacPrompt.Title", { actor: patient.name }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Healing.CurrentStatus")}</label>
            <input type="text" value="${escapeHtml(localizeWoundStatus(getPatientStatus(patient)))}" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Healing.Healer")}</label>
            <select name="healerId">${healerOptions}</select>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.Modifier")}</label>
            <input type="number" name="modifier" value="0" step="1" autofocus>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.DiceModifier")}</label>
            <input type="text" name="diceModifier" value="" placeholder="+1D, -2D, +2">
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="consumeMedpac" checked>
              ${game.i18n.localize("SW1E.Healing.ConsumeTrackedMedpac")}
            </label>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="ignoreRestrictions">
              ${game.i18n.localize("SW1E.Healing.IgnoreRestrictions")}
            </label>
          </div>
        </form>
      `,
      ok: {
        label: game.i18n.localize("SW1E.RollPrompt.Roll"),
        callback: (event, button) => ({
          healerId: button.form.elements.healerId.value,
          modifier: Number(button.form.elements.modifier.value || 0),
          diceModifier: button.form.elements.diceModifier.value?.trim() || "",
          consumeMedpac: button.form.elements.consumeMedpac.checked,
          ignoreRestrictions: button.form.elements.ignoreRestrictions.checked
        })
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

async function promptNaturalHealing(patient) {
  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Healing.NaturalPrompt.Title", { actor: patient.name }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Healing.CurrentStatus")}</label>
            <input type="text" value="${escapeHtml(localizeWoundStatus(getPatientStatus(patient)))}" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.Modifier")}</label>
            <input type="number" name="modifier" value="0" step="1" autofocus>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.DiceModifier")}</label>
            <input type="text" name="diceModifier" value="" placeholder="+1D, -2D, +2">
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="ignoreDailyLimit">
              ${game.i18n.localize("SW1E.Healing.IgnoreDailyLimit")}
            </label>
          </div>
        </form>
      `,
      ok: {
        label: game.i18n.localize("SW1E.RollPrompt.Roll"),
        callback: (event, button) => ({
          modifier: Number(button.form.elements.modifier.value || 0),
          diceModifier: button.form.elements.diceModifier.value?.trim() || "",
          ignoreDailyLimit: button.form.elements.ignoreDailyLimit.checked
        })
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

async function promptCompleteRejuve(patient) {
  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Healing.RejuveCompletePrompt.Title", { actor: patient.name }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Healing.CurrentStatus")}</label>
            <input type="text" value="${escapeHtml(localizeWoundStatus(getPatientStatus(patient)))}" disabled>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="ignoreTiming">
              ${game.i18n.localize("SW1E.Healing.IgnoreTiming")}
            </label>
          </div>
        </form>
      `,
      ok: {
        label: game.i18n.localize("SW1E.Healing.Method.completeRejuve"),
        callback: (event, button) => ({
          ignoreTiming: button.form.elements.ignoreTiming.checked
        })
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

async function applyMedpacTreatment(patient, data) {
  const currentStatus = getPatientStatus(patient);
  if (!canUseMedpacOnStatus(currentStatus)) {
    ui.notifications.warn(game.i18n.localize("SW1E.Healing.NoMedpacStatus"));
    return null;
  }

  const healer = game.actors?.get(data.healerId);
  if (!healer) return null;

  const healing = getHealingState(patient);
  const now = getWorldTime();

  if (!data.ignoreRestrictions && healing.medpacLocked && currentStatus !== "healthy") {
    ui.notifications.warn(game.i18n.format("SW1E.Healing.AlreadyTreated", { actor: patient.name }));
    return null;
  }

  if (!data.ignoreRestrictions && Number(healing.medpacAvailableAt) > now) {
    ui.notifications.warn(game.i18n.format("SW1E.Healing.CooldownActive", { actor: patient.name }));
    return null;
  }

  const prepared = prepareMedicineRoll(healer);
  if (prepared.blocked) {
    ui.notifications.warn(prepared.reason);
    return null;
  }

  const medpacConsumed = data.consumeMedpac ? await consumeTrackedMedpac(healer) : false;
  const difficulty = MEDPAC_DIFFICULTIES[currentStatus] ?? 0;

  const roll = await postDiceCodeMessage({
    actor: healer,
    label: `${game.i18n.localize("SW1E.Healing.Method.medpac")} — ${patient.name}`,
    dice: prepared.dice,
    pips: prepared.pips,
    modifier: data.modifier,
    diceModifier: data.diceModifier,
    flavor: `${patient.name} Medpac Treatment`,
    extraLines: [
      `<p><strong>${game.i18n.localize("SW1E.Healing.Healer")}:</strong> ${escapeHtml(healer.name)}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Healing.Patient")}:</strong> ${escapeHtml(patient.name)}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Healing.MedpacDifficulty")}:</strong> ${difficulty}</p>`,
      prepared.modifiers.length ? `<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${prepared.modifiers.map(escapeHtml).join("; ")}</p>` : "",
      `<p><strong>${game.i18n.localize("SW1E.Healing.MedpacTracking")}:</strong> ${game.i18n.localize(medpacConsumed ? "SW1E.Healing.MedpacConsumed" : "SW1E.Healing.NoTrackedMedpacConsumed")}</p>`
    ]
  });

  if (!roll) return null;

  const success = (Number(roll.total) || 0) >= difficulty;
  const nextStatus = success ? reduceWoundOneDegree(currentStatus) : currentStatus;
  const updateData = {
    "system.healing.lastMedpacAt": now,
    "system.healing.rejuveTank.active": false,
    "system.healing.rejuveTank.startedAt": 0,
    "system.healing.rejuveTank.endsAt": 0,
    "system.healing.rejuveTank.durationRoll": 0,
    "system.healing.rejuveTank.unit": "",
    "system.healing.rejuveTank.statusAtStart": ""
  };

  if (success) {
    updateData["system.status.woundStatus"] = nextStatus;
    if (currentStatus === "wounded" && nextStatus === "healthy") {
      updateData["system.healing.medpacLocked"] = false;
      updateData["system.healing.medpacAvailableAt"] = now + DAY_SECONDS;
    } else {
      updateData["system.healing.medpacLocked"] = true;
      updateData["system.healing.medpacAvailableAt"] = 0;
    }
  }

  await patient.update(updateData);

  await renderSummaryCard({
    speakerActor: healer,
    title: `${game.i18n.localize("SW1E.Healing.Method.medpac")} — ${patient.name}`,
    lines: [
      `<p><strong>${game.i18n.localize("SW1E.Healing.ResultLabel")}:</strong> ${game.i18n.localize(success ? "SW1E.Healing.Result.success" : "SW1E.Healing.Result.failure")}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Healing.StatusChange")}:</strong> ${escapeHtml(localizeWoundStatus(currentStatus))} → ${escapeHtml(localizeWoundStatus(nextStatus))}</p>`
    ]
  });

  return roll;
}

function getNaturalHealingOutcome(status, total) {
  const table = NATURAL_HEALING_OUTCOMES[status] ?? [];
  return table.find(entry => total >= entry.min && total <= entry.max) ?? null;
}

async function applyNaturalHealing(patient, data) {
  const currentStatus = getPatientStatus(patient);
  if (!canUseNaturalHealingOnStatus(currentStatus)) {
    ui.notifications.warn(game.i18n.localize("SW1E.Healing.NoNaturalStatus"));
    return null;
  }

  const healing = getHealingState(patient);
  const now = getWorldTime();
  if (!data.ignoreDailyLimit && Number(healing.lastNaturalHealingAt) > (now - DAY_SECONDS)) {
    ui.notifications.warn(game.i18n.format("SW1E.Healing.NaturalAlreadyRolled", { actor: patient.name }));
    return null;
  }

  const prepared = prepareNaturalHealingRoll(patient);
  if (prepared.blocked) {
    ui.notifications.warn(prepared.reason);
    return null;
  }

  const roll = await postDiceCodeMessage({
    actor: patient,
    label: `${game.i18n.localize("SW1E.Healing.Method.natural")} — ${patient.name}`,
    dice: prepared.dice,
    pips: prepared.pips,
    modifier: data.modifier,
    diceModifier: data.diceModifier,
    flavor: `${patient.name} Natural Healing`,
    extraLines: [
      `<p><strong>${game.i18n.localize("SW1E.Healing.Patient")}:</strong> ${escapeHtml(patient.name)}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Healing.TableReference")}</strong> ${escapeHtml(localizeWoundStatus(currentStatus))}</p>`,
      prepared.modifiers.length ? `<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${prepared.modifiers.map(escapeHtml).join("; ")}</p>` : "",
      `<p><strong>${game.i18n.localize("SW1E.Healing.NaturalNote")}</strong></p>`
    ]
  });

  if (!roll) return null;

  const outcome = getNaturalHealingOutcome(currentStatus, Number(roll.total) || 0);
  if (!outcome) return null;

  const nextStatus = outcome.nextStatus;
  const updateData = {
    "system.status.woundStatus": nextStatus,
    "system.healing.lastNaturalHealingAt": now
  };

  if (nextStatus === "healthy") {
    updateData["system.healing.medpacLocked"] = false;
  }

  await patient.update(updateData);

  await renderSummaryCard({
    speakerActor: patient,
    title: `${game.i18n.localize("SW1E.Healing.Method.natural")} — ${patient.name}`,
    lines: [
      `<p><strong>${game.i18n.localize("SW1E.Healing.ResultLabel")}:</strong> ${game.i18n.localize(`SW1E.Healing.NaturalResult.${outcome.key}`)}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Healing.StatusChange")}:</strong> ${escapeHtml(localizeWoundStatus(currentStatus))} → ${escapeHtml(localizeWoundStatus(nextStatus))}</p>`
    ]
  });

  return roll;
}

async function startRejuveTank(patient) {
  const currentStatus = getPatientStatus(patient);
  if (!canUseRejuveOnStatus(currentStatus)) {
    ui.notifications.warn(game.i18n.localize("SW1E.Healing.NoRejuveStatus"));
    return null;
  }

  const timing = REJUVE_TIMES[currentStatus];
  if (!timing) return null;

  const roll = await evaluateDiceCode({ dice: 2, pips: 0, modifier: 0 });
  const duration = Number(roll.total) || 0;
  const now = getWorldTime();
  const endsAt = now + (duration * timing.seconds);

  await patient.update({
    "system.healing.rejuveTank.active": true,
    "system.healing.rejuveTank.startedAt": now,
    "system.healing.rejuveTank.endsAt": endsAt,
    "system.healing.rejuveTank.durationRoll": duration,
    "system.healing.rejuveTank.unit": timing.unit,
    "system.healing.rejuveTank.statusAtStart": currentStatus
  });

  await renderSummaryCard({
    speakerActor: patient,
    title: `${game.i18n.localize("SW1E.Healing.Method.rejuve")} — ${patient.name}`,
    lines: [
      `<p><strong>${game.i18n.localize("SW1E.DiceCode")}:</strong> ${formatDiceCode(2, 0)}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.DiceResults")}:</strong> ${escapeHtml(formatDieResults(roll))}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Total")}:</strong> ${roll.total}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Healing.DurationLabel")}:</strong> ${duration} ${escapeHtml(game.i18n.localize(duration === 1 ? `SW1E.Healing.TimeUnit.${timing.unit.slice(0, -1)}` : `SW1E.Healing.TimeUnit.${timing.unit}`))}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Healing.ResultLabel")}:</strong> ${game.i18n.format("SW1E.Healing.RejuveAutomatic", { actor: patient.name })}</p>`
    ]
  });

  return roll;
}

async function completeRejuveTank(patient, data) {
  const rejuve = getHealingState(patient).rejuveTank ?? {};
  if (!rejuve.active) {
    ui.notifications.warn(game.i18n.format("SW1E.Healing.NoTankActive", { actor: patient.name }));
    return null;
  }

  const now = getWorldTime();
  const endsAt = Number(rejuve.endsAt) || 0;
  if (!data.ignoreTiming && endsAt > now) {
    ui.notifications.warn(game.i18n.format("SW1E.Healing.TankNotReady", { actor: patient.name }));
    return null;
  }

  const previousStatus = getPatientStatus(patient);
  await patient.update({
    "system.status.woundStatus": "healthy",
    "system.healing.medpacLocked": false,
    "system.healing.medpacAvailableAt": 0,
    "system.healing.rejuveTank.active": false,
    "system.healing.rejuveTank.startedAt": 0,
    "system.healing.rejuveTank.endsAt": 0,
    "system.healing.rejuveTank.durationRoll": 0,
    "system.healing.rejuveTank.unit": "",
    "system.healing.rejuveTank.statusAtStart": ""
  });

  await renderSummaryCard({
    speakerActor: patient,
    title: `${game.i18n.localize("SW1E.Healing.Method.completeRejuve")} — ${patient.name}`,
    lines: [
      `<p><strong>${game.i18n.localize("SW1E.Healing.StatusChange")}:</strong> ${escapeHtml(localizeWoundStatus(previousStatus))} → ${escapeHtml(localizeWoundStatus("healthy"))}</p>`
    ]
  });

  return true;
}

export async function openHealingDialog({ patient } = {}) {
  if (!patient) return null;

  const method = await promptHealingMethod(patient);
  if (!method) return null;

  if (method === "medpac") {
    const data = await promptMedpacTreatment(patient);
    if (!data) return null;
    return applyMedpacTreatment(patient, data);
  }

  if (method === "natural") {
    const data = await promptNaturalHealing(patient);
    if (!data) return null;
    return applyNaturalHealing(patient, data);
  }

  if (method === "rejuve") {
    return startRejuveTank(patient);
  }

  if (method === "completeRejuve") {
    const data = await promptCompleteRejuve(patient);
    if (!data) return null;
    return completeRejuveTank(patient, data);
  }

  return null;
}
