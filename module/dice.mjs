export function clampPips(pips = 0) {
  const safe = Number.isFinite(Number(pips)) ? Number(pips) : 0;
  return Math.max(0, safe);
}

export function diceCodeToPips(dice = 0, pips = 0) {
  const safeDice = Number.isFinite(Number(dice)) ? Number(dice) : 0;
  const safePips = Number.isFinite(Number(pips)) ? Number(pips) : 0;
  return (safeDice * 3) + safePips;
}

export function pipsToDiceCode(totalPips = 0) {
  const safeTotal = Math.max(0, Number.isFinite(Number(totalPips)) ? Number(totalPips) : 0);
  const dice = Math.floor(safeTotal / 3);
  const pips = safeTotal % 3;
  return { dice, pips };
}

export function adjustDiceCode({ dice = 0, pips = 0 } = {}, { dice: diceDelta = 0, pips: pipDelta = 0 } = {}) {
  const total = diceCodeToPips(dice, pips) + diceCodeToPips(diceDelta, pipDelta);
  return pipsToDiceCode(total);
}

export function multiplyDiceCode({ dice = 0, pips = 0 } = {}, multiplier = 1) {
  const safeMultiplier = Number.isFinite(Number(multiplier)) ? Number(multiplier) : 1;
  return pipsToDiceCode(diceCodeToPips(dice, pips) * safeMultiplier);
}

export function isRollableDiceCode(dice = 0, pips = 0) {
  return diceCodeToPips(dice, pips) >= 3;
}

export function formatDiceCode(dice = 0, pips = 0) {
  const normalized = pipsToDiceCode(diceCodeToPips(dice, pips));
  if (normalized.pips > 0) return `${normalized.dice}D+${normalized.pips}`;
  return `${normalized.dice}D`;
}

export function parseDiceModifier(input = "") {
  const raw = String(input ?? "").trim();
  if (!raw) return { raw: "", dice: 0, pips: 0, totalPips: 0, valid: true };

  const normalized = raw.toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  const pattern = /([+-]?)(\d+)(d|dice|die|pips|pip|p)?/g;

  let dice = 0;
  let pips = 0;
  let consumed = "";
  let match;

  while ((match = pattern.exec(normalized)) !== null) {
    if (match.index !== consumed.length) {
      return { raw, dice: 0, pips: 0, totalPips: 0, valid: false };
    }

    const sign = match[1] === "-" ? -1 : 1;
    const amount = Number(match[2]) || 0;
    const unit = match[3] || "pips";

    if (["d", "dice", "die"].includes(unit)) dice += sign * amount;
    else pips += sign * amount;

    consumed += match[0];
  }

  if (!consumed || consumed.length !== normalized.length) {
    return { raw, dice: 0, pips: 0, totalPips: 0, valid: false };
  }

  return {
    raw,
    dice,
    pips,
    totalPips: diceCodeToPips(dice, pips),
    valid: true
  };
}

export function formatSignedDiceModifier(input = "") {
  const parsed = typeof input === "object" && input !== null && "totalPips" in input
    ? input
    : parseDiceModifier(input);

  if (!parsed.valid || !parsed.totalPips) return "";

  const sign = parsed.totalPips < 0 ? "-" : "+";
  const normalized = pipsToDiceCode(Math.abs(parsed.totalPips));

  if (normalized.dice > 0 && normalized.pips > 0) {
    return sign === "+"
      ? `+${normalized.dice}D+${normalized.pips}`
      : `-${normalized.dice}D-${normalized.pips}`;
  }

  if (normalized.dice > 0) return `${sign}${normalized.dice}D`;
  return `${sign}${normalized.pips}`;
}

async function promptRollModifier(label) {
  try {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("SW1E.RollPrompt.Title", { label }) },
      content: `
        <form class="sw1e-roll-prompt">
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

    return result;
  } catch {
    return null;
  }
}

function buildRollFormula(dice = 0, pips = 0, modifier = 0) {
  const parts = [];
  const dieCount = Number(dice) || 0;
  const pipCount = Number(pips) || 0;
  const flatModifier = Number(modifier) || 0;

  if (dieCount > 0) parts.push(`${dieCount}d6`);
  if (pipCount !== 0) parts.push(`${pipCount}`);
  if (flatModifier !== 0) parts.push(`${flatModifier}`);

  return parts.length ? parts.join(" + ") : "0";
}

export async function evaluateDiceCode({ dice = 0, pips = 0, modifier = 0 } = {}) {
  const formula = buildRollFormula(dice, pips, modifier);
  const roll = await (new Roll(formula)).evaluate();
  return roll;
}

export function formatDieResults(roll) {
  return roll?.dice?.length
    ? roll.dice.map(d => `[${d.results.map(r => r.result).join(", ")}]`).join(" ")
    : game.i18n.localize("SW1E.None");
}

export async function postDiceCodeMessage({
  actor = null,
  label = "Roll",
  dice = 0,
  pips = 0,
  modifier = 0,
  diceModifier = "",
  modifierLabel = "",
  flavor = "",
  extraLines = []
} = {}) {
  const parsedDiceModifier = parseDiceModifier(diceModifier);
  if (!parsedDiceModifier.valid) {
    ui.notifications.warn(game.i18n.localize("SW1E.RollPrompt.InvalidDiceModifier"));
    return null;
  }

  const adjustedCode = adjustDiceCode({ dice, pips }, {
    dice: parsedDiceModifier.dice,
    pips: parsedDiceModifier.pips
  });

  if (!isRollableDiceCode(adjustedCode.dice, adjustedCode.pips)) {
    ui.notifications.warn(game.i18n.localize("SW1E.RollPrompt.BelowOneD"));
    return null;
  }

  const roll = await evaluateDiceCode({ dice: adjustedCode.dice, pips: adjustedCode.pips, modifier });
  const dieResults = formatDieResults(roll);
  const lines = [
    parsedDiceModifier.totalPips !== 0
      ? `<p><strong>${game.i18n.localize("SW1E.RollPrompt.BaseDiceCode")}:</strong> ${formatDiceCode(dice, pips)}</p>`
      : `<p><strong>${game.i18n.localize("SW1E.DiceCode")}:</strong> ${formatDiceCode(adjustedCode.dice, adjustedCode.pips)}</p>`,
    `<p><strong>${game.i18n.localize("SW1E.DiceResults")}:</strong> ${dieResults}</p>`
  ];

  if (parsedDiceModifier.totalPips !== 0) {
    const safeLabel = modifierLabel ? ` (${foundry.utils.escapeHTML(modifierLabel)})` : "";
    lines.push(`<p><strong>${game.i18n.localize("SW1E.RollPrompt.DiceModifier")}:</strong> ${formatSignedDiceModifier(parsedDiceModifier)}${safeLabel}</p>`);
    lines.push(`<p><strong>${game.i18n.localize("SW1E.DiceCode")}:</strong> ${formatDiceCode(adjustedCode.dice, adjustedCode.pips)}</p>`);
  }

  if (modifier !== 0) {
    const safeLabel = modifierLabel ? ` (${foundry.utils.escapeHTML(modifierLabel)})` : "";
    lines.push(`<p><strong>${game.i18n.localize("SW1E.RollPrompt.Modifier")}:</strong> ${modifier}${safeLabel}</p>`);
  }

  for (const line of extraLines) {
    if (line) lines.push(line);
  }

  lines.push(`<p><strong>${game.i18n.localize("SW1E.Total")}:</strong> ${roll.total}</p>`);

  const content = `
    <div class="sw1e-chat-card">
      <h3>${foundry.utils.escapeHTML(label)}</h3>
      ${lines.join("\n")}
    </div>
  `;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: flavor || label,
    content
  });

  return roll;
}

export async function rollDiceCode({ actor = null, label = "Roll", dice = 0, pips = 0 }) {
  const modifierData = await promptRollModifier(label);
  if (modifierData === null) return null;

  return postDiceCodeMessage({
    actor,
    label,
    dice,
    pips,
    modifier: modifierData.modifier,
    diceModifier: modifierData.diceModifier,
    modifierLabel: modifierData.modifierLabel,
    flavor: label
  });
}
