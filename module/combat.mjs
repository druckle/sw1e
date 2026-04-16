import { SW1E } from "./config.mjs";
import {
  adjustDiceCode,
  evaluateDiceCode,
  formatDiceCode,
  formatDieResults,
  isRollableDiceCode,
  multiplyDiceCode,
  postDiceCodeMessage
} from "./dice.mjs";
import {
  getSW1EActionPenalty,
  getSW1EStoredDefense,
  isReactionActionLabel,
  registerSW1EReactionRoll,
  registerSW1EReactionUse
} from "./initiative.mjs";
import { getEffectiveForceSkillCode, isForcePointActive } from "./force.mjs";

const DEFAULT_ATTACK_DIFFICULTIES = {
  pointBlank: 5,
  short: 10,
  medium: 15,
  long: 20
};

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

function isLightsaberWeapon(weapon) {
  if (!weapon || weapon.type !== "weapon") return false;
  if (weapon.system?.isLightsaber || weapon.system?.lightsaberUsesControlDamage || weapon.system?.lightsaberUsesSenseParry) return true;
  return normalizeLookup(weapon.name) === "lightsaber";
}

function isBlasterWeapon(weapon) {
  if (!weapon || weapon.type !== "weapon") return false;
  if (weapon.system?.isGrenade) return false;

  const skillLookup = normalizeLookup(weapon.system?.skillUsed);
  if (skillLookup.includes("blaster") || skillLookup.includes("heavy weapons")) return true;

  const nameLookup = normalizeLookup(weapon.name);
  return nameLookup.includes("blaster");
}

function getWeaponDamageCode(actor, weapon) {
  let damageCode = {
    dice: Number(weapon?.system?.damageDice) || 0,
    pips: Number(weapon?.system?.damagePips) || 0
  };
  const modifiers = [];

  if (isLightsaberWeapon(weapon) && weapon?.system?.lightsaberUsesControlDamage !== false) {
    const control = getEffectiveForceSkillCode(actor, "control");
    if (isRollableDiceCode(control.base.dice, control.base.pips)) {
      damageCode = adjustDiceCode(damageCode, { dice: control.dice, pips: control.pips });
      modifiers.push(game.i18n.format("SW1E.Combat.LightsaberControlDamage", { control: formatDiceCode(control.dice, control.pips) }));
      modifiers.push(...control.modifiers);
    }
  }

  return {
    dice: damageCode.dice,
    pips: damageCode.pips,
    modifiers
  };
}

function localizeAttrKey(key) {
  return game.i18n.localize(SW1E.attributes[key] ?? key);
}


function localizeForceSkillKey(key) {
  return game.i18n.localize(SW1E.forceSkills[key] ?? key);
}

function inferAttributeForSkillLabel(skillUsed = "") {
  const lookup = normalizeLookup(skillUsed);
  if (!lookup) return null;

  const direct = {
    blaster: "dexterity",
    "brawling": "strength",
    "brawling parry": "dexterity",
    dodge: "dexterity",
    grenade: "dexterity",
    "heavy weapons": "dexterity",
    "melee parry": "dexterity",
    "melee weapons": "dexterity",
    control: "force:control",
    sense: "force:sense",
    alter: "force:alter"
  };
  if (direct[lookup]) return direct[lookup];

  if (lookup.includes("lightsaber")) return "dexterity";
  if (lookup.includes("blaster") || lookup.includes("heavy weapons") || lookup.includes("grenade") || lookup.includes("melee parry") || lookup.includes("melee weapons") || lookup.includes("dodge") || lookup.includes("brawling parry")) return "dexterity";
  if (lookup == "brawling" || lookup.includes("climbing") || lookup.includes("jumping")) return "strength";
  if (lookup.includes("astrogation") || lookup.includes("beast riding") || lookup.includes("gunnery") || lookup.includes("repulsorlift") || lookup.includes("starship piloting") || lookup.includes("starship shields")) return "mechanical";
  if (lookup.includes("alien races") || lookup.includes("bureaucracy") || lookup.includes("cultures") || lookup.includes("languages") || lookup.includes("planetary systems") || lookup.includes("streetwise") || lookup.includes("survival") || lookup.includes("technology")) return "knowledge";
  if (lookup.includes("bargain") || lookup.includes("command") || lookup.includes("con") || lookup.includes("gambling") || lookup.includes("hide") || lookup.includes("sneak") || lookup.includes("search")) return "perception";
  if (lookup.includes("computer programming") || lookup.includes("demolition") || lookup.includes("droid programming") || lookup.includes("medicine") || lookup.includes("repair") || lookup.includes("security")) return "technical";

  return null;
}

function findForceActionCode(actor, skillUsed = "") {
  const lookup = normalizeLookup(skillUsed);
  if (!lookup) return null;

  for (const key of SW1E.forceSkillKeys ?? []) {
    const data = actor.system.force?.[key] ?? {};
    const names = [key, localizeForceSkillKey(key), data.label ?? key];
    if (!names.some(name => normalizeLookup(name) === lookup)) continue;
    return {
      type: "force",
      key,
      label: localizeForceSkillKey(key),
      dice: Number(data.dice) || 0,
      pips: Number(data.pips) || 0,
      usesDexterity: false
    };
  }

  return null;
}

function buildAttributeFallbackActionCode(actor, attributeKey, skillLabel = "") {
  if (!attributeKey || String(attributeKey).startsWith("force:")) return null;
  const attr = actor.system.attributes?.[attributeKey];
  if (!attr) return null;
  return {
    type: "attribute",
    key: attributeKey,
    label: skillLabel ? `${skillLabel} (${localizeAttrKey(attributeKey)})` : localizeAttrKey(attributeKey),
    dice: Number(attr.dice) || 0,
    pips: Number(attr.pips) || 0,
    usesDexterity: attributeKey === "dexterity",
    untrainedSkill: skillLabel || ""
  };
}

function findExactSkillItem(actor, skillUsed = "") {
  const lookup = normalizeLookup(skillUsed);
  if (!lookup) return null;
  return actor.items.find(item => item.type === "skill" && normalizeLookup(item.name) === lookup) ?? null;
}

function buildSkillActionCode(skillItem) {
  if (!skillItem) return null;
  return {
    type: "skill",
    key: skillItem.id,
    label: skillItem.name,
    dice: Number(skillItem.system.dice) || 0,
    pips: Number(skillItem.system.pips) || 0,
    usesDexterity: skillItem.system.linkedAttribute === "dexterity"
  };
}

function findWeaponActionCode(actor, weapon) {
  if (!actor || !weapon) return null;

  if (isLightsaberWeapon(weapon)) {
    const lightsaberSkill = findExactSkillItem(actor, "Lightsaber");
    if (lightsaberSkill) return buildSkillActionCode(lightsaberSkill);
  }

  const configured = findActionCode(actor, weapon.system?.skillUsed);
  if (configured) return configured;

  return null;
}

function resolveWeaponAttackSkillLabel(actor, weapon) {
  const actionCode = findWeaponActionCode(actor, weapon);
  if (!actionCode) return String(weapon?.system?.skillUsed ?? "");
  return actionCode.label;
}

function getSeverity(status = "healthy") {
  return SW1E.woundSeverity[status] ?? 0;
}

function formatDistanceUnits(distance = 0) {
  const numeric = Number(distance);
  if (!Number.isFinite(numeric)) return "";
  const rounded = Math.round(numeric * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function parseWeaponRangeBands(rangeText = "") {
  const raw = String(rangeText ?? "").trim();
  if (!raw) return null;
  if (/^melee$/i.test(raw)) {
    return {
      type: "melee",
      raw,
      bands: null
    };
  }

  const matches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/g)];
  if (matches.length < 3) return null;

  const [shortBand, mediumBand, longBand] = matches.slice(0, 3).map(match => ({
    min: Number(match[1]),
    max: Number(match[2])
  }));

  return {
    type: /^throw/i.test(raw) ? "thrown" : "ranged",
    raw,
    bands: {
      short: shortBand,
      medium: mediumBand,
      long: longBand
    }
  };
}

function resolveAttackSourceToken(actor) {
  if (!canvas?.ready) return null;

  const tokenObject = actor.token?.object;
  if (tokenObject) return tokenObject;

  const activeTokens = actor.getActiveTokens(false, false).filter(Boolean);
  if (!activeTokens.length) return null;

  return activeTokens.find(token => token.controlled) ?? activeTokens[0];
}

function resolveSingleTargetToken() {
  if (!canvas?.ready) return null;

  const targets = Array.from(game.user?.targets ?? []).filter(Boolean);
  if (targets.length !== 1) return null;
  return targets[0];
}

function measureTokenDistance(sourceToken, targetToken) {
  if (!canvas?.ready || !sourceToken?.document || !targetToken?.document) return null;

  const sourcePoint = sourceToken.document.getCenterPoint();
  const targetPoint = targetToken.document.getCenterPoint();
  const measurement = canvas.grid.measurePath([sourcePoint, targetPoint]);
  const distance = Number(measurement?.distance);
  return Number.isFinite(distance) ? distance : null;
}

function determineRangeBand(distance, rangeData) {
  if (!rangeData?.bands) return null;

  const numericDistance = Number(distance);
  if (!Number.isFinite(numericDistance)) return null;

  if (numericDistance < 3) {
    return {
      rangeBand: "pointBlank",
      defaultTarget: DEFAULT_ATTACK_DIFFICULTIES.pointBlank,
      outOfRange: false
    };
  }

  if (numericDistance <= rangeData.bands.short.max) {
    return {
      rangeBand: "short",
      defaultTarget: DEFAULT_ATTACK_DIFFICULTIES.short,
      outOfRange: false
    };
  }

  if (numericDistance <= rangeData.bands.medium.max) {
    return {
      rangeBand: "medium",
      defaultTarget: DEFAULT_ATTACK_DIFFICULTIES.medium,
      outOfRange: false
    };
  }

  if (numericDistance <= rangeData.bands.long.max) {
    return {
      rangeBand: "long",
      defaultTarget: DEFAULT_ATTACK_DIFFICULTIES.long,
      outOfRange: false
    };
  }

  return {
    rangeBand: "custom",
    defaultTarget: 0,
    outOfRange: true
  };
}

function getAutoRangeContext(actor, weapon) {
  const rangeData = parseWeaponRangeBands(weapon.system.range);
  if (!rangeData || rangeData.type === "melee") return null;

  const sourceToken = resolveAttackSourceToken(actor);
  const targetToken = resolveSingleTargetToken();
  if (!sourceToken || !targetToken) return null;

  const distance = measureTokenDistance(sourceToken, targetToken);
  if (distance === null) return null;

  const derived = determineRangeBand(distance, rangeData);
  if (!derived) return null;

  return {
    sourceToken,
    targetToken,
    distance,
    distanceLabel: formatDistanceUnits(distance),
    rangeData,
    derived
  };
}

function parseGrenadeBandTriplet(value = "") {
  const matches = [...String(value ?? "").matchAll(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/g)];
  if (matches.length < 3) return null;
  const [shortBand, mediumBand, longBand] = matches.slice(0, 3).map(match => ({
    min: Number(match[1]),
    max: Number(match[2]),
    label: `${match[1]}-${match[2]}`
  }));
  return { short: shortBand, medium: mediumBand, long: longBand };
}

function getGrenadeProfile(weapon) {
  const system = weapon?.system ?? {};
  const notes = String(system.notes ?? "");
  const rangeData = parseWeaponRangeBands(system.range);
  const attackType = inferWeaponAttackType(weapon, rangeData);
  const looksLikeGrenade = Boolean(system.isGrenade) || attackType === "grenade";
  if (!looksLikeGrenade) return null;

  const throwBands = rangeData?.bands ?? null;
  const fallbackHitBands = parseGrenadeBandTriplet(notes.match(/Hit bands:\s*([^.]*)/i)?.[1] ?? "");
  const hitBands = {
    short: { min: Number(system.grenadeShortTNMin) || Number(fallbackHitBands?.short?.min) || 0, max: Number(system.grenadeShortTNMax) || Number(fallbackHitBands?.short?.max) || 0 },
    medium: { min: Number(system.grenadeMediumTNMin) || Number(fallbackHitBands?.medium?.min) || 0, max: Number(system.grenadeMediumTNMax) || Number(fallbackHitBands?.medium?.max) || 0 },
    long: { min: Number(system.grenadeLongTNMin) || Number(fallbackHitBands?.long?.min) || Number(fallbackHitBands?.long?.max) || 0, max: Number(system.grenadeLongTNMax) || Number(fallbackHitBands?.long?.max) || 0 }
  };

  const pointBlankDamageMatch = notes.match(/Blast damage by distance:\s*(\d+)D(?:\+(\d))?/i);
  const pointBlankDamage = {
    dice: Number(system.blastPointBlankDamageDice) || Number(pointBlankDamageMatch?.[1]) || Number(system.damageDice) || 0,
    pips: Number(system.blastPointBlankDamagePips) || Number(pointBlankDamageMatch?.[2]) || 0
  };

  const blast = {
    pointBlankMax: Number(system.blastPointBlankMax) || 2,
    shortMax: Number(system.blastShortMax) || (weapon.name === "Thermal Detonator" ? 8 : 4),
    mediumMax: Number(system.blastMediumMax) || (weapon.name === "Thermal Detonator" ? 12 : 6),
    longMax: Number(system.blastLongMax) || (weapon.name === "Thermal Detonator" ? 20 : 10),
    pointBlankDamage,
    shortDamage: { dice: Number(system.blastShortDamageDice) || (weapon.name === "Thermal Detonator" ? 8 : 4), pips: Number(system.blastShortDamagePips) || 0 },
    mediumDamage: { dice: Number(system.blastMediumDamageDice) || (weapon.name === "Thermal Detonator" ? 5 : 3), pips: Number(system.blastMediumDamagePips) || 0 },
    longDamage: { dice: Number(system.blastLongDamageDice) || 2, pips: Number(system.blastLongDamagePips) || 0 }
  };

  return {
    throwBands,
    hitBands,
    blast,
    targetNumberMode: String(system.grenadeTargetNumberMode || "max").toLowerCase()
  };
}

function getGrenadeThrowContext(weapon, distance) {
  const profile = getGrenadeProfile(weapon);
  if (!profile?.throwBands) return null;

  const numericDistance = Number(distance);
  if (!Number.isFinite(numericDistance)) return null;

  let rangeBand = null;
  if (numericDistance >= profile.throwBands.short.min && numericDistance <= profile.throwBands.short.max) rangeBand = "short";
  else if (numericDistance >= profile.throwBands.medium.min && numericDistance <= profile.throwBands.medium.max) rangeBand = "medium";
  else if (numericDistance >= profile.throwBands.long.min && numericDistance <= profile.throwBands.long.max) rangeBand = "long";
  else if (numericDistance < 3) rangeBand = "short";

  if (!rangeBand) {
    return { profile, outOfRange: true, rangeBand: "custom", targetNumber: 0, targetNumberLabel: game.i18n.localize("SW1E.Combat.Grenade.OutOfRange") };
  }

  const hitBand = profile.hitBands[rangeBand] ?? { min: 0, max: 0 };
  const useMin = profile.targetNumberMode === "min";
  const targetNumber = Number(useMin ? hitBand.min : hitBand.max) || 0;
  const targetNumberLabel = hitBand.min && hitBand.max ? `${hitBand.min}-${hitBand.max}` : String(targetNumber || 0);

  return { profile, outOfRange: false, rangeBand, targetNumber, targetNumberLabel };
}

function measurePointDistance(sourcePoint, targetPoint) {
  if (!canvas?.ready || !sourcePoint || !targetPoint) return null;
  const measurement = canvas.grid.measurePath([sourcePoint, targetPoint]);
  const distance = Number(measurement?.distance);
  return Number.isFinite(distance) ? distance : null;
}

function getSnappedCanvasPoint(point) {
  if (!canvas?.grid?.getSnappedPoint) return point;
  try {
    return canvas.grid.getSnappedPoint(point, { mode: 0 });
  } catch {
    return point;
  }
}

async function chooseBlastPoint({ radius = 0, sourceToken = null, weaponName = "" } = {}) {
  if (!canvas?.ready) return null;

  return new Promise(resolve => {
    const preview = new PIXI.Graphics();
    canvas.interface.addChild(preview);

    const pxRadius = ((Number(radius) || 0) / (canvas.scene?.grid?.distance || 1)) * (canvas.scene?.grid?.size || canvas.grid?.size || 100);
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      canvas.stage.off("pointermove", moveHandler);
      canvas.stage.off("pointerdown", downHandler);
      window.removeEventListener("keydown", keyHandler);
      preview.destroy({ children: true });
    };

    const drawPreview = point => {
      preview.clear();
      preview.lineStyle(2, 0x33cc66, 0.9);
      preview.beginFill(0x33cc66, 0.15);
      preview.drawCircle(point.x, point.y, pxRadius);
      if (sourceToken?.document) {
        const sourcePoint = sourceToken.document.getCenterPoint();
        preview.moveTo(sourcePoint.x, sourcePoint.y);
        preview.lineTo(point.x, point.y);
      }
      preview.endFill();
    };

    const moveHandler = event => {
      const point = getSnappedCanvasPoint(event.data.getLocalPosition(canvas.stage));
      drawPreview(point);
    };

    const downHandler = event => {
      if (event.data?.button === 2) {
        cleanup();
        return resolve(null);
      }
      const point = getSnappedCanvasPoint(event.data.getLocalPosition(canvas.stage));
      cleanup();
      return resolve(point);
    };

    const keyHandler = event => {
      if (event.key !== "Escape") return;
      cleanup();
      resolve(null);
    };

    window.addEventListener("keydown", keyHandler);
    canvas.stage.on("pointermove", moveHandler);
    canvas.stage.on("pointerdown", downHandler);

    if (sourceToken?.document) drawPreview(sourceToken.document.getCenterPoint());
    ui.notifications.info(game.i18n.format("SW1E.Combat.Grenade.PlaceTemplate", { weapon: weaponName || game.i18n.localize("SW1E.Weapon") }));
  });
}

function getScatterVector(direction, forward) {
  const fx = Number(forward?.x) || 0;
  const fy = Number(forward?.y) || -1;
  const flen = Math.hypot(fx, fy) || 1;
  const normF = { x: fx / flen, y: fy / flen };
  const right = { x: -normF.y, y: normF.x };

  const combine = (...vectors) => {
    const x = vectors.reduce((sum, v) => sum + v.x, 0);
    const y = vectors.reduce((sum, v) => sum + v.y, 0);
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  };

  switch (Number(direction) || 0) {
    case 1: return normF;
    case 2: return combine(normF, right);
    case 3: return right;
    case 4: return { x: -normF.x, y: -normF.y };
    case 5: return { x: -right.x, y: -right.y };
    case 6: return combine(normF, { x: -right.x, y: -right.y });
    default: return normF;
  }
}

async function rollGrenadeScatter() {
  const directionRoll = await (new Roll("1d6")).evaluate();
  const distanceRoll = await (new Roll("3d6")).evaluate();
  return {
    direction: Number(directionRoll.total) || 1,
    distance: Number(distanceRoll.total) || 0,
    directionRoll,
    distanceRoll
  };
}

function offsetPointByMeters(origin, vector, distanceMeters) {
  const distance = Number(distanceMeters) || 0;
  const pxPerMeter = (canvas.scene?.grid?.size || canvas.grid?.size || 100) / (canvas.scene?.grid?.distance || 1);
  return {
    x: origin.x + ((Number(vector?.x) || 0) * distance * pxPerMeter),
    y: origin.y + ((Number(vector?.y) || 0) * distance * pxPerMeter)
  };
}

function getBlastDamageForDistance(profile, distanceMeters) {
  const blast = profile?.blast;
  const distance = Number(distanceMeters);
  if (!blast || !Number.isFinite(distance)) return null;
  if (distance < 3 && isRollableDiceCode(blast.pointBlankDamage.dice, blast.pointBlankDamage.pips)) {
    return { band: "pointBlank", label: game.i18n.localize("SW1E.Combat.Range.pointBlank"), dice: blast.pointBlankDamage.dice, pips: blast.pointBlankDamage.pips };
  }
  if (distance <= blast.shortMax && isRollableDiceCode(blast.shortDamage.dice, blast.shortDamage.pips)) {
    return { band: "short", label: game.i18n.localize("SW1E.Combat.Range.short"), dice: blast.shortDamage.dice, pips: blast.shortDamage.pips };
  }
  if (distance <= blast.mediumMax && isRollableDiceCode(blast.mediumDamage.dice, blast.mediumDamage.pips)) {
    return { band: "medium", label: game.i18n.localize("SW1E.Combat.Range.medium"), dice: blast.mediumDamage.dice, pips: blast.mediumDamage.pips };
  }
  if (distance <= blast.longMax && isRollableDiceCode(blast.longDamage.dice, blast.longDamage.pips)) {
    return { band: "long", label: game.i18n.localize("SW1E.Combat.Range.long"), dice: blast.longDamage.dice, pips: blast.longDamage.pips };
  }
  return null;
}

function getTokensInBlast(centerPoint, radiusMeters) {
  if (!canvas?.ready) return [];
  const radius = Number(radiusMeters) || 0;
  return canvas.tokens.placeables.filter(token => {
    const tokenCenter = token.document?.getCenterPoint?.();
    if (!tokenCenter) return false;
    const distance = measurePointDistance(centerPoint, tokenCenter);
    return Number.isFinite(distance) && distance <= radius;
  });
}

async function setBlastTargets(tokens = []) {
  for (const target of Array.from(game.user?.targets ?? [])) {
    try { target.setTarget(false, { user: game.user, releaseOthers: false }); } catch {}
  }
  for (const token of tokens) {
    try { token.setTarget(true, { user: game.user, releaseOthers: false }); } catch {}
  }
}

function detectSightBarrier(origin, destination) {
  if (!origin || !destination) return false;
  try {
    const tester = foundry?.canvas?.geometry?.PointSourcePolygon;
    if (typeof tester?.testCollision === "function") {
      return !!tester.testCollision(origin, destination, { type: "sight", mode: "any" });
    }
  } catch {}
  return false;
}

function getGrenadeBarrierModifier(mode = "none") {
  switch (String(mode || "none")) {
    case "wall":
      return { blocked: true, label: game.i18n.localize("SW1E.Combat.Grenade.WallApplied") };
    case "door":
      return { blocked: false, dice: -1, pips: 0, label: game.i18n.localize("SW1E.Combat.Grenade.DoorWindowApplied") };
    case "slit":
      return { blocked: false, dice: -2, pips: 0, label: game.i18n.localize("SW1E.Combat.Grenade.SlitApplied") };
    default:
      return { blocked: false, dice: 0, pips: 0, label: "" };
  }
}

function getGrenadeEnvironmentModifier({ enclosed = false, vacuum = false } = {}) {
  const modifier = { dice: 0, pips: 0, labels: [] };
  if (enclosed) {
    modifier.dice += 1;
    modifier.labels.push(game.i18n.localize("SW1E.Combat.Grenade.EnclosedApplied"));
  }
  if (vacuum) {
    modifier.dice -= 1;
    modifier.labels.push(game.i18n.localize("SW1E.Combat.Grenade.VacuumApplied"));
  }
  return modifier;
}

async function promptGrenadeBlastModifiers(weapon, targets = [], impactPoint = null) {
  const rows = targets.map(token => {
    const tokenCenter = token.document?.getCenterPoint?.();
    const autoWall = tokenCenter ? detectSightBarrier(impactPoint, tokenCenter) : false;
    const defaultBarrier = autoWall ? "wall" : "none";
    const autoHint = autoWall ? `<div class="hint">${game.i18n.localize("SW1E.Combat.Grenade.BarrierAutoWall")}</div>` : "";
    return `
      <div class="form-group">
        <label>${escapeHtml(token.name)}</label>
        <div>
          <select name="barrier-${token.id}">
            <option value="none" ${defaultBarrier === "none" ? "selected" : ""}>${escapeHtml(game.i18n.localize("SW1E.Combat.Grenade.BarrierNone"))}</option>
            <option value="wall" ${defaultBarrier === "wall" ? "selected" : ""}>${escapeHtml(game.i18n.localize("SW1E.Combat.Grenade.BarrierWall"))}</option>
            <option value="door">${escapeHtml(game.i18n.localize("SW1E.Combat.Grenade.BarrierDoorWindow"))}</option>
            <option value="slit">${escapeHtml(game.i18n.localize("SW1E.Combat.Grenade.BarrierSlit"))}</option>
          </select>
          ${autoHint}
        </div>
      </div>`;
  }).join("");

  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Combat.Grenade.EnvironmentPromptTitle", { weapon: weapon?.name || game.i18n.localize("SW1E.Weapon") }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.Grenade.Enclosed")}</label>
            <input type="checkbox" name="enclosed">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.Grenade.Vacuum")}</label>
            <input type="checkbox" name="vacuum">
          </div>
          ${rows || `<p>${escapeHtml(game.i18n.localize("SW1E.Combat.Grenade.NoTargetsInBlast"))}</p>`}
        </form>
      `,
      ok: {
        label: game.i18n.localize("SW1E.RollPrompt.Roll"),
        callback: (event, button) => {
          const barriers = {};
          for (const token of targets) {
            barriers[token.id] = button.form.elements[`barrier-${token.id}`]?.value || "none";
          }
          return {
            enclosed: !!button.form.elements.enclosed?.checked,
            vacuum: !!button.form.elements.vacuum?.checked,
            barriers
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

function getDamageResistanceCode(actor) {
  const armor = getEquippedArmorBonus(actor);
  const strength = actor.system.attributes?.strength ?? { dice: 0, pips: 0 };
  const forcePointActive = isForcePointActive(actor);
  const baseStrength = forcePointActive
    ? multiplyDiceCode({ dice: Number(strength.dice) || 0, pips: Number(strength.pips) || 0 }, 2)
    : { dice: Number(strength.dice) || 0, pips: Number(strength.pips) || 0 };
  return {
    armor,
    forcePointActive,
    resistanceCode: adjustDiceCode(baseStrength, { dice: armor.dice, pips: armor.pips })
  };
}

async function resolveDamageAgainstTarget({ targetActor, damageDice = 0, damagePips = 0, damageType = "kill" } = {}) {
  const { armor, resistanceCode } = getDamageResistanceCode(targetActor);
  const damageRoll = await evaluateDiceCode({ dice: damageDice, pips: damagePips, modifier: 0 });
  const resistanceRoll = await evaluateDiceCode({ dice: resistanceCode.dice, pips: resistanceCode.pips, modifier: 0 });
  const currentStatus = targetActor.system.status?.woundStatus ?? "healthy";
  const outcome = resolveDamageOutcome({ damageTotal: damageRoll.total, strengthTotal: resistanceRoll.total, damageType, currentStatus });

  let appliedStatus = currentStatus;
  if (!outcome.ambiguous && outcome.nextStatus !== currentStatus) {
    await targetActor.update({ "system.status.woundStatus": outcome.nextStatus });
    appliedStatus = outcome.nextStatus;
  }

  return { armor, resistanceCode, damageRoll, resistanceRoll, outcome, appliedStatus };
}

async function applyProneStatus(token) {
  const effect = CONFIG.statusEffects?.find(entry => entry.id === "prone" || /prone/i.test(String(entry.name ?? entry.label ?? entry.id ?? "")));
  if (!effect || !token) return false;
  try {
    if (typeof token.document?.toggleStatusEffect === "function") {
      await token.document.toggleStatusEffect(effect, { active: true });
      return true;
    }
  } catch {}
  try {
    if (typeof token.toggleEffect === "function") {
      await token.toggleEffect(effect, { active: true });
      return true;
    }
  } catch {}
  return false;
}

async function createBlastTemplate(centerPoint, radiusMeters, weaponName = "") {
  if (!canvas?.scene || !centerPoint) return null;

  const distance = Math.abs(Number(radiusMeters) || 0);
  const fillColor = "#33cc66";
  const commonFlags = {
    sw1e: { blastWeapon: weaponName }
  };

  const isV14RegionScene = Number(game.release?.generation) >= 14
    && typeof canvas.scene.createEmbeddedDocuments === "function"
    && canvas.scene.getEmbeddedCollection?.("Region");

  if (isV14RegionScene) {
    const grid = canvas.scene.grid ?? {};
    const gridSize = Number(grid.size) || Number(canvas.dimensions?.size) || 100;
    const gridDistance = Number(grid.distance) || Number(canvas.dimensions?.distance) || 1;
    const radius = distance * (gridSize / gridDistance);

    const [created] = await canvas.scene.createEmbeddedDocuments("Region", [{
      name: weaponName ? `${weaponName} Blast` : "Blast Template",
      color: fillColor,
      shapes: [{
        type: "circle",
        x: Math.round(centerPoint.x),
        y: Math.round(centerPoint.y),
        radius,
        gridBased: false
      }],
      elevation: { bottom: 0, top: null },
      restriction: { enabled: false, type: "move", priority: 0 },
      behaviors: [],
      visibility: CONST.REGION_VISIBILITY.ALWAYS,
      highlightMode: "coverage",
      displayMeasurements: true,
      locked: false,
      flags: {
        ...commonFlags,
        core: { MeasuredTemplate: true }
      }
    }]);
    return created ?? null;
  }

  const [created] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [{
    t: "circle",
    user: game.user?.id,
    x: centerPoint.x,
    y: centerPoint.y,
    distance,
    fillColor,
    flags: commonFlags
  }]);
  return created ?? null;
}

async function promptGrenadeAttack(actor, weapon, actionCode, prepared, placement, throwContext) {
  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Combat.Grenade.Title", { weapon: weapon.name }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.Skill")}</label>
            <input type="text" value="${escapeHtml(actionCode.label)} (${escapeHtml(formatDiceCode(prepared.dice, prepared.pips))})" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.MeasuredDistance")}</label>
            <input type="text" value="${escapeHtml(formatDistanceUnits(placement.distance))}${canvas?.scene?.grid?.units ? ` ${escapeHtml(canvas.scene.grid.units)}` : ""}" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.RangeBand")}</label>
            <input type="text" value="${escapeHtml(game.i18n.localize(`SW1E.Combat.Range.${throwContext.rangeBand}`))}" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.Grenade.HitBand")}</label>
            <input type="text" value="${escapeHtml(throwContext.targetNumberLabel)}" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.TargetNumber")}</label>
            <input type="number" name="targetNumber" value="${escapeHtml(String(throwContext.targetNumber || 0))}" step="1">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.Modifier")}</label>
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

async function rollGrenadeAttackWorkflow({ actor, weapon, actionCode, prepared } = {}) {
  const sourceToken = resolveAttackSourceToken(actor);
  if (!sourceToken) {
    ui.notifications.warn(game.i18n.localize("SW1E.Combat.Grenade.NoSourceToken"));
    return null;
  }

  const profile = getGrenadeProfile(weapon);
  if (!profile?.blast?.longMax) {
    ui.notifications.warn(game.i18n.localize("SW1E.Combat.Grenade.InvalidProfile"));
    return null;
  }

  const chosenPoint = await chooseBlastPoint({ radius: profile.blast.longMax, sourceToken, weaponName: weapon.name });
  if (!chosenPoint) return null;

  const sourcePoint = sourceToken.document.getCenterPoint();
  const distance = measurePointDistance(sourcePoint, chosenPoint);
  const throwContext = getGrenadeThrowContext(weapon, distance);
  if (!throwContext || throwContext.outOfRange) {
    ui.notifications.warn(game.i18n.localize("SW1E.Combat.Grenade.OutOfRange"));
    return null;
  }

  const placement = { sourcePoint, chosenPoint, distance, distanceLabel: formatDistanceUnits(distance) };
  const promptData = await promptGrenadeAttack(actor, weapon, actionCode, prepared, placement, throwContext);
  if (!promptData) return null;

  const attackRoll = await postDiceCodeMessage({
    actor,
    label: `${weapon.name} — ${game.i18n.localize("SW1E.Combat.Attack")}`,
    dice: prepared.dice,
    pips: prepared.pips,
    modifier: promptData.modifier,
    diceModifier: promptData.diceModifier,
    modifierLabel: promptData.modifierLabel,
    flavor: `${weapon.name} Attack`,
    extraLines: [
      `<p><strong>${game.i18n.localize("SW1E.Combat.AttackSkill")}:</strong> ${escapeHtml(actionCode.label)}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Combat.AttackPrompt.MeasuredDistance")}:</strong> ${escapeHtml(placement.distanceLabel)}${canvas?.scene?.grid?.units ? ` ${escapeHtml(canvas.scene.grid.units)}` : ""}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Combat.AttackPrompt.RangeBand")}:</strong> ${game.i18n.localize(`SW1E.Combat.Range.${throwContext.rangeBand}`)}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Combat.Grenade.HitBand")}:</strong> ${escapeHtml(throwContext.targetNumberLabel)}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Combat.TargetNumber")}:</strong> ${Number(promptData.targetNumber) || 0}</p>`,
      prepared.modifiers.length ? `<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${prepared.modifiers.map(escapeHtml).join("; ")}</p>` : ""
    ]
  });
  if (!attackRoll) return null;

  let impactPoint = chosenPoint;
  let scatter = null;
  const targetNumber = Number(promptData.targetNumber) || 0;
  const margin = Number(attackRoll.total) - targetNumber;
  if (margin < 0) {
    scatter = await rollGrenadeScatter();
    const throwVector = { x: chosenPoint.x - sourcePoint.x, y: chosenPoint.y - sourcePoint.y };
    const scatterVector = getScatterVector(scatter.direction, throwVector);
    impactPoint = getSnappedCanvasPoint(offsetPointByMeters(chosenPoint, scatterVector, scatter.distance));
  }

  const blastTokens = getTokensInBlast(impactPoint, profile.blast.longMax);
  const blastModifiers = await promptGrenadeBlastModifiers(weapon, blastTokens, impactPoint);
  if (blastModifiers === null) return null;
  await createBlastTemplate(impactPoint, profile.blast.longMax, weapon.name);
  await setBlastTargets(blastTokens);

  const resultLines = [
    `<p><strong>${game.i18n.localize("SW1E.Combat.Result")}:</strong> ${escapeHtml(margin >= 0 ? game.i18n.format("SW1E.Combat.SuccessBy", { margin }) : game.i18n.format("SW1E.Combat.FailedBy", { margin: Math.abs(margin) }))}</p>`,
    `<p><strong>${game.i18n.localize("SW1E.Combat.Grenade.IntendedPoint")}:</strong> ${Math.round(chosenPoint.x)}, ${Math.round(chosenPoint.y)}</p>`
  ];

  if (scatter) {
    resultLines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.Grenade.ScatterDirection")}:</strong> ${scatter.direction}</p>`);
    resultLines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.Grenade.ScatterDistance")}:</strong> ${scatter.distance} ${escapeHtml(canvas?.scene?.grid?.units || "m")}</p>`);
  }
  resultLines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.Grenade.FinalPoint")}:</strong> ${Math.round(impactPoint.x)}, ${Math.round(impactPoint.y)}</p>`);
  resultLines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.Grenade.TargetsInBlast")}:</strong> ${blastTokens.length}</p>`);
  const environmentSummary = getGrenadeEnvironmentModifier(blastModifiers);
  resultLines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.Grenade.AutoEnvironment")}:</strong> ${escapeHtml(environmentSummary.labels.length ? environmentSummary.labels.join("; ") : game.i18n.localize("SW1E.Combat.Grenade.ModifierSummaryNone"))}</p>`);

  const perTargetLines = [];
  for (const token of blastTokens) {
    const targetActor = token.actor;
    if (!targetActor) continue;

    const tokenCenter = token.document.getCenterPoint();
    const blastDistance = measurePointDistance(impactPoint, tokenCenter);
    const damageBand = getBlastDamageForDistance(profile, blastDistance);
    if (!damageBand) continue;

    const barrierMode = blastModifiers?.barriers?.[token.id] || "none";
    const barrierModifier = getGrenadeBarrierModifier(barrierMode);
    if (barrierModifier.blocked) {
      perTargetLines.push(`<p><strong>${escapeHtml(token.name)}</strong>: ${game.i18n.localize("SW1E.Combat.Grenade.BlockedByWall")}</p>`);
      continue;
    }

    const dodge = getSW1EStoredDefense(targetActor, { attackType: "grenade" });
    const dodged = Number(dodge?.total) >= Number(attackRoll.total);
    if (dodged) {
      const proneApplied = await applyProneStatus(token);
      perTargetLines.push(`<p><strong>${escapeHtml(token.name)}</strong>: ${game.i18n.localize("SW1E.Combat.Grenade.DodgedBlast")} (${escapeHtml(dodge.label)} ${dodge.total})${proneApplied ? `; ${game.i18n.localize("SW1E.Combat.Grenade.ProneApplied")}` : ""}</p>`);
      continue;
    }

    const modifiedDamage = adjustDiceCode(
      { dice: damageBand.dice, pips: damageBand.pips },
      {
        dice: environmentSummary.dice + (Number(barrierModifier.dice) || 0),
        pips: environmentSummary.pips + (Number(barrierModifier.pips) || 0)
      }
    );

    const modifierLabels = [
      ...environmentSummary.labels,
      barrierModifier.label
    ].filter(Boolean);

    if (!isRollableDiceCode(modifiedDamage.dice, modifiedDamage.pips)) {
      perTargetLines.push(`<p><strong>${escapeHtml(token.name)}</strong>: ${game.i18n.localize("SW1E.Combat.Grenade.NoEffectiveDamage")} (${escapeHtml(modifierLabels.length ? modifierLabels.join("; ") : game.i18n.localize("SW1E.Combat.Grenade.ModifierSummaryNone"))})</p>`);
      continue;
    }

    const resolved = await resolveDamageAgainstTarget({ targetActor, damageDice: modifiedDamage.dice, damagePips: modifiedDamage.pips, damageType: "kill" });
    perTargetLines.push(
      `<p><strong>${escapeHtml(token.name)}</strong>: ${escapeHtml(damageBand.label)} ${escapeHtml(formatDiceCode(damageBand.dice, damageBand.pips))}` +
      `${modifierLabels.length ? `; ${game.i18n.localize("SW1E.Combat.Grenade.AppliedModifiers")}: ${escapeHtml(modifierLabels.join("; "))}` : ""}, ` +
      `${game.i18n.localize("SW1E.Combat.Grenade.ModifiedDamage")} ${escapeHtml(formatDiceCode(modifiedDamage.dice, modifiedDamage.pips))}, ` +
      `${game.i18n.localize("SW1E.Combat.Damage")} ${resolved.damageRoll.total} (${escapeHtml(formatDieResults(resolved.damageRoll))}), ` +
      `${game.i18n.localize("SW1E.Combat.ResistDamage")} ${resolved.resistanceRoll.total} (${escapeHtml(formatDieResults(resolved.resistanceRoll))}), ` +
      `${escapeHtml(resolved.outcome.description)}, ${game.i18n.localize("SW1E.Combat.WoundStatusAfter")} ${game.i18n.localize(`SW1E.Wound.${resolved.appliedStatus}`)}</p>`
    );
  }

  if (!perTargetLines.length) {
    perTargetLines.push(`<p><strong>${game.i18n.localize("SW1E.Notes")}:</strong> ${game.i18n.localize("SW1E.Combat.Grenade.NoTargetsInBlast")}</p>`);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="sw1e-chat-card"><h3>${escapeHtml(`${weapon.name} — ${game.i18n.localize("SW1E.Combat.AttackResult")}`)}</h3>${resultLines.join("")}${perTargetLines.join("")}</div>`
  });

  return { attackRoll, margin, scatter, impactPoint, targets: blastTokens.length };
}


function inferWeaponAttackType(weapon, rangeData = null) {
  if (rangeData?.type === "melee") return "melee";
  if (rangeData?.type === "thrown") return "grenade";
  if (isBlasterWeapon(weapon)) return "blaster";

  const skillLookup = normalizeLookup(weapon?.system?.skillUsed);
  if (skillLookup.includes("melee")) return "melee";
  if (skillLookup.includes("brawling")) return "brawling";
  if (skillLookup.includes("grenade")) return "grenade";
  return "ranged";
}

function buildAttackResolutionContext(actor, weapon, promptData, autoRange = null) {
  const rangeData = autoRange?.rangeData ?? parseWeaponRangeBands(weapon.system.range);
  const targetToken = autoRange?.targetToken ?? resolveSingleTargetToken();
  const targetActor = targetToken?.actor ?? null;
  const attackType = inferWeaponAttackType(weapon, rangeData);
  const defense = targetActor ? getSW1EStoredDefense(targetActor, { attackType }) : null;

  const baseTargetNumber = promptData.rangeBand === "custom"
    ? Number(promptData.targetNumber) || 0
    : (Number(promptData.targetNumber) || (DEFAULT_ATTACK_DIFFICULTIES[promptData.rangeBand] ?? 0));
  const defenseBonus = Number(defense?.total) || 0;

  return {
    targetToken,
    targetActor,
    attackType,
    defense,
    defenseBonus,
    baseTargetNumber,
    finalTargetNumber: baseTargetNumber + defenseBonus,
    rangeData
  };
}

async function postAttackAutomationSummary({ actor, weapon, attackRoll, resolution, promptData }) {
  const targetActor = resolution?.targetActor ?? null;
  const targetToken = resolution?.targetToken ?? null;
  const finalTargetNumber = Number(resolution?.finalTargetNumber) || 0;
  const margin = Number(attackRoll?.total) - finalTargetNumber;
  const lines = [];

  if (targetToken) {
    lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.AttackPrompt.AutoTarget")}:</strong> ${escapeHtml(targetToken.name)}</p>`);
  }

  lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.BaseTargetNumber")}:</strong> ${resolution?.baseTargetNumber ?? 0}</p>`);
  if (resolution?.defense) {
    lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.DefenseApplied")}:</strong> ${escapeHtml(resolution.defense.label)} ${resolution.defense.total}</p>`);
  }
  lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.TargetNumber")}:</strong> ${finalTargetNumber}</p>`);
  lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.Result")}:</strong> ${escapeHtml(margin >= 0
    ? game.i18n.format("SW1E.Combat.SuccessBy", { margin })
    : game.i18n.format("SW1E.Combat.FailedBy", { margin: Math.abs(margin) }))}</p>`);

  if (margin < 0) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="sw1e-chat-card"><h3>${escapeHtml(`${weapon.name} — ${game.i18n.localize("SW1E.Combat.AttackResult")}`)}</h3>${lines.join("")}</div>`
    });
    return { hit: false, margin };
  }

  if (!targetActor) {
    lines.push(`<p><strong>${game.i18n.localize("SW1E.Notes")}:</strong> ${game.i18n.localize("SW1E.Combat.NoTargetAutomation")}</p>`);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="sw1e-chat-card"><h3>${escapeHtml(`${weapon.name} — ${game.i18n.localize("SW1E.Combat.AttackResult")}`)}</h3>${lines.join("")}</div>`
    });
    return { hit: true, margin, automated: false };
  }

  const damageCode = getWeaponDamageCode(actor, weapon);
  const damageDice = damageCode.dice;
  const damagePips = damageCode.pips;
  if (!isRollableDiceCode(damageDice, damagePips)) {
    lines.push(`<p><strong>${game.i18n.localize("SW1E.Notes")}:</strong> ${game.i18n.localize("SW1E.Combat.InvalidWeaponDamage")}</p>`);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="sw1e-chat-card"><h3>${escapeHtml(`${weapon.name} — ${game.i18n.localize("SW1E.Combat.AttackResult")}`)}</h3>${lines.join("")}</div>`
    });
    return { hit: true, margin, automated: false };
  }

  const { armor, resistanceCode, forcePointActive } = getDamageResistanceCode(targetActor);

  const damageRoll = await evaluateDiceCode({ dice: damageDice, pips: damagePips, modifier: 0 });
  const resistanceRoll = await evaluateDiceCode({ dice: resistanceCode.dice, pips: resistanceCode.pips, modifier: 0 });
  const currentStatus = targetActor.system.status?.woundStatus ?? "healthy";
  const outcome = resolveDamageOutcome({
    damageTotal: damageRoll.total,
    strengthTotal: resistanceRoll.total,
    damageType: promptData.fireMode,
    currentStatus
  });

  let appliedStatus = currentStatus;
  if (!outcome.ambiguous && outcome.nextStatus !== currentStatus) {
    await targetActor.update({ "system.status.woundStatus": outcome.nextStatus });
    appliedStatus = outcome.nextStatus;
  }

  lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.Damage")}</strong>: ${damageRoll.total} (${escapeHtml(formatDiceCode(damageDice, damagePips))}; ${escapeHtml(formatDieResults(damageRoll))})</p>`);
  if (damageCode.modifiers.length) {
    lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${damageCode.modifiers.map(escapeHtml).join("; ")}</p>`);
  }
  lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.ResistDamage")}</strong>: ${resistanceRoll.total} (${escapeHtml(formatDiceCode(resistanceCode.dice, resistanceCode.pips))}; ${escapeHtml(formatDieResults(resistanceRoll))})</p>`);
  if (armor.dice || armor.pips) {
    lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.ArmorBonusLabel")}:</strong> ${escapeHtml(formatDiceCode(armor.dice, armor.pips))}</p>`);
  }
  if (forcePointActive) {
    lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${escapeHtml(game.i18n.localize("SW1E.ForcePoint.ResistanceModifier"))}</p>`);
  }
  lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.Result")}:</strong> ${escapeHtml(outcome.description)}</p>`);
  lines.push(`<p><strong>${game.i18n.localize("SW1E.Combat.WoundStatusAfter")}:</strong> ${game.i18n.localize(`SW1E.Wound.${appliedStatus}`)}</p>`);

  if (outcome.ambiguous) {
    lines.push(`<p><strong>${game.i18n.localize("SW1E.Notes")}:</strong> ${game.i18n.localize("SW1E.Combat.AmbiguousNote")}</p>`);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="sw1e-chat-card"><h3>${escapeHtml(`${weapon.name} — ${game.i18n.localize("SW1E.Combat.AttackResult")}`)}</h3>${lines.join("")}</div>`
  });

  return {
    hit: true,
    margin,
    automated: true,
    damageTotal: damageRoll.total,
    resistanceTotal: resistanceRoll.total,
    outcome,
    appliedStatus
  };
}

function moreSevereStatus(a = "healthy", b = "healthy") {
  return getSeverity(a) >= getSeverity(b) ? a : b;
}

export function getWeaponAttackSkillLabel(actor, weapon) {
  return resolveWeaponAttackSkillLabel(actor, weapon);
}

export function getEquippedArmorBonus(actor) {
  const armorItems = actor.items.filter(item => item.type === "equipment" && item.system.category === "armor" && item.system.equipped);

  let totalDice = 0;
  let totalPips = 0;
  for (const armor of armorItems) {
    totalDice += Number(armor.system.armorDice) || 0;
    totalPips += Number(armor.system.armorPips) || 0;
  }

  const normalized = adjustDiceCode({ dice: 0, pips: 0 }, { dice: totalDice, pips: totalPips });
  return {
    dice: normalized.dice,
    pips: normalized.pips,
    items: armorItems
  };
}

function getActionState(actor) {
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
      return { blocked: false, woundPenaltyDice: -1, reason: game.i18n.localize("SW1E.Combat.WoundPenalty") };
    default:
      return { blocked: false, woundPenaltyDice: 0, reason: "" };
  }
}

function findActionCode(actor, skillUsed = "") {
  const lookup = normalizeLookup(skillUsed);
  if (!lookup) return null;

  for (const [key, attr] of Object.entries(actor.system.attributes ?? {})) {
    const attrNames = [key, localizeAttrKey(key), attr.label ?? key];
    if (attrNames.some(name => normalizeLookup(name) === lookup)) {
      return {
        type: "attribute",
        key,
        label: localizeAttrKey(key),
        dice: Number(attr.dice) || 0,
        pips: Number(attr.pips) || 0,
        usesDexterity: key === "dexterity"
      };
    }
  }

  const forceAction = findForceActionCode(actor, skillUsed);
  if (forceAction) return forceAction;

  const skillItem = findExactSkillItem(actor, skillUsed);
  if (skillItem) return buildSkillActionCode(skillItem);

  const fallback = inferAttributeForSkillLabel(skillUsed);
  if (!fallback) return null;
  if (String(fallback).startsWith("force:")) {
    return findForceActionCode(actor, String(fallback).split(":")[1]);
  }

  return buildAttributeFallbackActionCode(actor, fallback, skillUsed);
}

function prepareActionDice(actor, actionCode, { reactionIncrement = 0 } = {}) {
  const actionState = getActionState(actor);
  if (actionState.blocked) {
    return {
      blocked: true,
      reason: actionState.reason,
      dice: actionCode.dice,
      pips: actionCode.pips,
      modifiers: [],
      combatPenalty: null
    };
  }

  let prepared = { dice: actionCode.dice, pips: actionCode.pips };
  const modifiers = [];

  if (isForcePointActive(actor)) {
    prepared = multiplyDiceCode(prepared, 2);
    modifiers.push(game.i18n.localize("SW1E.ForcePoint.AutoModifier"));
  }

  if (actionState.ignoresStun) {
    modifiers.push(game.i18n.localize("SW1E.ForcePoint.StunIgnored"));
  }

  if (actionState.woundPenaltyDice) {
    prepared = adjustDiceCode(prepared, { dice: actionState.woundPenaltyDice, pips: 0 });
    modifiers.push(game.i18n.localize("SW1E.Combat.WoundPenalty"));
  }

  if (actionCode.usesDexterity) {
    const armor = getEquippedArmorBonus(actor);
    if (armor.dice || armor.pips) {
      prepared = adjustDiceCode(prepared, { dice: -armor.dice, pips: -armor.pips });
      modifiers.push(game.i18n.format("SW1E.Combat.ArmorPenalty", { armor: formatDiceCode(armor.dice, armor.pips) }));
    }
  }

  const combatPenalty = getSW1EActionPenalty(actor, { reactionIncrement });
  if (combatPenalty.active && combatPenalty.penaltyDice > 0) {
    prepared = adjustDiceCode(prepared, { dice: -combatPenalty.penaltyDice, pips: 0 });
    modifiers.push(combatPenalty.label);
  } else if (combatPenalty.active && combatPenalty.label) {
    modifiers.push(combatPenalty.label);
  }

  if (!isRollableDiceCode(prepared.dice, prepared.pips)) {
    return {
      blocked: true,
      reason: game.i18n.localize("SW1E.Combat.BelowOneD"),
      dice: prepared.dice,
      pips: prepared.pips,
      modifiers,
      combatPenalty
    };
  }

  return {
    blocked: false,
    reason: "",
    dice: prepared.dice,
    pips: prepared.pips,
    modifiers,
    combatPenalty
  };
}

async function promptGenericActionRoll(actionCode, prepared) {
  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.RollPrompt.Title", { label: actionCode.label }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.Skill")}</label>
            <input type="text" value="${escapeHtml(actionCode.label)} (${escapeHtml(formatDiceCode(prepared.dice, prepared.pips))})" disabled>
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

export async function rollAction({ actor, actionLabel = "", actionCode = null } = {}) {
  if (!actor) return null;

  const resolvedAction = actionCode ?? findActionCode(actor, actionLabel);
  if (!resolvedAction) {
    ui.notifications.warn(game.i18n.format("SW1E.Combat.NoActionCode", { label: actionLabel || game.i18n.localize("SW1E.Roll") }));
    return null;
  }

  const reactionIncrement = isReactionActionLabel(resolvedAction.label) ? 1 : 0;
  const prepared = prepareActionDice(actor, resolvedAction, { reactionIncrement });
  if (prepared.blocked) {
    ui.notifications.warn(prepared.reason);
    return null;
  }

  const promptData = await promptGenericActionRoll(resolvedAction, prepared);
  if (!promptData) return null;

  const roll = await postDiceCodeMessage({
    actor,
    label: resolvedAction.label,
    dice: prepared.dice,
    pips: prepared.pips,
    modifier: promptData.modifier,
    diceModifier: promptData.diceModifier,
    modifierLabel: promptData.modifierLabel,
    flavor: resolvedAction.label,
    extraLines: [
      prepared.modifiers.length ? `<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${prepared.modifiers.map(escapeHtml).join("; ")}</p>` : ""
    ]
  });

  if (roll && reactionIncrement > 0) {
    await registerSW1EReactionUse(actor, reactionIncrement);
    await registerSW1EReactionRoll(actor, resolvedAction.label, roll.total);
  }

  return roll;
}

async function promptWeaponAttack(actor, weapon, actionCode, prepared, autoRange = null) {
  const defaultRangeBand = autoRange?.derived?.rangeBand ?? "short";
  const defaultTargetNumber = autoRange?.derived?.defaultTarget ?? (DEFAULT_ATTACK_DIFFICULTIES[defaultRangeBand] ?? 0);
  const targetDefaultsJson = escapeHtml(JSON.stringify({
    pointBlank: DEFAULT_ATTACK_DIFFICULTIES.pointBlank,
    short: DEFAULT_ATTACK_DIFFICULTIES.short,
    medium: DEFAULT_ATTACK_DIFFICULTIES.medium,
    long: DEFAULT_ATTACK_DIFFICULTIES.long,
    custom: 0
  }));

  try {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Combat.AttackPrompt.Title", { weapon: weapon.name }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.Skill")}</label>
            <input type="text" value="${escapeHtml(actionCode.label)} (${escapeHtml(formatDiceCode(prepared.dice, prepared.pips))})" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.RangeBand")}</label>
            <select name="rangeBand" onchange='const defaults = JSON.parse(this.dataset.defaults || "{}"); const targetField = this.form?.elements?.targetNumber; if (targetField && !targetField.dataset.manual) targetField.value = defaults[this.value] ?? 0;' data-defaults="${targetDefaultsJson}">
              <option value="pointBlank" ${defaultRangeBand === "pointBlank" ? "selected" : ""}>${game.i18n.localize("SW1E.Combat.Range.pointBlank")}</option>
              <option value="short" ${defaultRangeBand === "short" ? "selected" : ""}>${game.i18n.localize("SW1E.Combat.Range.short")}</option>
              <option value="medium" ${defaultRangeBand === "medium" ? "selected" : ""}>${game.i18n.localize("SW1E.Combat.Range.medium")}</option>
              <option value="long" ${defaultRangeBand === "long" ? "selected" : ""}>${game.i18n.localize("SW1E.Combat.Range.long")}</option>
              <option value="custom" ${defaultRangeBand === "custom" ? "selected" : ""}>${game.i18n.localize("SW1E.Combat.Range.custom")}</option>
            </select>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.TargetNumber")}</label>
            <input type="number" name="targetNumber" value="${escapeHtml(String(defaultTargetNumber))}" step="1" oninput='this.dataset.manual = "true";'>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.Modifier")}</label>
            <input type="number" name="modifier" value="0" step="1">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.DiceModifier")}</label>
            <input type="text" name="diceModifier" value="" placeholder="+1D, -2D, +2">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.FireMode")}</label>
            <select name="fireMode">
              <option value="kill" selected>${game.i18n.localize("SW1E.Combat.DamageType.kill")}</option>
              <option value="stun">${game.i18n.localize("SW1E.Combat.DamageType.stun")}</option>
            </select>
          </div>
        </form>
      `,
      ok: {
        label: game.i18n.localize("SW1E.RollPrompt.Roll"),
        callback: (event, button) => ({
          rangeBand: button.form.elements.rangeBand.value,
          targetNumber: Number(button.form.elements.targetNumber.value || 0),
          modifier: Number(button.form.elements.modifier.value || 0),
          diceModifier: button.form.elements.diceModifier.value?.trim() || "",
          modifierLabel: "",
          fireMode: button.form.elements.fireMode.value || "kill"
        })
      },
      rejectClose: false,
      modal: true
    });

    return result ?? null;
  } catch {
    return null;
  }
}

async function promptWeaponDamage(weapon, damageCode = null) {
  try {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Combat.DamagePrompt.Title", { weapon: weapon.name }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.Damage")}</label>
            <input type="text" value="${escapeHtml(formatDiceCode(Number(damageCode?.dice) || Number(weapon.system.damageDice) || 0, Number(damageCode?.pips) || Number(weapon.system.damagePips) || 0))}" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.FireMode")}</label>
            <select name="fireMode">
              <option value="kill" selected>${game.i18n.localize("SW1E.Combat.DamageType.kill")}</option>
              <option value="stun">${game.i18n.localize("SW1E.Combat.DamageType.stun")}</option>
            </select>
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
          fireMode: button.form.elements.fireMode.value || "kill",
          modifier: Number(button.form.elements.modifier.value || 0),
          diceModifier: button.form.elements.diceModifier.value?.trim() || "",
          modifierLabel: ""
        })
      },
      rejectClose: false,
      modal: true
    });

    return result ?? null;
  } catch {
    return null;
  }
}

async function promptDamageResistance(actor) {
  const armor = getEquippedArmorBonus(actor);
  const armorText = armor.dice || armor.pips
    ? `${game.i18n.localize("SW1E.Combat.AttackPrompt.ArmorBonus")}: ${formatDiceCode(armor.dice, armor.pips)}`
    : game.i18n.localize("SW1E.None");

  try {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.Combat.ResistPrompt.Title", { actor: actor.name }) },
      content: `
        <form class="sw1e-roll-prompt">
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.ResistPrompt.IncomingDamage")}</label>
            <input type="number" name="incomingDamage" value="0" step="1" autofocus>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.ResistPrompt.SourceLabel")}</label>
            <input type="text" name="sourceLabel" value="">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.ResistPrompt.DamageType")}</label>
            <select name="damageType">
              <option value="kill" selected>${game.i18n.localize("SW1E.Combat.DamageType.kill")}</option>
              <option value="stun">${game.i18n.localize("SW1E.Combat.DamageType.stun")}</option>
            </select>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.Combat.AttackPrompt.ArmorBonus")}</label>
            <input type="text" value="${escapeHtml(armorText)}" disabled>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.Modifier")}</label>
            <input type="number" name="modifier" value="0" step="1">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SW1E.RollPrompt.DiceModifier")}</label>
            <input type="text" name="diceModifier" value="" placeholder="+1D, -2D, +2">
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="applyStatus" checked>
              ${game.i18n.localize("SW1E.Combat.ResistPrompt.ApplyStatus")}
            </label>
          </div>
        </form>
      `,
      ok: {
        label: game.i18n.localize("SW1E.RollPrompt.Roll"),
        callback: (event, button) => ({
          incomingDamage: Number(button.form.elements.incomingDamage.value || 0),
          sourceLabel: button.form.elements.sourceLabel.value?.trim() || "",
          damageType: button.form.elements.damageType.value || "kill",
          modifier: Number(button.form.elements.modifier.value || 0),
          diceModifier: button.form.elements.diceModifier.value?.trim() || "",
          modifierLabel: "",
          applyStatus: button.form.elements.applyStatus.checked
        })
      },
      rejectClose: false,
      modal: true
    });

    return result ?? null;
  } catch {
    return null;
  }
}

function describeDamageOutcome(damageType, result) {
  if (damageType === "stun") {
    if (result.type === "none") return game.i18n.localize("SW1E.Combat.Outcome.noEffect");
    if (result.type === "ambiguous") return game.i18n.localize("SW1E.Combat.Outcome.manual");
    if (result.type === "incapacitated") return game.i18n.localize("SW1E.Combat.Outcome.knockedUnconscious");
    return game.i18n.localize("SW1E.Combat.Outcome.stunnedTwoRounds");
  }

  return game.i18n.localize(`SW1E.Wound.${result.type}`);
}

function applyKillOutcome(currentStatus, effectType) {
  if (currentStatus === "dead") return "dead";
  if (effectType === "stunned") return moreSevereStatus(currentStatus, "stunned");
  if (effectType === "wounded") {
    if (currentStatus === "wounded") return "incapacitated";
    if (currentStatus === "incapacitated") return "mortallyWounded";
    return moreSevereStatus(currentStatus, "wounded");
  }
  if (effectType === "incapacitated") {
    if (currentStatus === "incapacitated") return "mortallyWounded";
    return moreSevereStatus(currentStatus, "incapacitated");
  }
  if (effectType === "mortallyWounded") return moreSevereStatus(currentStatus, "mortallyWounded");
  return currentStatus;
}

function applyStunOutcome(currentStatus, effectType) {
  if (currentStatus === "dead") return "dead";
  if (currentStatus === "mortallyWounded") return "mortallyWounded";
  if (effectType === "none") return currentStatus;
  if (effectType === "stunned") {
    if (currentStatus === "stunned") return "incapacitated";
    return moreSevereStatus(currentStatus, "stunned");
  }
  if (effectType === "incapacitated") return moreSevereStatus(currentStatus, "incapacitated");
  return currentStatus;
}

export function resolveDamageOutcome({ damageTotal = 0, strengthTotal = 0, damageType = "kill", currentStatus = "healthy" } = {}) {
  const damage = Number(damageTotal) || 0;
  const strength = Number(strengthTotal) || 0;

  if (damageType === "stun") {
    if (damage < strength) {
      return {
        type: "none",
        description: describeDamageOutcome("stun", { type: "none" }),
        nextStatus: currentStatus,
        ambiguous: false
      };
    }

    if (damage === strength) {
      return {
        type: "ambiguous",
        description: describeDamageOutcome("stun", { type: "ambiguous" }),
        nextStatus: currentStatus,
        ambiguous: true
      };
    }

    const type = damage >= (2 * strength) ? "incapacitated" : "stunned";
    return {
      type,
      description: describeDamageOutcome("stun", { type }),
      nextStatus: applyStunOutcome(currentStatus, type),
      ambiguous: false
    };
  }

  let type = "stunned";
  if (damage >= (3 * strength)) type = "mortallyWounded";
  else if (damage >= (2 * strength)) type = "incapacitated";
  else if (damage >= strength) type = "wounded";

  return {
    type,
    description: describeDamageOutcome("kill", { type }),
    nextStatus: applyKillOutcome(currentStatus, type),
    ambiguous: false
  };
}

export async function rollWeaponAttack({ actor, weapon } = {}) {
  if (!actor || !weapon) return null;

  const actionCode = findWeaponActionCode(actor, weapon);
  if (!actionCode) {
    ui.notifications.warn(game.i18n.format("SW1E.Combat.NoAttackCode", { weapon: weapon.name }));
    return null;
  }

  const prepared = prepareActionDice(actor, actionCode);
  if (prepared.blocked) {
    ui.notifications.warn(prepared.reason);
    return null;
  }

  if (getGrenadeProfile(weapon)) {
    return rollGrenadeAttackWorkflow({ actor, weapon, actionCode, prepared });
  }

  const autoRange = getAutoRangeContext(actor, weapon);
  const promptData = await promptWeaponAttack(actor, weapon, actionCode, prepared, autoRange);
  if (!promptData) return null;

  const sceneUnits = canvas?.scene?.grid?.units ? ` ${escapeHtml(canvas.scene.grid.units)}` : "";
  const resolution = buildAttackResolutionContext(actor, weapon, promptData, autoRange);

  const roll = await postDiceCodeMessage({
    actor,
    label: `${weapon.name} — ${game.i18n.localize("SW1E.Combat.Attack")}`,
    dice: prepared.dice,
    pips: prepared.pips,
    modifier: promptData.modifier,
    diceModifier: promptData.diceModifier,
    modifierLabel: promptData.modifierLabel,
    flavor: `${weapon.name} Attack`,
    extraLines: [
      `<p><strong>${game.i18n.localize("SW1E.Combat.AttackSkill")}:</strong> ${escapeHtml(actionCode.label)}</p>`,
      resolution.targetToken ? `<p><strong>${game.i18n.localize("SW1E.Combat.AttackPrompt.AutoTarget")}:</strong> ${escapeHtml(resolution.targetToken.name)}</p>` : "",
      autoRange ? `<p><strong>${game.i18n.localize("SW1E.Combat.AttackPrompt.MeasuredDistance")}:</strong> ${escapeHtml(autoRange.distanceLabel)}${sceneUnits}</p>` : "",
      `<p><strong>${game.i18n.localize("SW1E.Range")}:</strong> ${game.i18n.localize(`SW1E.Combat.Range.${promptData.rangeBand}`)}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Combat.BaseTargetNumber")}:</strong> ${resolution.baseTargetNumber}</p>`,
      resolution.defense ? `<p><strong>${game.i18n.localize("SW1E.Combat.DefenseApplied")}:</strong> ${escapeHtml(resolution.defense.label)} ${resolution.defense.total}</p>` : "",
      `<p><strong>${game.i18n.localize("SW1E.Combat.TargetNumber")}:</strong> ${resolution.finalTargetNumber}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Combat.DamageTypeLabel")}:</strong> ${game.i18n.localize(`SW1E.Combat.DamageType.${promptData.fireMode}`)}</p>`,
      prepared.modifiers.length ? `<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${prepared.modifiers.map(escapeHtml).join("; ")}</p>` : ""
    ]
  });

  if (!roll) return null;

  await postAttackAutomationSummary({
    actor,
    weapon,
    attackRoll: roll,
    resolution,
    promptData
  });

  return roll;
}


export async function rollDamageResistance({ actor } = {}) {
  if (!actor) return null;

  const promptData = await promptDamageResistance(actor);
  if (!promptData) return null;

  const resistanceData = getDamageResistanceCode(actor);
  const armor = resistanceData.armor;
  const totalResistanceCode = resistanceData.resistanceCode;
  const forcePointActive = resistanceData.forcePointActive;

  if (!isRollableDiceCode(totalResistanceCode.dice, totalResistanceCode.pips)) {
    ui.notifications.warn(game.i18n.localize("SW1E.Combat.BelowOneD"));
    return null;
  }

  const roll = await postDiceCodeMessage({
    actor,
    label: `${actor.name} — ${game.i18n.localize("SW1E.Combat.ResistDamage")}`,
    dice: totalResistanceCode.dice,
    pips: totalResistanceCode.pips,
    modifier: promptData.modifier,
    diceModifier: promptData.diceModifier,
    modifierLabel: promptData.modifierLabel,
    flavor: `${actor.name} Damage Resistance`,
    extraLines: [
      `<p><strong>${game.i18n.localize("SW1E.Combat.IncomingDamage")}</strong>: ${promptData.incomingDamage}</p>`,
      `<p><strong>${game.i18n.localize("SW1E.Combat.DamageTypeLabel")}:</strong> ${game.i18n.localize(`SW1E.Combat.DamageType.${promptData.damageType}`)}</p>`,
      armor.dice || armor.pips ? `<p><strong>${game.i18n.localize("SW1E.Combat.ArmorBonusLabel")}:</strong> ${formatDiceCode(armor.dice, armor.pips)}</p>` : "",
      forcePointActive ? `<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${escapeHtml(game.i18n.localize("SW1E.ForcePoint.ResistanceModifier"))}</p>` : "",
      promptData.sourceLabel ? `<p><strong>${game.i18n.localize("SW1E.Combat.Source")}</strong>: ${escapeHtml(promptData.sourceLabel)}</p>` : ""
    ]
  });

  if (!roll) return null;

  const outcome = resolveDamageOutcome({
    damageTotal: promptData.incomingDamage,
    strengthTotal: roll.total,
    damageType: promptData.damageType,
    currentStatus: actor.system.status?.woundStatus ?? "healthy"
  });

  if (promptData.applyStatus && !outcome.ambiguous && outcome.nextStatus !== actor.system.status?.woundStatus) {
    await actor.update({ "system.status.woundStatus": outcome.nextStatus });
  }

  const currentStatus = actor.system.status?.woundStatus ?? "healthy";
  const appliedStatus = (!outcome.ambiguous && promptData.applyStatus) ? outcome.nextStatus : currentStatus;
  const lines = [
    `<p><strong>${game.i18n.localize("SW1E.Combat.Result")}:</strong> ${escapeHtml(outcome.description)}</p>`,
    `<p><strong>${game.i18n.localize("SW1E.Combat.WoundStatusAfter")}:</strong> ${game.i18n.localize(`SW1E.Wound.${appliedStatus}`)}</p>`
  ];

  if (outcome.ambiguous) {
    lines.push(`<p><strong>${game.i18n.localize("SW1E.Notes")}:</strong> ${game.i18n.localize("SW1E.Combat.AmbiguousNote")}</p>`);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="sw1e-chat-card"><h3>${escapeHtml(`${actor.name} — ${game.i18n.localize("SW1E.Combat.ResistanceResult")}`)}</h3>${lines.join("")}</div>`
  });

  return roll;
}

export async function rollWeaponDamage({ actor, weapon } = {}) {
  if (!actor || !weapon) return null;

  const damageCode = getWeaponDamageCode(actor, weapon);
  if (!isRollableDiceCode(damageCode.dice, damageCode.pips)) {
    ui.notifications.warn(game.i18n.localize("SW1E.Combat.InvalidWeaponDamage"));
    return null;
  }

  const promptData = await promptWeaponDamage(weapon, damageCode);
  if (!promptData) return null;

  const roll = await postDiceCodeMessage({
    actor,
    label: `${weapon.name} — ${game.i18n.localize("SW1E.Combat.Damage")}`,
    dice: damageCode.dice,
    pips: damageCode.pips,
    modifier: promptData.modifier,
    diceModifier: promptData.diceModifier,
    modifierLabel: promptData.modifierLabel,
    flavor: `${weapon.name} Damage`,
    extraLines: [
      `<p><strong>${game.i18n.localize("SW1E.Combat.DamageTypeLabel")}:</strong> ${game.i18n.localize(`SW1E.Combat.DamageType.${promptData.fireMode}`)}</p>`,
      damageCode.modifiers.length ? `<p><strong>${game.i18n.localize("SW1E.Combat.AutoModifiers")}:</strong> ${damageCode.modifiers.map(escapeHtml).join("; ")}</p>` : ""
    ]
  });

  return roll;
}
