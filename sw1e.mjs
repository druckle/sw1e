import { SW1E } from "./module/config.mjs";
import { openCharacterBuilder } from "./module/character-builder.mjs";
import { SW1ECharacterSheet } from "./module/sheets/character-sheet.mjs";
import { SW1EStarshipSheet } from "./module/sheets/starship-sheet.mjs";
import { SW1EItemSheet } from "./module/sheets/item-sheet.mjs";
import { formatDiceCode, rollDiceCode } from "./module/dice.mjs";
import { SW1ECombat, renderSW1ECombatTracker } from "./module/initiative.mjs";
import { getHealingSummary, openHealingDialog } from "./module/healing.mjs";
import { openAdvancementDialog } from "./module/advancement.mjs";
import {
  activateForcePower,
  clearForcePointState,
  getActiveForcePointState,
  getForcePowerDifficultySummary,
  getForcePowerRequirementLabel,
  getKeptUpSkillCount,
  rollForceSkill,
  rollLightsaberParry,
  spendForcePoint,
  toggleForcePowerUp
} from "./module/force.mjs";

const SW1E_WOUND_TOKEN_VISUALS = {
  healthy: { label: "", color: 0x000000, textColor: "#ffffff", visible: false },
  stunned: { label: "S", color: 0xf1c40f, textColor: "#111111", visible: true },
  wounded: { label: "W", color: 0xe67e22, textColor: "#ffffff", visible: true },
  incapacitated: { label: "I", color: 0xe74c3c, textColor: "#ffffff", visible: true },
  mortallyWounded: { label: "M", color: 0x8e1b1b, textColor: "#ffffff", visible: true },
  dead: { label: "D", color: 0x3a3a3a, textColor: "#ffffff", visible: true }
};

function shouldDisplayWoundOverlay(token) {
  const actor = token?.actor;
  return !!actor && ["character", "npc"].includes(actor.type);
}

function ensureWoundOverlay(token) {
  if (token.sw1eWoundOverlay) return token.sw1eWoundOverlay;

  const overlay = new PIXI.Container();
  overlay.name = "sw1eWoundOverlay";
  overlay.eventMode = "none";
  overlay.zIndex = 1000;

  const ring = new PIXI.Graphics();
  ring.name = "ring";

  const badge = new PIXI.Container();
  badge.name = "badge";
  badge.eventMode = "none";
  badge.zIndex = 1001;

  const badgeBackground = new PIXI.Graphics();
  badgeBackground.name = "badgeBackground";

  const badgeText = new foundry.canvas.containers.PreciseText("", {
    fontFamily: "Signika",
    fontSize: 22,
    fontWeight: "700",
    fill: "#ffffff",
    align: "center",
    stroke: "#000000",
    strokeThickness: 3
  });
  if (badgeText.anchor?.set) badgeText.anchor.set(0.5);
  badgeText.name = "badgeText";

  badge.addChild(badgeBackground);
  badge.addChild(badgeText);
  overlay.addChild(ring);
  overlay.addChild(badge);
  token.addChild(overlay);
  token.sw1eWoundOverlay = { overlay, ring, badge, badgeBackground, badgeText };
  return token.sw1eWoundOverlay;
}

function refreshWoundOverlay(token) {
  if (!token) return;

  if (!shouldDisplayWoundOverlay(token)) {
    if (token.sw1eWoundOverlay?.overlay) token.sw1eWoundOverlay.overlay.visible = false;
    return;
  }

  const status = token.actor?.system?.status?.woundStatus ?? "healthy";
  const visual = SW1E_WOUND_TOKEN_VISUALS[status] ?? SW1E_WOUND_TOKEN_VISUALS.healthy;
  const overlayParts = ensureWoundOverlay(token);
  const { overlay, ring, badge, badgeBackground, badgeText } = overlayParts;

  overlay.visible = !!visual.visible;
  if (!visual.visible) return;

  const width = Number(token.w) || Number(token.mesh?.width) || canvas.grid?.size || 100;
  const height = Number(token.h) || Number(token.mesh?.height) || canvas.grid?.size || 100;
  const minDimension = Math.max(Math.min(width, height), 1);
  const strokeWidth = Math.max(4, Math.round(minDimension * 0.06));
  const cornerRadius = Math.max(10, Math.round(minDimension * 0.18));
  const inset = strokeWidth / 2;

  ring.clear();
  ring.lineStyle(strokeWidth, visual.color, 0.95, 1);
  ring.drawRoundedRect(inset, inset, Math.max(width - strokeWidth, 1), Math.max(height - strokeWidth, 1), cornerRadius);

  if (status === "mortallyWounded" || status === "dead") {
    const innerInset = strokeWidth * 1.6;
    ring.lineStyle(Math.max(2, Math.round(strokeWidth * 0.45)), visual.color, 0.75, 1);
    ring.drawRoundedRect(innerInset, innerInset, Math.max(width - (innerInset * 2), 1), Math.max(height - (innerInset * 2), 1), Math.max(6, cornerRadius * 0.75));
  }

  const badgeSize = Math.max(24, Math.round(minDimension * 0.42));
  const badgeOutline = Math.max(2, Math.round(badgeSize * 0.08));
  const badgeRadius = Math.max(6, Math.round(badgeSize * 0.22));
  const badgeOffset = Math.max(4, Math.round(strokeWidth * 0.45));

  badgeBackground.clear();
  badgeBackground.lineStyle(badgeOutline, 0x111111, 0.95, 1);
  badgeBackground.beginFill(visual.color, 0.95);
  badgeBackground.drawRoundedRect(-badgeSize / 2, -badgeSize / 2, badgeSize, badgeSize, badgeRadius);
  badgeBackground.endFill();

  badgeText.text = visual.label;
  badgeText.style.fontSize = Math.max(16, Math.round(badgeSize * 0.52));
  badgeText.style.fill = visual.textColor;
  badgeText.position.set(0, 0);

  badge.position.set(width - (badgeSize / 2) - badgeOffset, (badgeSize / 2) + badgeOffset);
}

Hooks.once("init", () => {
  console.log("SW1E | Initializing Star Wars 1E system");

  CONFIG.SW1E = SW1E;
  CONFIG.Combat.documentClass = SW1ECombat;

  foundry.documents.collections.Actors.registerSheet("sw1e", SW1ECharacterSheet, {
    types: ["character", "npc"],
    makeDefault: true,
    label: "SW1E.Sheets.Character"
  });

  foundry.documents.collections.Actors.registerSheet("sw1e", SW1EStarshipSheet, {
    types: ["starship"],
    makeDefault: true,
    label: "SW1E.Sheets.Starship"
  });

  foundry.documents.collections.Items.registerSheet("sw1e", SW1EItemSheet, {
    types: ["skill", "equipment", "weapon", "forcePower", "starshipWeapon", "shipSystem", "astrogationRoute"],
    makeDefault: true,
    label: "SW1E.Sheets.Item"
  });

  Handlebars.registerHelper("sw1eDiceCode", (dice, pips) => formatDiceCode(dice, pips));
  Handlebars.registerHelper("sw1eEq", (a, b) => a === b);

  game.sw1e = {
    config: SW1E,
    formatDiceCode,
    rollDiceCode,
    rollForceSkill,
    rollLightsaberParry,
    spendForcePoint,
    clearForcePointState,
    getActiveForcePointState,
    activateForcePower,
    toggleForcePowerUp,
    getForcePowerRequirementLabel,
    getForcePowerDifficultySummary,
    getKeptUpSkillCount,
    getHealingSummary,
    openHealingDialog,
    openAdvancementDialog,
    openCharacterBuilder
  };
});


function stripEconomyNoteText(notes = "") {
  return String(notes ?? "")
    .replace(/\s*Cost:\s*[\d,]+\s*credits\.?\s*/i, " ")
    .replace(/\s*The Cost Chart lists Flak Vest at [\d,]+ credits under a different name\.?\s*/i, " ")
    .replace(/\s*Cost is not listed(?: under this exact name)? in the Cost Chart\.?\s*/i, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}


function splitStructuredCredits(value) {
  if (value === null || value === undefined || value === "") return { amount: "", note: "" };

  if (Number.isFinite(Number(value))) {
    return { amount: Math.trunc(Number(value)), note: "" };
  }

  const text = String(value).trim();
  if (!text) return { amount: "", note: "" };

  const match = text.match(/-?\d[\d,]*/);
  const amount = match ? Number(match[0].replace(/,/g, "")) : "";
  const note = text.replace(/^\s*-?\d[\d,]*\s*credits?(?:\s+standard)?\s*[;,:-]?\s*/i, "").trim();

  return {
    amount: Number.isFinite(amount) ? Math.trunc(amount) : "",
    note
  };
}

function splitStructuredCost(system = {}) {
  const existingCost = system?.cost;
  if (existingCost !== null && existingCost !== undefined && existingCost !== "") {
    return null;
  }

  const notes = String(system?.notes ?? "");
  const match = notes.match(/Cost:\s*([\d,]+)\s*credits\.?/i);
  if (!match) return null;

  const cost = Number(match[1].replace(/,/g, ""));
  const cleanedNotes = stripEconomyNoteText(notes);

  return {
    cost: Number.isFinite(cost) ? Math.trunc(cost) : null,
    notes: cleanedNotes
  };
}

function appendUniqueNote(existing = "", addition = "") {
  const current = String(existing ?? "").trim();
  const next = String(addition ?? "").trim();
  if (!next) return current;
  if (!current) return next;
  if (current.split(/\n+/).includes(next)) return current;
  return `${current}\n${next}`;
}

function getStructuredGrenadeData(source = {}) {
  if (source.type !== "weapon") return null;

  const name = String(source.name ?? "").trim().toLowerCase();
  const system = source.system ?? {};
  const notes = String(system.notes ?? "");
  const range = String(system.range ?? "");
  const skillUsed = String(system.skillUsed ?? "");
  const looksLikeGrenade = Boolean(system.isGrenade) || /grenade|thermal detonator/i.test(name) || /grenade/i.test(skillUsed) || /^throw\s*:/i.test(range);
  if (!looksLikeGrenade) return null;

  const clone = foundry.utils.deepClone(system);
  clone.isGrenade = true;
  clone.grenadeTargetNumberMode ??= "max";

  const hitMatch = notes.match(/Hit bands:\s*(\d+)\s*[-–—]\s*(\d+)\s*\/\s*(\d+)\s*[-–—]\s*(\d+)\s*\/\s*(\d+)\s*[-–—]\s*(\d+)/i);
  if (hitMatch) {
    clone.grenadeShortTNMin = Number(hitMatch[1]);
    clone.grenadeShortTNMax = Number(hitMatch[2]);
    clone.grenadeMediumTNMin = Number(hitMatch[3]);
    clone.grenadeMediumTNMax = Number(hitMatch[4]);
    clone.grenadeLongTNMin = Number(hitMatch[5]);
    clone.grenadeLongTNMax = Number(hitMatch[6]);
  }

  const damageMatch = notes.match(/Blast damage by distance:\s*(\d+)D(?:\+(\d))?\s*\/\s*(\d+)D(?:\+(\d))?\s*\/\s*(\d+)D(?:\+(\d))?\s*\/\s*(\d+)D(?:\+(\d))?/i);
  if (damageMatch) {
    clone.blastPointBlankDamageDice = Number(damageMatch[1]);
    clone.blastPointBlankDamagePips = Number(damageMatch[2] || 0);
    clone.blastShortDamageDice = Number(damageMatch[3]);
    clone.blastShortDamagePips = Number(damageMatch[4] || 0);
    clone.blastMediumDamageDice = Number(damageMatch[5]);
    clone.blastMediumDamagePips = Number(damageMatch[6] || 0);
    clone.blastLongDamageDice = Number(damageMatch[7]);
    clone.blastLongDamagePips = Number(damageMatch[8] || 0);
  }

  clone.blastPointBlankMax = 2;
  if (name === "grenade") {
    clone.grenadeShortTNMin ??= 3;
    clone.grenadeShortTNMax ??= 4;
    clone.grenadeMediumTNMin ??= 5;
    clone.grenadeMediumTNMax ??= 6;
    clone.grenadeLongTNMin ??= 7;
    clone.grenadeLongTNMax ??= 10;
    clone.blastShortMax = 4;
    clone.blastMediumMax = 6;
    clone.blastLongMax = 10;
    clone.blastPointBlankDamageDice ??= 5;
    clone.blastPointBlankDamagePips ??= 0;
    clone.blastShortDamageDice ??= 4;
    clone.blastShortDamagePips ??= 0;
    clone.blastMediumDamageDice ??= 3;
    clone.blastMediumDamagePips ??= 0;
    clone.blastLongDamageDice ??= 2;
    clone.blastLongDamagePips ??= 0;
  } else if (name === "thermal detonator") {
    clone.grenadeShortTNMin ??= 3;
    clone.grenadeShortTNMax ??= 8;
    clone.grenadeMediumTNMin ??= 9;
    clone.grenadeMediumTNMax ??= 12;
    clone.grenadeLongTNMin ??= 13;
    clone.grenadeLongTNMax ??= 20;
    clone.blastShortMax = 8;
    clone.blastMediumMax = 12;
    clone.blastLongMax = 20;
    clone.blastPointBlankDamageDice ??= 10;
    clone.blastPointBlankDamagePips ??= 0;
    clone.blastShortDamageDice ??= 8;
    clone.blastShortDamagePips ??= 0;
    clone.blastMediumDamageDice ??= 5;
    clone.blastMediumDamagePips ??= 0;
    clone.blastLongDamageDice ??= 2;
    clone.blastLongDamagePips ??= 0;
  }

  return clone;
}

function normalizeGrenadeWeaponSource(source = {}) {
  if (source.type !== "weapon") return source;
  const grenadeData = getStructuredGrenadeData(source);
  if (!grenadeData) return source;

  const cloned = foundry.utils.deepClone(source);
  cloned.system = foundry.utils.mergeObject(cloned.system ?? {}, grenadeData, { inplace: false, overwrite: true });
  return cloned;
}

function normalizeLightsaberSkill(source = {}) {
  source = normalizeGrenadeWeaponSource(source);
  if (source.type !== "weapon") return source;

  const cloned = foundry.utils.deepClone(source);
  cloned.system ??= {};

  const name = String(cloned.name ?? "").trim().toLowerCase();
  const looksLikeLightsaber = name === "lightsaber" || cloned.system.isLightsaber || cloned.system.lightsaberUsesControlDamage || cloned.system.lightsaberUsesSenseParry;
  if (!looksLikeLightsaber) return cloned;

  if (cloned.system.skillUsed === "Dexterity") {
    cloned.system.skillUsed = "Melee Weapons";
  }

  cloned.system.isLightsaber = true;
  cloned.system.lightsaberUsesControlDamage = true;
  cloned.system.lightsaberUsesSenseParry = true;

  const existingNotes = String(cloned.system.notes ?? "");
  const noteParts = [];
  if (!/Primary attack skill:\s*Melee Weapons\./i.test(existingNotes)) {
    noteParts.push("Primary attack skill: Melee Weapons. Trained users may instead use a custom Lightsaber skill if the item is changed to match it.");
  }
  if (!/characters with the Control skill add their skill code to damage/i.test(existingNotes)) {
    noteParts.push("Damage: 5D; characters with the Control skill add their skill code to damage.");
  }
  if (!/Sense may use Sense instead of melee parry and may parry blaster bolts/i.test(existingNotes)) {
    noteParts.push("Characters with Sense may use Sense instead of melee parry and may parry blaster bolts.");
  }
  if (noteParts.length) {
    cloned.system.notes = `${noteParts.join(" ")} ${existingNotes}`.trim();
  }

  return cloned;
}


async function migrateGrenadeWeapons() {
  if (!game.user?.isGM) return;

  const buildUpdate = item => {
    const structured = getStructuredGrenadeData(item.toObject ? item.toObject() : item);
    if (!structured) return null;
    return {
      _id: item.id,
      "system.isGrenade": !!structured.isGrenade,
      "system.grenadeTargetNumberMode": structured.grenadeTargetNumberMode ?? "max",
      "system.grenadeShortTNMin": Number(structured.grenadeShortTNMin) || 0,
      "system.grenadeShortTNMax": Number(structured.grenadeShortTNMax) || 0,
      "system.grenadeMediumTNMin": Number(structured.grenadeMediumTNMin) || 0,
      "system.grenadeMediumTNMax": Number(structured.grenadeMediumTNMax) || 0,
      "system.grenadeLongTNMin": Number(structured.grenadeLongTNMin) || 0,
      "system.grenadeLongTNMax": Number(structured.grenadeLongTNMax) || 0,
      "system.blastPointBlankMax": Number(structured.blastPointBlankMax) || 2,
      "system.blastShortMax": Number(structured.blastShortMax) || 0,
      "system.blastMediumMax": Number(structured.blastMediumMax) || 0,
      "system.blastLongMax": Number(structured.blastLongMax) || 0,
      "system.blastPointBlankDamageDice": Number(structured.blastPointBlankDamageDice) || 0,
      "system.blastPointBlankDamagePips": Number(structured.blastPointBlankDamagePips) || 0,
      "system.blastShortDamageDice": Number(structured.blastShortDamageDice) || 0,
      "system.blastShortDamagePips": Number(structured.blastShortDamagePips) || 0,
      "system.blastMediumDamageDice": Number(structured.blastMediumDamageDice) || 0,
      "system.blastMediumDamagePips": Number(structured.blastMediumDamagePips) || 0,
      "system.blastLongDamageDice": Number(structured.blastLongDamageDice) || 0,
      "system.blastLongDamagePips": Number(structured.blastLongDamagePips) || 0
    };
  };

  const actorUpdates = [];
  for (const actor of game.actors?.contents ?? []) {
    const updates = actor.items
      .filter(item => item.type === "weapon")
      .map(buildUpdate)
      .filter(Boolean);
    if (updates.length) actorUpdates.push(actor.updateEmbeddedDocuments("Item", updates));
  }

  const worldItemUpdates = (game.items?.contents ?? [])
    .filter(item => item.type === "weapon")
    .map(item => {
      const update = buildUpdate(item);
      return update ? item.update(foundry.utils.expandObject(update)) : null;
    })
    .filter(Boolean);

  await Promise.all([...actorUpdates, ...worldItemUpdates]);
}

async function migrateLightsabers() {
  if (!game.user?.isGM) return;

  const actorUpdates = [];
  for (const actor of game.actors?.contents ?? []) {
    if (!["character", "npc"].includes(actor.type)) continue;

    const updates = actor.items
      .filter(item => item.type === "weapon" && (item.name === "Lightsaber" || item.system?.isLightsaber || item.system?.lightsaberUsesControlDamage || item.system?.lightsaberUsesSenseParry))
      .map(item => {
        const normalized = normalizeLightsaberSkill(item.toObject ? item.toObject() : item);
        return {
          _id: item.id,
          "system.skillUsed": normalized.system.skillUsed,
          "system.isLightsaber": !!normalized.system.isLightsaber,
          "system.lightsaberUsesControlDamage": !!normalized.system.lightsaberUsesControlDamage,
          "system.lightsaberUsesSenseParry": !!normalized.system.lightsaberUsesSenseParry,
          "system.notes": normalized.system.notes
        };
      });

    if (updates.length) actorUpdates.push(actor.updateEmbeddedDocuments("Item", updates));
  }

  const worldItemUpdates = (game.items?.contents ?? [])
    .filter(item => item.type === "weapon" && (item.name === "Lightsaber" || item.system?.isLightsaber || item.system?.lightsaberUsesControlDamage || item.system?.lightsaberUsesSenseParry))
    .map(item => {
      const normalized = normalizeLightsaberSkill(item.toObject ? item.toObject() : item);
      return item.update({
        "system.skillUsed": normalized.system.skillUsed,
        "system.isLightsaber": !!normalized.system.isLightsaber,
        "system.lightsaberUsesControlDamage": !!normalized.system.lightsaberUsesControlDamage,
        "system.lightsaberUsesSenseParry": !!normalized.system.lightsaberUsesSenseParry,
        "system.notes": normalized.system.notes
      });
    });

  await Promise.all([...actorUpdates, ...worldItemUpdates]);
}

function getDefaultActorIcon(actorType) {
  const iconMap = {
    character: "systems/sw1e/icons/character.svg",
    npc: "systems/sw1e/icons/npc.svg",
    starship: "systems/sw1e/icons/starship.svg"
  };

  return iconMap[actorType] ?? null;
}

Hooks.on("preCreateActor", (actor, data) => {
  const updates = {};
  const actorType = data.type || actor.type;
  const currentImg = data.img || actor.img || "";
  const defaultImg = getDefaultActorIcon(actorType);

  if ((!currentImg || currentImg === "icons/svg/mystery-man.svg") && defaultImg) {
    updates.img = defaultImg;
    updates.prototypeToken = {
      ...(updates.prototypeToken ?? {}),
      texture: { src: defaultImg }
    };
  }

  if (actorType === "character") {
    updates.prototypeToken = {
      ...(updates.prototypeToken ?? {}),
      actorLink: true,
      disposition: 1
    };
  }

  if (Object.keys(updates).length) {
    actor.updateSource(updates);
  }
});

function getDefaultItemIcon(itemType) {
  const iconMap = {
    skill: "systems/sw1e/icons/skill.svg",
    equipment: "systems/sw1e/icons/equipment.svg",
    weapon: "systems/sw1e/icons/weapon.svg",
    forcePower: "systems/sw1e/icons/force-power.svg",
    starshipWeapon: "systems/sw1e/icons/starship-weapon.svg",
    shipSystem: "systems/sw1e/icons/ship-system.svg",
    astrogationRoute: "systems/sw1e/icons/astrogation-route.svg"
  };

  return iconMap[itemType] ?? null;
}

Hooks.on("preCreateItem", (item, data) => {
  const itemSource = normalizeLightsaberSkill({
    ...item.toObject(),
    ...data,
    system: foundry.utils.mergeObject(foundry.utils.deepClone(item.system ?? {}), data.system ?? {}, { inplace: false })
  });

  const systemUpdates = {};

  if (itemSource.system?.skillUsed === "Melee Weapons" && data.system?.skillUsed === "Dexterity") {
    systemUpdates.skillUsed = "Melee Weapons";
    systemUpdates.notes = itemSource.system.notes;
  }

  if (itemSource.system?.isLightsaber) {
    systemUpdates.isLightsaber = true;
    systemUpdates.lightsaberUsesControlDamage = !!itemSource.system.lightsaberUsesControlDamage;
    systemUpdates.lightsaberUsesSenseParry = !!itemSource.system.lightsaberUsesSenseParry;
    if (!systemUpdates.notes) systemUpdates.notes = itemSource.system.notes;
  }

  if (itemSource.system?.isGrenade && !data.system?.isGrenade) {
    for (const key of [
      "isGrenade",
      "grenadeTargetNumberMode",
      "grenadeShortTNMin",
      "grenadeShortTNMax",
      "grenadeMediumTNMin",
      "grenadeMediumTNMax",
      "grenadeLongTNMin",
      "grenadeLongTNMax",
      "blastPointBlankMax",
      "blastShortMax",
      "blastMediumMax",
      "blastLongMax",
      "blastPointBlankDamageDice",
      "blastPointBlankDamagePips",
      "blastShortDamageDice",
      "blastShortDamagePips",
      "blastMediumDamageDice",
      "blastMediumDamagePips",
      "blastLongDamageDice",
      "blastLongDamagePips"
    ]) {
      systemUpdates[key] = itemSource.system[key];
    }
  }

  if (Object.keys(systemUpdates).length) {
    item.updateSource({ system: systemUpdates });
  }

  const currentImg = data.img || item.img || "";
  if (currentImg && currentImg !== "icons/svg/item-bag.svg") return;

  const defaultImg = getDefaultItemIcon(item.type);
  if (!defaultImg) return;

  item.updateSource({ img: defaultImg });
});


Hooks.on("renderCombatTracker", (app, html) => {
  renderSW1ECombatTracker(app, html);
});

Hooks.on("renderActorDirectory", (app, html) => {
  const jq = globalThis.jQuery ?? globalThis.$;
  if (!jq) return;
  const $html = (globalThis.jQuery && html instanceof globalThis.jQuery) ? html : jq(html);
  if ($html.find(".sw1e-open-builder").length) return;

  const canCreate = typeof game.user?.can === "function" ? game.user.can("ACTOR_CREATE") : true;
  if (canCreate === false) return;

  const button = $(`
    <button type="button" class="sw1e-open-builder">
      <i class="fas fa-user-plus"></i>
      ${game.i18n.localize("SW1E.Builder.Open")}
    </button>
  `);

  button.on("click", event => {
    event.preventDefault();
    openCharacterBuilder();
  });

  const headerActions = $html.find(".header-actions");
  if (headerActions.length) {
    headerActions.first().append(button);
    return;
  }

  const directoryHeader = $html.find(".directory-header");
  if (directoryHeader.length) {
    directoryHeader.first().append(button);
  }
});


Hooks.on("canvasReady", () => {
  for (const token of canvas.tokens?.placeables ?? []) {
    refreshWoundOverlay(token);
  }
});

Hooks.on("refreshToken", token => {
  refreshWoundOverlay(token);
});

Hooks.on("updateActor", (actor, change) => {
  if (!foundry.utils.hasProperty(change, "system.status.woundStatus")) return;
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor?.id === actor.id) refreshWoundOverlay(token);
  }
});

Hooks.on("updateToken", (tokenDocument, change) => {
  if (!foundry.utils.hasProperty(change, "actorData.system.status.woundStatus")) return;
  tokenDocument.object && refreshWoundOverlay(tokenDocument.object);
});


async function migrateStructuredEconomy() {
  if (!game.user?.isGM) return;

  const actorUpdates = [];
  for (const actor of game.actors?.contents ?? []) {
    if (!["character", "npc"].includes(actor.type)) continue;

    const updates = {};
    const parsedCredits = splitStructuredCredits(actor.system?.resources?.credits);
    if (parsedCredits.amount !== "" && actor.system?.resources?.credits !== parsedCredits.amount) {
      updates["system.resources.credits"] = parsedCredits.amount;
    }

    if (parsedCredits.note) {
      updates["system.notes.storyNotes"] = appendUniqueNote(actor.system?.notes?.storyNotes ?? "", `Financial note: ${parsedCredits.note}`);
    }

    const embeddedUpdates = actor.items
      .filter(item => ["equipment", "weapon"].includes(item.type))
      .map(item => {
        const migrated = splitStructuredCost(item.system);
        const currentNotes = String(item.system?.notes ?? "");
        const cleanedNotes = stripEconomyNoteText(currentNotes);
        const update = { _id: item.id };
        let changed = false;

        if (migrated) {
          update["system.cost"] = migrated.cost;
          update["system.notes"] = migrated.notes;
          changed = true;
        }

        if (!migrated && cleanedNotes !== currentNotes) {
          update["system.notes"] = cleanedNotes;
          changed = true;
        }

        return changed ? update : null;
      })
      .filter(Boolean);

    if (Object.keys(updates).length) actorUpdates.push(actor.update(updates));
    if (embeddedUpdates.length) actorUpdates.push(actor.updateEmbeddedDocuments("Item", embeddedUpdates));
  }

  const worldItemUpdates = (game.items?.contents ?? [])
    .filter(item => ["equipment", "weapon"].includes(item.type))
    .map(item => {
      const migrated = splitStructuredCost(item.system);
      const currentNotes = String(item.system?.notes ?? "");
      const cleanedNotes = stripEconomyNoteText(currentNotes);
      const update = {};

      if (migrated) {
        update["system.cost"] = migrated.cost;
        update["system.notes"] = migrated.notes;
      } else if (cleanedNotes !== currentNotes) {
        update["system.notes"] = cleanedNotes;
      }

      return Object.keys(update).length ? item.update(update) : null;
    })
    .filter(Boolean);

  await Promise.all([...actorUpdates, ...worldItemUpdates]);
}

Hooks.once("ready", async () => {
  await migrateGrenadeWeapons();
  await migrateLightsabers();
  await migrateStructuredEconomy();
});
