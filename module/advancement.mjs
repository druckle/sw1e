import { SW1E } from "./config.mjs";
import { formatDiceCode, pipsToDiceCode, diceCodeToPips } from "./dice.mjs";

function escapeHtml(value = "") {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function getSkillPointPool(actor) {
  const value = Number(actor?.system?.resources?.skillPoints);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function getBaseImprovementCost(dice = 0) {
  const safeDice = Number.isFinite(Number(dice)) ? Number(dice) : 0;
  return Math.max(1, Math.trunc(safeDice));
}

function getNextPipCode(dice = 0, pips = 0) {
  return pipsToDiceCode(diceCodeToPips(dice, pips) + 1);
}

function buildSkillOption(actor, item) {
  const dice = Number(item.system?.dice) || 0;
  const pips = Number(item.system?.pips) || 0;
  const totalPips = diceCodeToPips(dice, pips);
  if (totalPips <= 0) return null;

  const next = getNextPipCode(dice, pips);
  const advanced = !!item.system?.isAdvanced;
  const baseCost = getBaseImprovementCost(dice);
  const totalCost = advanced ? baseCost * 2 : baseCost;

  return {
    id: `skill:${item.id}`,
    kind: 'skill',
    label: item.name,
    currentCode: formatDiceCode(dice, pips),
    nextCode: formatDiceCode(next.dice, next.pips),
    currentDice: dice,
    currentPips: pips,
    nextDice: next.dice,
    nextPips: next.pips,
    advanced,
    forceSkill: false,
    baseCost,
    totalCost,
    disabled: false,
    disabledReason: '',
    update: { document: item }
  };
}

function buildForceOption(actor, skillKey) {
  const entry = actor.system?.force?.[skillKey] ?? {};
  const dice = Number(entry.dice) || 0;
  const pips = Number(entry.pips) || 0;
  const totalPips = diceCodeToPips(dice, pips);
  const next = getNextPipCode(dice, pips);
  const label = game.i18n.localize(SW1E.forceSkills[skillKey] ?? skillKey);

  if (totalPips < 3) {
    return {
      id: `force:${skillKey}`,
      kind: 'force',
      key: skillKey,
      label,
      currentCode: formatDiceCode(dice, pips),
      nextCode: formatDiceCode(next.dice, next.pips),
      currentDice: dice,
      currentPips: pips,
      nextDice: next.dice,
      nextPips: next.pips,
      advanced: false,
      forceSkill: true,
      baseCost: 0,
      totalCost: 0,
      disabled: true,
      disabledReason: game.i18n.localize('SW1E.Advancement.UntrainedForceBlocked'),
      update: { path: `system.force.${skillKey}` }
    };
  }

  const baseCost = getBaseImprovementCost(dice);
  return {
    id: `force:${skillKey}`,
    kind: 'force',
    key: skillKey,
    label,
    currentCode: formatDiceCode(dice, pips),
    nextCode: formatDiceCode(next.dice, next.pips),
    currentDice: dice,
    currentPips: pips,
    nextDice: next.dice,
    nextPips: next.pips,
    advanced: false,
    forceSkill: true,
    baseCost,
    totalCost: baseCost,
    disabled: false,
    disabledReason: '',
    update: { path: `system.force.${skillKey}` }
  };
}

export function getAdvancementOptions(actor) {
  if (!actor || !['character', 'npc'].includes(actor.type)) return [];

  const skillOptions = actor.items
    .filter(item => item.type === 'skill')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(item => buildSkillOption(actor, item))
    .filter(Boolean);

  const forceOptions = SW1E.forceSkillKeys
    .map(skillKey => buildForceOption(actor, skillKey));

  return [...skillOptions, ...forceOptions].sort((a, b) => {
    if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
    if (a.forceSkill !== b.forceSkill) return a.forceSkill ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

function buildOptionLabel(option) {
  if (option.disabled) {
    return `${option.label} (${option.currentCode}) — ${game.i18n.localize('SW1E.Advancement.ManualOnly')}`;
  }

  const costLabel = game.i18n.format('SW1E.Advancement.CostLabel', { cost: option.totalCost });
  const advancedLabel = option.advanced ? ` • ${game.i18n.localize('SW1E.Advancement.AdvancedMultiplier')}` : '';
  const forceLabel = option.forceSkill ? ` • ${game.i18n.localize('SW1E.Advancement.ForceSkill')}` : '';
  return `${option.label} ${option.currentCode} → ${option.nextCode} • ${costLabel}${advancedLabel}${forceLabel}`;
}

function buildDialogContent(actor, options, currentPoints) {
  const optionMarkup = options.map(option => {
    const disabled = option.disabled ? 'disabled' : '';
    const selected = !option.disabled && option === options.find(entry => !entry.disabled) ? 'selected' : '';
    return `<option value="${escapeHtml(option.id)}" ${disabled} ${selected}>${escapeHtml(buildOptionLabel(option))}</option>`;
  }).join('');

  return `
    <form class="sw1e-advancement-dialog">
      <div class="sw1e-advancement-summary">
        <p><strong>${escapeHtml(actor.name)}</strong></p>
        <p>${escapeHtml(game.i18n.format('SW1E.Advancement.CurrentPoints', { points: currentPoints }))}</p>
        <p>${escapeHtml(game.i18n.localize('SW1E.Advancement.OnePipOnly'))}</p>
      </div>
      <div class="form-group">
        <label>${escapeHtml(game.i18n.localize('SW1E.Advancement.ChooseImprovement'))}</label>
        <select name="advancementTarget" autofocus>
          ${optionMarkup}
        </select>
      </div>
      <div class="form-group checkbox-row">
        <label>
          <input type="checkbox" name="forceAboveMaster" value="1">
          ${escapeHtml(game.i18n.localize('SW1E.Advancement.ForceAboveMaster'))}
        </label>
      </div>
      <p class="notes">${escapeHtml(game.i18n.localize('SW1E.Advancement.ManualNote'))}</p>
    </form>
  `;
}

function resolveSelectedOption(options, form) {
  const targetId = String(form.elements.advancementTarget?.value ?? '');
  const option = options.find(entry => entry.id === targetId);
  if (!option || option.disabled) return null;

  const forceAboveMaster = !!form.elements.forceAboveMaster?.checked;
  const multiplier = option.forceSkill && forceAboveMaster ? 2 : 1;
  const cost = option.totalCost * multiplier;

  return {
    option,
    cost,
    forceAboveMaster
  };
}

async function postAdvancementMessage({ actor, option, spent, remaining, forceAboveMaster = false } = {}) {
  const extra = [];
  if (option.advanced) extra.push(game.i18n.localize('SW1E.Advancement.AdvancedMultiplier'));
  if (option.forceSkill) extra.push(game.i18n.localize('SW1E.Advancement.ForceSkill'));
  if (option.forceSkill && forceAboveMaster) extra.push(game.i18n.localize('SW1E.Advancement.AboveMasterApplied'));

  const content = `
    <div class="sw1e-chat-card">
      <h3>${escapeHtml(game.i18n.localize('SW1E.Advancement.ChatTitle'))}</h3>
      <p><strong>${escapeHtml(game.i18n.localize('SW1E.Actor'))}:</strong> ${escapeHtml(actor.name)}</p>
      <p><strong>${escapeHtml(game.i18n.localize('SW1E.Advancement.Improvement'))}:</strong> ${escapeHtml(option.label)}</p>
      <p><strong>${escapeHtml(game.i18n.localize('SW1E.Advancement.CodeChange'))}:</strong> ${escapeHtml(option.currentCode)} → ${escapeHtml(option.nextCode)}</p>
      <p><strong>${escapeHtml(game.i18n.localize('SW1E.Advancement.Spent'))}:</strong> ${spent}</p>
      <p><strong>${escapeHtml(game.i18n.localize('SW1E.Advancement.Remaining'))}:</strong> ${remaining}</p>
      ${extra.length ? `<p><strong>${escapeHtml(game.i18n.localize('SW1E.Notes'))}:</strong> ${escapeHtml(extra.join(' • '))}</p>` : ''}
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: game.i18n.localize('SW1E.Advancement.ChatTitle'),
    content
  });
}

export async function applyAdvancementSelection({ actor, option, cost, forceAboveMaster = false } = {}) {
  if (!actor || !option) return false;

  const currentPoints = getSkillPointPool(actor);
  if (currentPoints < cost) {
    ui.notifications.warn(game.i18n.format('SW1E.Advancement.NotEnoughPoints', { cost, points: currentPoints }));
    return false;
  }

  if (option.kind === 'skill') {
    await option.update.document.update({
      'system.dice': option.nextDice,
      'system.pips': option.nextPips
    });
  } else if (option.kind === 'force') {
    await actor.update({
      [`${option.update.path}.dice`]: option.nextDice,
      [`${option.update.path}.pips`]: option.nextPips
    });
  } else {
    return false;
  }

  const remaining = currentPoints - cost;
  await actor.update({ 'system.resources.skillPoints': remaining });
  await postAdvancementMessage({ actor, option, spent: cost, remaining, forceAboveMaster });
  ui.notifications.info(game.i18n.format('SW1E.Advancement.Applied', { label: option.label, cost }));
  return true;
}

export async function openAdvancementDialog({ actor } = {}) {
  if (!actor || !['character', 'npc'].includes(actor.type)) return false;

  const options = getAdvancementOptions(actor);
  if (!options.length) {
    ui.notifications.warn(game.i18n.localize('SW1E.Advancement.NoEligible'));
    return false;
  }

  const currentPoints = getSkillPointPool(actor);
  const selectable = options.filter(option => !option.disabled);
  if (!selectable.length) {
    ui.notifications.warn(game.i18n.localize('SW1E.Advancement.NoEligible'));
    return false;
  }

  let result = null;
  try {
    result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format('SW1E.Advancement.Title', { actor: actor.name }) },
      content: buildDialogContent(actor, options, currentPoints),
      ok: {
        label: game.i18n.localize('SW1E.Advancement.SpendButton'),
        callback: (event, button) => resolveSelectedOption(options, button.form)
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return false;
  }

  if (!result?.option) return false;
  return await applyAdvancementSelection({ actor, ...result });
}
