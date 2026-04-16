import { SW1E } from "../config.mjs";
import { formatDiceCode } from "../dice.mjs";

const TOTAL_STARTING_SKILL_DICE = 7;
const MAX_STARTING_SKILL_BONUS = 2;
const BUILDER_TEMPLATE_PATH = "systems/sw1e/templates/apps/character-builder.hbs";

const TEMPLATE_STARTING_DATA = {
  "Kid": {
    frontPage: 123,
    backPage: 124,
    credits: 250,
    equipment: [
      "two bottles of fizzyglug",
      "one packet candy",
      "a small stone",
      "length of string",
      "a small animal (dead or alive — your choice)"
    ]
  },
  "Gambler": {
    frontPage: 123,
    backPage: 124,
    credits: 1000,
    equipment: [
      "deck of cards",
      "hold-out blaster",
      "two sets of flashy clothes"
    ]
  },
  "Failed Jedi": {
    frontPage: 123,
    backPage: 124,
    credits: 250,
    equipment: [
      "lightsaber",
      "robes",
      "bottle of rotgut"
    ]
  },
  "Laconic Scout": {
    frontPage: 125,
    backPage: 126,
    credits: 1000,
    equipment: [
      "2 medpacs",
      "knife",
      "blaster pistol",
      "backpack",
      "week's concentrated rations"
    ]
  },
  "Loyal Retainer": {
    frontPage: 125,
    backPage: 126,
    credits: 1000,
    equipment: [
      "several changes of clothing for just about any occasion",
      "hold-out blaster",
      "comlink"
    ]
  },
  "The Merc": {
    frontPage: 125,
    backPage: 126,
    credits: 2000,
    equipment: [
      "uniform of your unit",
      "comlink",
      "blaster rifle",
      "backpack",
      "melee weapon of your choice",
      "protective helmet"
    ]
  },
  "Old Senatorial": {
    frontPage: 127,
    backPage: 128,
    credits: 2000,
    equipment: [
      "hold-out blaster",
      "spartan clothing",
      "comlink"
    ]
  },
  "Mon Calamari": {
    frontPage: 127,
    backPage: 128,
    credits: 1000,
    equipment: [
      "blaster pistol",
      "uniform",
      "comlink"
    ]
  },
  "Minor Jedi": {
    frontPage: 127,
    backPage: 128,
    credits: 1000,
    equipment: [
      "lightsaber"
    ]
  },
  "Quixotic Jedi": {
    frontPage: 129,
    backPage: 130,
    credits: 1000,
    equipment: [
      "duelling sword (it'll have to do until you find a real lightsaber — damage code is strength+1D+1)"
    ]
  },
  "Pirate": {
    frontPage: 129,
    backPage: 130,
    credits: 2000,
    equipment: [
      "flashy clothes",
      "comlink",
      "lots of rings & things",
      "vacuum suit",
      "blaster",
      "saber (just for show — damage code is strength+1D+1)"
    ]
  },
  "The Outlaw": {
    frontPage: 129,
    backPage: 130,
    credits: 1000,
    equipment: [
      "heavy blaster pistol"
    ]
  },
  "Tongue-Tied Engineer": {
    frontPage: 131,
    backPage: 132,
    credits: 1000,
    equipment: [
      "pocket computer",
      "R2 unit"
    ]
  },
  "Smuggler": {
    frontPage: 131,
    backPage: 132,
    credits: 2000,
    equipment: [
      "stock light freighter",
      "heavy blaster pistol",
      "comlink"
    ]
  },
  "Retired Imperial Captain": {
    frontPage: 131,
    backPage: 132,
    credits: 2000,
    equipment: [
      "Imperial Navy uniform (slightly out of date)",
      "blaster"
    ]
  },
  "Tough Native": {
    frontPage: 133,
    backPage: 134,
    credits: 500,
    equipment: [
      "sword (damage code is strength+1D+1)",
      "black-powder pistol (see page 52)",
      "powder horn",
      "large, floppy hat",
      "extravagant clothing"
    ]
  },
  "Wookiee": {
    frontPage: 133,
    backPage: 134,
    credits: 250,
    equipment: [
      "bowcaster (see page 52)"
    ]
  },
  "Young Senatorial": {
    frontPage: 133,
    backPage: 134,
    credits: 1000,
    equipment: [
      "stylish clothing",
      "hold-out blaster",
      "comlink"
    ]
  }
};

const EQUIPMENT_ALIASES = new Map([
  ["hold-out blaster", { pack: "weapons", name: "Hold-out Blaster" }],
  ["heavy blaster pistol", { pack: "weapons", name: "Heavy Blaster Pistol" }],
  ["blaster pistol", { pack: "weapons", name: "Blaster Pistol" }],
  ["blaster rifle", { pack: "weapons", name: "Blaster Rifle" }],
  ["lightsaber", { pack: "weapons", name: "Lightsaber" }],
  ["black-powder pistol", { pack: "weapons", name: "Black-powder Pistol" }],
  ["bowcaster", { pack: "weapons", name: "Wookiee Bowcaster" }],
  ["comlink", { pack: "equipment", name: "Comlink" }],
  ["pocket computer", { pack: "equipment", name: "Pocket Computer" }],
  ["week's concentrated rations", { pack: "equipment", name: "Rations, 1 Week, Concentrate" }],
  ["protective helmet", { pack: "equipment", name: "Protective Helmet" }],
  ["medpac", { pack: "equipment", name: "Medpac" }],
  ["medpacs", { pack: "equipment", name: "Medpac", quantity: 2 }]
]);

function makeDefaultIdentity() {
  return {
    characterName: "",
    species: "",
    sex: "",
    age: "",
    height: "",
    weight: "",
    physicalDescription: ""
  };
}

function parseBonusValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.clamped ? Math.clamped(parsed, 0, MAX_STARTING_SKILL_BONUS) : Math.max(0, Math.min(MAX_STARTING_SKILL_BONUS, parsed));
}

function getTemplateStartingData(templateName) {
  return TEMPLATE_STARTING_DATA[templateName] ?? null;
}

function normalizeLine(line) {
  return String(line ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[—–-]/g, " ")
    .replace(/[^a-z0-9\s']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatBuilderDice(dice, pips, bonus = 0) {
  return formatDiceCode((Number(dice) || 0) + (Number(bonus) || 0), Number(pips) || 0);
}

export function attachCharacterBuilderButton(html) {
  const footer = html.find(".directory-footer");
  if (!footer.length) return;
  if (footer.find(".sw1e-character-builder-button").length) return;

  const label = game.i18n.localize("SW1E.CharacterBuilder.Open");
  const button = $(
    `<button type="button" class="sw1e-character-builder-button"><i class="fas fa-user-plus"></i> ${label}</button>`
  );
  button.on("click", () => new SW1ECharacterBuilder().render(true));
  footer.append(button);
}

export class SW1ECharacterBuilder extends FormApplication {
  constructor(options = {}) {
    super({}, options);
    this.state = {
      templateId: "",
      identity: makeDefaultIdentity(),
      skillBonuses: {},
      forceBonuses: {},
      importEquipment: true
    };
    this._templates = null;
    this._skills = null;
    this._packCache = new Map();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "sw1e-character-builder",
      classes: ["sw1e", "sheet", "character-builder"],
      template: BUILDER_TEMPLATE_PATH,
      title: game.i18n.localize("SW1E.CharacterBuilder.Title"),
      width: 1120,
      height: 860,
      closeOnSubmit: false,
      resizable: true,
      submitOnChange: false,
      submitOnClose: false
    });
  }

  async getData() {
    const templates = await this._getTemplateDocs();
    if (!this.state.templateId && templates.length) this.state.templateId = templates[0].id;

    const selectedTemplate = templates.find(template => template.id === this.state.templateId) ?? templates[0] ?? null;
    const templateSkills = await this._getSkillDocs();
    const startingData = selectedTemplate ? getTemplateStartingData(selectedTemplate.name) : null;

    const attributes = this._buildAttributeSummary(selectedTemplate);
    const forceSkills = this._buildForceSummary(selectedTemplate);
    const skillRows = this._buildSkillRows(selectedTemplate, templateSkills);
    const spentDice = this._getSpentDice();
    const remainingDice = TOTAL_STARTING_SKILL_DICE - spentDice;

    return {
      templates: templates.map(template => ({
        id: template.id,
        name: template.name,
        selected: template.id === selectedTemplate?.id
      })),
      selectedTemplate,
      templateSourceLabel: startingData
        ? game.i18n.format("SW1E.CharacterBuilder.TemplateSource", {
            front: startingData.frontPage,
            back: startingData.backPage
          })
        : "",
      attributes,
      forceSkills,
      skillRows,
      remainingDice,
      spentDice,
      totalSkillDice: TOTAL_STARTING_SKILL_DICE,
      importEquipment: this.state.importEquipment,
      identity: this.state.identity,
      startingCredits: startingData?.credits ?? "",
      startingEquipment: startingData?.equipment ?? [],
      hasEquipmentData: Boolean(startingData?.equipment?.length || startingData?.credits),
      creationNote: game.i18n.localize("SW1E.CharacterBuilder.CreationNote"),
      forceNote: game.i18n.localize("SW1E.CharacterBuilder.ForceNote"),
      templateGearNote: game.i18n.localize("SW1E.CharacterBuilder.TemplateGearNote")
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".sw1e-template-select").on("change", event => {
      this._captureFormState(html);
      this.state.templateId = event.currentTarget.value;
      this.state.skillBonuses = {};
      this.state.forceBonuses = {};
      this.render(false);
    });

    html.find(".sw1e-skill-bonus, .sw1e-force-bonus").on("change", () => this._refreshAllocationSummary(html));
    html.find("input[name='characterName'], input[name='system.identity.species'], input[name='system.identity.sex'], input[name='system.identity.age'], input[name='system.identity.height'], input[name='system.identity.weight'], textarea[name='system.identity.physicalDescription']")
      .on("change", () => this._captureFormState(html));
    html.find("input[name='importEquipment']").on("change", () => this._captureFormState(html));

    this._refreshAllocationSummary(html);
  }

  _captureFormState(html) {
    this.state.identity.characterName = html.find("input[name='characterName']").val()?.trim?.() ?? html.find("input[name='characterName']").val() ?? "";
    this.state.identity.species = html.find("input[name='system.identity.species']").val() ?? "";
    this.state.identity.sex = html.find("input[name='system.identity.sex']").val() ?? "";
    this.state.identity.age = html.find("input[name='system.identity.age']").val() ?? "";
    this.state.identity.height = html.find("input[name='system.identity.height']").val() ?? "";
    this.state.identity.weight = html.find("input[name='system.identity.weight']").val() ?? "";
    this.state.identity.physicalDescription = html.find("textarea[name='system.identity.physicalDescription']").val() ?? "";
    this.state.importEquipment = html.find("input[name='importEquipment']").is(":checked");

    this.state.skillBonuses = {};
    html.find(".sw1e-skill-bonus").each((_, element) => {
      this.state.skillBonuses[element.dataset.skillId] = parseBonusValue(element.value);
    });

    this.state.forceBonuses = {};
    html.find(".sw1e-force-bonus").each((_, element) => {
      this.state.forceBonuses[element.dataset.forceSkill] = parseBonusValue(element.value);
    });
  }

  _refreshAllocationSummary(html) {
    this._captureFormState(html);
    const remaining = TOTAL_STARTING_SKILL_DICE - this._getSpentDice();
    const remainingNode = html.find(".sw1e-builder-remaining");
    remainingNode.text(`${game.i18n.localize("SW1E.CharacterBuilder.SkillDiceRemaining")}: ${remaining}D / ${TOTAL_STARTING_SKILL_DICE}D`);
    remainingNode.toggleClass("invalid", remaining !== 0);

    html.find(".sw1e-skill-bonus").each((_, element) => {
      const row = element.closest("tr");
      if (!row) return;
      const baseDice = Number(row.dataset.baseDice) || 0;
      const basePips = Number(row.dataset.basePips) || 0;
      const finalCell = row.querySelector(".sw1e-skill-final");
      if (finalCell) finalCell.textContent = formatBuilderDice(baseDice, basePips, parseBonusValue(element.value));
    });

    html.find(".sw1e-force-bonus").each((_, element) => {
      const row = element.closest("tr");
      if (!row) return;
      const baseDice = Number(row.dataset.baseDice) || 0;
      const basePips = Number(row.dataset.basePips) || 0;
      const finalCell = row.querySelector(".sw1e-skill-final");
      if (finalCell) finalCell.textContent = formatBuilderDice(baseDice, basePips, parseBonusValue(element.value));
    });

    html.find("button[type='submit']").prop("disabled", remaining !== 0);
  }

  _getSpentDice() {
    const skillDice = Object.values(this.state.skillBonuses).reduce((sum, value) => sum + parseBonusValue(value), 0);
    const forceDice = Object.values(this.state.forceBonuses).reduce((sum, value) => sum + parseBonusValue(value), 0);
    return skillDice + forceDice;
  }

  _buildAttributeSummary(template) {
    if (!template) return [];
    return Object.entries(template.system.attributes ?? {}).map(([key, attribute]) => ({
      key,
      label: game.i18n.localize(SW1E.attributes[key] ?? attribute.label ?? key),
      code: formatDiceCode(attribute.dice, attribute.pips)
    }));
  }

  _buildForceSummary(template) {
    if (!template) return [];
    return SW1E.forceSkillKeys
      .map(key => {
        const skill = template.system.force?.[key] ?? {};
        const dice = Number(skill.dice) || 0;
        const pips = Number(skill.pips) || 0;
        if (!dice && !pips) return null;
        const bonus = parseBonusValue(this.state.forceBonuses[key]);
        return {
          key,
          label: game.i18n.localize(SW1E.forceSkills[key]),
          baseCode: formatDiceCode(dice, pips),
          baseDice: dice,
          basePips: pips,
          bonus,
          finalCode: formatBuilderDice(dice, pips, bonus)
        };
      })
      .filter(Boolean);
  }

  _buildSkillRows(template, skillDocs) {
    if (!template) return [];

    const grouped = [];
    for (const [attributeKey, attributeData] of Object.entries(template.system.attributes ?? {})) {
      const rows = skillDocs
        .filter(skill => skill.system.linkedAttribute === attributeKey)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(skill => {
          const bonus = parseBonusValue(this.state.skillBonuses[skill.id]);
          return {
            id: skill.id,
            name: skill.name,
            baseDice: Number(attributeData.dice) || 0,
            basePips: Number(attributeData.pips) || 0,
            baseCode: formatDiceCode(attributeData.dice, attributeData.pips),
            bonus,
            finalCode: formatBuilderDice(attributeData.dice, attributeData.pips, bonus)
          };
        });

      grouped.push({
        attributeKey,
        attributeLabel: game.i18n.localize(SW1E.attributes[attributeKey] ?? attributeData.label ?? attributeKey),
        rows
      });
    }

    return grouped;
  }

  async _updateObject(_event, formData) {
    const data = foundry.utils.expandObject(formData);
    const templateId = data.templateId || this.state.templateId;
    const actorName = String(data.characterName ?? "").trim();

    if (!actorName) {
      ui.notifications.warn(game.i18n.localize("SW1E.CharacterBuilder.ValidationName"));
      return;
    }

    const templates = await this._getTemplateDocs();
    const template = templates.find(entry => entry.id === templateId);
    if (!template) {
      ui.notifications.warn(game.i18n.localize("SW1E.CharacterBuilder.ValidationTemplate"));
      return;
    }

    const skillBonuses = Object.fromEntries(
      Object.entries(data.skillBonus ?? {}).map(([key, value]) => [key, parseBonusValue(value)])
    );
    const forceBonuses = Object.fromEntries(
      Object.entries(data.forceBonus ?? {}).map(([key, value]) => [key, parseBonusValue(value)])
    );

    const spent = Object.values(skillBonuses).reduce((sum, value) => sum + value, 0)
      + Object.values(forceBonuses).reduce((sum, value) => sum + value, 0);

    if (spent !== TOTAL_STARTING_SKILL_DICE) {
      ui.notifications.warn(game.i18n.localize("SW1E.CharacterBuilder.ValidationSpent"));
      return;
    }

    if ([...Object.values(skillBonuses), ...Object.values(forceBonuses)].some(value => value > MAX_STARTING_SKILL_BONUS)) {
      ui.notifications.warn(game.i18n.localize("SW1E.CharacterBuilder.ValidationMax"));
      return;
    }

    const identity = data.system?.identity ?? {};
    const startingData = getTemplateStartingData(template.name);

    const actorData = template.toObject();
    delete actorData._id;
    actorData.type = "character";
    actorData.name = actorName;
    actorData.items = [];
    actorData.system.identity.species = identity.species ?? "";
    actorData.system.identity.sex = identity.sex ?? "";
    actorData.system.identity.age = identity.age ?? "";
    actorData.system.identity.height = identity.height ?? "";
    actorData.system.identity.weight = identity.weight ?? "";
    actorData.system.identity.physicalDescription = identity.physicalDescription ?? "";
    actorData.system.identity.templateName = template.name;
    actorData.system.resources.credits = startingData?.credits ?? actorData.system.resources.credits ?? "";
    for (const key of SW1E.forceSkillKeys) {
      const current = actorData.system.force?.[key] ?? { dice: 0, pips: 0 };
      actorData.system.force[key].dice = (Number(current.dice) || 0) + parseBonusValue(forceBonuses[key]);
      actorData.system.force[key].pips = Number(current.pips) || 0;
    }
    actorData.system.notes.storyNotes = [
      `Character template source: p. ${startingData?.frontPage ?? "?"}.`,
      startingData?.backPage ? `Template starting gear and credits: p. ${startingData.backPage}.` : null
    ].filter(Boolean).join(" ");

    const actor = await Actor.create(actorData, { renderSheet: false });

    const items = [];
    items.push(...(await this._buildSkillItems(template, skillBonuses)));
    if (data.importEquipment) items.push(...(await this._buildEquipmentItems(template.name)));

    if (items.length) await actor.createEmbeddedDocuments("Item", items);

    actor.sheet.render(true);
    ui.notifications.info(game.i18n.format("SW1E.CharacterBuilder.Created", { name: actor.name }));
    this.close();
  }

  async _buildSkillItems(template, skillBonuses) {
    const skillDocs = await this._getSkillDocs();
    return skillDocs.map(skill => {
      const itemData = skill.toObject();
      delete itemData._id;
      const attribute = template.system.attributes?.[itemData.system.linkedAttribute] ?? { dice: 0, pips: 0 };
      const bonus = parseBonusValue(skillBonuses[skill.id]);
      itemData.system.dice = (Number(attribute.dice) || 0) + bonus;
      itemData.system.pips = Number(attribute.pips) || 0;
      return itemData;
    });
  }

  async _buildEquipmentItems(templateName) {
    const startingData = getTemplateStartingData(templateName);
    if (!startingData?.equipment?.length) return [];

    const items = [];
    for (const line of startingData.equipment) {
      const match = await this._getCompendiumItemForLine(line);
      if (match) {
        const itemData = match.toObject();
        delete itemData._id;
        itemData.system.sourcePage = String(startingData.backPage);
        if (/^2\s+medpacs/i.test(line)) itemData.system.quantity = 2;
        items.push(itemData);
        continue;
      }

      items.push({
        name: this._titleCaseGenericItem(line),
        type: "equipment",
        img: "systems/sw1e/icons/equipment.svg",
        system: {
          category: "gear",
          quantity: 1,
          equipped: false,
          armorDice: 0,
          armorPips: 0,
          weightText: "",
          notes: "Imported from the template equipment list.",
          sourcePage: String(startingData.backPage)
        }
      });
    }

    return items;
  }

  async _getCompendiumItemForLine(line) {
    const normalized = normalizeLine(line);
    for (const [needle, target] of EQUIPMENT_ALIASES.entries()) {
      if (!normalized.includes(needle)) continue;
      const cacheKey = `${target.pack}:${target.name}`;
      if (this._packCache.has(cacheKey)) return this._packCache.get(cacheKey);
      const docs = target.pack === "weapons" ? await this._getWeaponDocs() : await this._getEquipmentDocs();
      const doc = docs.find(entry => entry.name === target.name) ?? null;
      this._packCache.set(cacheKey, doc);
      return doc;
    }
    return null;
  }

  _titleCaseGenericItem(line) {
    const text = String(line ?? "").trim();
    if (!text) return "Template Gear";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  async _getTemplateDocs() {
    if (this._templates) return this._templates;
    const pack = game.packs.get("sw1e.charactertemplates");
    if (!pack) return [];
    const docs = await pack.getDocuments();
    this._templates = docs.filter(doc => doc.type === "character").sort((a, b) => a.name.localeCompare(b.name));
    return this._templates;
  }

  async _getSkillDocs() {
    if (this._skills) return this._skills;
    const pack = game.packs.get("sw1e.skills");
    if (!pack) return [];
    const docs = await pack.getDocuments();
    this._skills = docs.filter(doc => doc.type === "skill");
    return this._skills;
  }

  async _getWeaponDocs() {
    if (this._weapons) return this._weapons;
    const pack = game.packs.get("sw1e.weapons");
    if (!pack) return [];
    const docs = await pack.getDocuments();
    this._weapons = docs.filter(doc => doc.type === "weapon");
    return this._weapons;
  }

  async _getEquipmentDocs() {
    if (this._equipment) return this._equipment;
    const pack = game.packs.get("sw1e.equipment");
    if (!pack) return [];
    const docs = await pack.getDocuments();
    this._equipment = docs.filter(doc => doc.type === "equipment");
    return this._equipment;
  }
}
