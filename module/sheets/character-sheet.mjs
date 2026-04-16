import { SW1E } from "../config.mjs";
import { formatDiceCode } from "../dice.mjs";
import { getEquippedArmorBonus, getWeaponAttackSkillLabel, rollAction, rollDamageResistance, rollWeaponAttack, rollWeaponDamage } from "../combat.mjs";
import { getHealingSummary, openHealingDialog } from "../healing.mjs";
import { openAdvancementDialog } from "../advancement.mjs";
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
} from "../force.mjs";

const { ActorSheet } = foundry.appv1.sheets;

export class SW1ECharacterSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sw1e", "sheet", "actor"],
      template: "systems/sw1e/templates/actor/character-sheet.hbs",
      width: 820,
      height: 860,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
    });
  }

  async getData(options = {}) {
    const context = await super.getData(options);
    const system = this.actor.system;

    const skillItems = [...this.actor.items.filter(i => i.type === "skill")].sort((a, b) => a.name.localeCompare(b.name));
    const equipmentItems = [...this.actor.items.filter(i => i.type === "equipment")].sort((a, b) => a.name.localeCompare(b.name));
    const weaponItems = [...this.actor.items.filter(i => i.type === "weapon")].sort((a, b) => a.name.localeCompare(b.name));
    const forcePowerItems = [...this.actor.items.filter(i => i.type === "forcePower")].sort((a, b) => a.name.localeCompare(b.name));

    const attributes = Object.entries(system.attributes ?? {}).map(([key, value]) => ({
      key,
      label: game.i18n.localize(SW1E.attributes[key] ?? value.label ?? key),
      dice: Number(value.dice) || 0,
      pips: Number(value.pips) || 0,
      diceCode: formatDiceCode(value.dice, value.pips),
      skills: skillItems
        .filter(item => item.system.linkedAttribute === key)
        .map(item => ({
          id: item.id,
          name: item.name,
          dice: Number(item.system.dice) || 0,
          pips: Number(item.system.pips) || 0,
          diceCode: formatDiceCode(item.system.dice, item.system.pips),
          linkedAttribute: item.system.linkedAttribute,
          isAdvanced: item.system.isAdvanced
        }))
    }));

    const armorBonus = getEquippedArmorBonus(this.actor);
    const forceSkills = SW1E.forceSkillKeys.map(key => {
      const data = system.force?.[key] ?? {};
      const dice = Number(data.dice) || 0;
      const pips = Number(data.pips) || 0;
      return {
        key,
        label: game.i18n.localize(SW1E.forceSkills[key]),
        dice,
        pips,
        diceCode: formatDiceCode(dice, pips),
        trained: dice > 0 || pips > 0
      };
    });

    context.system = system;
    context.actorTypeLabel = game.i18n.localize(`TYPES.Actor.${this.actor.type}`);
    context.attributes = attributes;
    context.equipment = equipmentItems.map(item => ({
      id: item.id,
      name: item.name,
      category: item.system.category,
      quantity: Number(item.system.quantity) || 0,
      showQuantity: (Number(item.system.quantity) || 0) > 1,
      cost: item.system.cost,
      hasCost: item.system.cost !== null && item.system.cost !== undefined && item.system.cost !== "",
      equipped: !!item.system.equipped,
      armorCode: formatDiceCode(item.system.armorDice, item.system.armorPips)
    }));
    const senseTrained = (Number(system.force?.sense?.dice) || 0) > 0 || (Number(system.force?.sense?.pips) || 0) > 0;
    context.weapons = weaponItems.map(item => ({
      id: item.id,
      name: item.name,
      damageCode: item.system.lightsaberUsesControlDamage
        ? `${formatDiceCode(item.system.damageDice, item.system.damagePips)} + ${game.i18n.localize(SW1E.forceSkills.control)}`
        : formatDiceCode(item.system.damageDice, item.system.damagePips),
      skillUsed: getWeaponAttackSkillLabel(this.actor, item),
      range: item.system.range,
      cost: item.system.cost,
      hasCost: item.system.cost !== null && item.system.cost !== undefined && item.system.cost !== "",
      canLightsaberParry: !!item.system.lightsaberUsesSenseParry && senseTrained
    }));
    context.forceSkills = forceSkills;
    context.forcePowers = forcePowerItems.map(item => ({
      id: item.id,
      name: item.name,
      requirementLabel: getForcePowerRequirementLabel(item.system),
      difficultySummary: getForcePowerDifficultySummary(item.system),
      keepUp: !!item.system.keepUp,
      isUp: !!item.system.isUp,
      darkSideWarning: !!item.system.darkSideWarning,
      sourcePage: item.system.sourcePage
    }));
    context.activeForceSkillCount = getKeptUpSkillCount(this.actor);
    context.forceRulesNote = game.i18n.localize("SW1E.Force.RulesNote");
    context.unlinkedSkills = skillItems.filter(item => !system.attributes?.[item.system.linkedAttribute]);
    context.woundStatuses = Object.entries(SW1E.woundStatuses).map(([key, value]) => ({
      key,
      label: game.i18n.localize(value)
    }));
    context.hasArmorBonus = Boolean(armorBonus.dice || armorBonus.pips);
    context.armorBonusCode = formatDiceCode(armorBonus.dice, armorBonus.pips);
    context.healingSummary = getHealingSummary(this.actor);

    const forcePointState = getActiveForcePointState(this.actor);
    const forcePointsRemaining = Math.max(0, Number(system.resources?.forcePoints) || 0);
    context.forcePointActive = forcePointState.active;
    context.forcePointState = forcePointState;
    context.forcePointStateLabel = forcePointState.label;
    if (forcePointState.active && forcePointState.mode === "manual") {
      context.forcePointButtonAction = "clear";
      context.forcePointButtonLabel = game.i18n.localize("SW1E.ForcePoint.EndButton");
      context.forcePointButtonDisabled = false;
    } else if (forcePointState.active) {
      context.forcePointButtonAction = "active";
      context.forcePointButtonLabel = game.i18n.localize("SW1E.ForcePoint.ActiveButton");
      context.forcePointButtonDisabled = true;
    } else {
      context.forcePointButtonAction = "spend";
      context.forcePointButtonLabel = game.i18n.localize("SW1E.ForcePoint.Button");
      context.forcePointButtonDisabled = forcePointsRemaining < 1;
    }

    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".sw1e-roll-attribute").on("click", this._onRollAttribute.bind(this));
    html.find(".sw1e-roll-skill").on("click", this._onRollSkill.bind(this));
    html.find(".sw1e-roll-force-skill").on("click", this._onRollForceSkill.bind(this));
    html.find(".sw1e-roll-resistance").on("click", this._onRollResistance.bind(this));
    html.find(".sw1e-open-healing").on("click", this._onOpenHealing.bind(this));
    html.find(".sw1e-force-point").on("click", this._onForcePoint.bind(this));
    html.find(".sw1e-open-advancement").on("click", this._onOpenAdvancement.bind(this));
    html.find(".sw1e-weapon-attack").on("click", this._onWeaponAttack.bind(this));
    html.find(".sw1e-weapon-damage").on("click", this._onWeaponDamage.bind(this));
    html.find(".sw1e-force-use").on("click", this._onUseForcePower.bind(this));
    html.find(".sw1e-force-toggle").on("click", this._onToggleForcePower.bind(this));
    html.find(".sw1e-lightsaber-parry").on("click", this._onLightsaberParry.bind(this));
    html.find(".item-create").on("click", this._onItemCreate.bind(this));
    html.find(".item-edit").on("click", this._onItemEdit.bind(this));
    html.find(".item-delete").on("click", this._onItemDelete.bind(this));
    html.find(".item-toggle-equipped").on("click", this._onToggleEquipped.bind(this));
  }

  async _onRollAttribute(event) {
    event.preventDefault();
    const attributeKey = event.currentTarget.dataset.attribute;
    const attribute = this.actor.system.attributes?.[attributeKey];
    if (!attribute) return;

    const label = game.i18n.localize(SW1E.attributes[attributeKey] ?? attributeKey);
    await rollAction({
      actor: this.actor,
      actionCode: {
        type: "attribute",
        key: attributeKey,
        label,
        dice: Number(attribute.dice) || 0,
        pips: Number(attribute.pips) || 0,
        usesDexterity: attributeKey === "dexterity"
      }
    });
  }

  async _onRollSkill(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const skill = this.actor.items.get(itemId);
    if (!skill) return;

    await rollAction({
      actor: this.actor,
      actionCode: {
        type: "skill",
        key: skill.id,
        label: skill.name,
        dice: Number(skill.system.dice) || 0,
        pips: Number(skill.system.pips) || 0,
        usesDexterity: skill.system.linkedAttribute === "dexterity"
      }
    });
  }

  async _onRollForceSkill(event) {
    event.preventDefault();
    const skillKey = event.currentTarget.dataset.forceSkill;
    await rollForceSkill({ actor: this.actor, skillKey });
  }

  async _onRollResistance(event) {
    event.preventDefault();
    await rollDamageResistance({ actor: this.actor });
  }


  async _onOpenHealing(event) {
    event.preventDefault();
    await openHealingDialog({ patient: this.actor });
    this.render(false);
  }


  async _onForcePoint(event) {
    event.preventDefault();
    const action = String(event.currentTarget?.dataset?.forcePointAction ?? "").trim();
    if (action === "clear") {
      await clearForcePointState({ actor: this.actor });
      this.render(false);
      return;
    }
    if (action === "spend") {
      const result = await spendForcePoint({ actor: this.actor });
      if (result) this.render(false);
    }
  }

  async _onOpenAdvancement(event) {
    event.preventDefault();
    const changed = await openAdvancementDialog({ actor: this.actor });
    if (changed) this.render(false);
  }

  async _onWeaponAttack(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const weapon = this.actor.items.get(itemId);
    if (!weapon) return;
    await rollWeaponAttack({ actor: this.actor, weapon });
  }

  async _onWeaponDamage(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const weapon = this.actor.items.get(itemId);
    if (!weapon) return;
    await rollWeaponDamage({ actor: this.actor, weapon });
  }

  async _onUseForcePower(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const power = this.actor.items.get(itemId);
    if (!power) return;
    await activateForcePower({ actor: this.actor, power });
  }

  async _onLightsaberParry(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const weapon = this.actor.items.get(itemId);
    if (!weapon) return;
    await rollLightsaberParry({ actor: this.actor, weapon });
  }

  async _onToggleForcePower(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const power = this.actor.items.get(itemId);
    if (!power) return;
    await toggleForcePowerUp({ power });
    this.render(false);
  }

  async _onItemCreate(event) {
    event.preventDefault();
    const type = event.currentTarget.dataset.type;
    const linkedAttribute = event.currentTarget.dataset.attribute || "";
    const typeLabel = game.i18n.localize(`TYPES.Item.${type}`);

    const itemData = {
      name: game.i18n.format("SW1E.NewItem", { type: typeLabel }),
      type,
      system: {}
    };

    if (type === "skill") itemData.system.linkedAttribute = linkedAttribute || "dexterity";
    if (type === "equipment") itemData.system.category = "gear";
    if (type === "weapon") itemData.system.category = "weapon";
    if (type === "forcePower") {
      itemData.system.requiresControl = true;
      itemData.system.keepUp = false;
      itemData.system.isUp = false;
    }

    const created = await this.actor.createEmbeddedDocuments("Item", [itemData]);
    if (created?.length) created[0].sheet.render(true);
  }

  _onItemEdit(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) item.sheet.render(true);
  }

  async _onItemDelete(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    await item.delete();
  }

  async _onToggleEquipped(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item || item.type !== "equipment") return;
    await item.update({ "system.equipped": !item.system.equipped });
  }
}
