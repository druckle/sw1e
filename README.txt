SW1E Foundry System - Milestone 3

Install by extracting the sw1e folder into your Foundry Data/systems directory.

This build includes:
- milestone 1 foundation: actors, items, WEG dice-code roller, base sheets
- milestone 2 combat layer: weapon attack/damage workflow and wound support
- milestone 3 Force layer: Control/Sense/Alter tracking, Force power items, activation workflow, and kept-up power tracking

Notes:
- Requires Foundry VTT v13.
- Force support is intentionally manual-friendly. Proximity modifiers, relationship modifiers, Force Point spending, staged multi-round power activations, and target resistance rolls still need GM adjudication.
- The system folder must be named sw1e so it matches the manifest id.



Compendiums added in v0.4.0
- Core Skills
- Core Weapons
- Core Equipment
- Force Powers

Source basis:
- Skill Descriptions, pp. 31-44
- Force powers, pp. 71-80
- Weapon Chart, Armor Chart, and Cost Chart, pp. 139-141

Implementation notes:
- Force skills (Control, Sense, Alter) remain actor fields in this system and are not item compendium entries.
- Some melee weapons in the rulebook use Strength-based damage (for example STR+1D). Those entries preserve the exact rule text in Notes because the current weapon schema stores fixed damage dice only.
- Some chart entries (for example droids, vehicles, and passenger fares) were not added because the current system does not yet have matching document types.
- Human-readable compendium source JSON is stored in packs-src/. Foundry reads the bundled packs from packs/*.db.


Build 0.4.1: compendium item icons changed to Foundry core icons (icons/svg/*) to avoid missing custom system asset paths.


Build 0.6.5: added a Starships actor compendium with book-backed sample ships and embedded ship weapons from the Starship Data pages.

Build 0.6.7: added a GM Starship Reference journal compendium covering combat sequence, pursuit, shields/damage, multiship combat, and astrogation.
