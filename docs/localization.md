# Localization

## Rule

No player-facing string is ever written inline in engine or content code.
Everything — UI chrome ("Inventory") and game content (room text, dialogue,
item descriptions) — is a **key**, resolved to display text at render time
by `src/i18n/resolver.ts`.

## Content text vs. chrome text

Each language's actual text comes from two SOURCES, merged into one table
by `resolver.ts`:

- **`src/i18n/<code>.ts`** — UI chrome and engine-emitted event text
  (`ui.*`, `event.*`, `preference.*`, `mode.*`, `calendar.*`, `verb.*`).
  Hand-written TypeScript, changes alongside engine/view code, and gets
  the compiler's own typo/shape checking for free.
- **Inline `text:` blocks in content files** (`content/city/locations/*.yaml`,
  `content/city/objects/*.yaml`, and `content/city/world.yaml`'s
  `npcs`/`transitLines`/`passes`) — every `location.*`/`item.*`/
  `setpiece.*`/`npc.*`/`line.*`/`pass.*` key's text lives right next to
  the entity it describes, not in a separate file — see
  `docs/content-schema.md`'s "Inline localized text". `cityLoader.ts`
  derives the key from the entity's own `id` and emits every language's
  text as `CityContent.derivedLocale`; `content/world.ts` pushes that
  into the resolver at module load via `registerContentLocale` — see that
  function's doc comment in `resolver.ts`. There is no longer a separate
  `i18n/content/<lang>.yaml` file to keep in sync by hand — the content
  file itself IS the source of truth for its own text, in every language
  it has one for.

`resolver.ts`'s `TABLES[code]` is the merge of both sources for that
language — callers never need to know or care which one a given key
actually came from. A test or tool that needs to check "does this key
actually resolve" (as opposed to `t()`'s player-facing "fall back to the
raw key" behavior) should use `resolver.ts`'s `rawLookup(key, language?)`,
not read either source directly.

## Key naming convention

Keys are DERIVED, never hand-typed — see `docs/content-schema.md`'s
derived-key table. The convention itself is unchanged:

- `ui.*` — chrome text not tied to game content (prompt, help, error
  messages for unrecognized input)
- `event.*` — text describing the outcome of an engine action (moved,
  blocked, item taken, etc.)
- `location.<id>.name` / `location.<id>.description`
- `item.<id>.name` / `item.<id>.description` (`kind: "item"`) or
  `setpiece.<id>.name` / `.description` (`kind: "setpiece"`)
- `<kind>.<objectId>.<partId>.name` / `.description` — a `Part`; further
  nested per `PartState` as `<kind>.<objectId>.<partId>.<stateId>.name`/
  `.description`/`.summary` — see `docs/systems/parts.md`
- `npc.<id>.name` / `.description` / `.dialogue`
- `line.<id>.name` (TransitLine) / `pass.<id>.name` (Pass)

## Baseline language and translation coverage

`en` is the BASELINE language: every entity's `text.en` block is required
(`cityLoader.ts` validates this at every app startup — a key is only ever
derived FROM required text, never a hopeful reference to something that
might not exist). Any OTHER language is entirely OPTIONAL, per entity —
nothing stops you from translating half a city.

Runtime behavior for a language gap is a silent, visible fallback: `t()`
already falls back to the raw key string if nothing resolves (see
`resolver.ts`) — a half-translated language degrades gracefully, it never
crashes.

The DEVELOPMENT-time check is separate and on-demand:
`src/i18n/translationCoverage.test.ts` inspects whatever's actually
present in `CityContent.derivedLocale` — for every language OTHER than
`en` that appears there at all (i.e., the moment ANY entity authors even
one `text` block for it), it diffs that language's key set against `en`'s
and reports every missing key in one failure, matching `cityLoader.ts`'s
own "report everything, not just the first" style. A language nobody has
started translating yet is invisible to this check (nothing to diff
against) — the moment someone starts one, every gap becomes a loud test
failure (via `npm test`) rather than a silent fallback string a player
might actually see. Chrome text (`en.ts` vs. a future `<lang>.ts`) isn't
covered by this check yet — it needs an actual second `.ts` module to
diff against, which doesn't exist until a real second language does; add
it to the same test once it does.

## Adding a language

1. Create `src/i18n/<code>.ts` exporting `Record<string, string>` with the
   same chrome/event keys as `en.ts` (copy it as a starting point).
2. Register it in the `TABLES` map in `src/i18n/resolver.ts`, merged the
   same way the `en` entry already is.
3. Start adding `<code>: {...}` blocks to content files' `text:` maps,
   wherever and whenever you get to them — `src/i18n/translationCoverage.test.ts`
   will start reporting gaps for this language the moment the first block
   exists, so you don't have to translate everything before you can see
   what's left.
4. Call `setLanguage("<code>")` before rendering (currently no UI control
   for this exists — add one to `TerminalView` or a settings view when a
   second language is actually added).

## Placeholder substitution

Templates use `{paramName}`, e.g. `"You take the {itemKey}."`. A param
value may itself be a translation key (e.g. `itemKey: "item.caseFile.name"`)
— `t()` resolves those recursively, so engine code never has to
pre-resolve nested keys. A param may also be a `", "`-joined list of keys
(used for room item/NPC lists); each segment is resolved independently.

## Known limitation

No plural/gender grammar support yet — only flat placeholder substitution.
Fine for English; will need real work if a language with grammatical
gender or plural forms (French, German, Turkish plural agreement, etc.) is
targeted. Not built now because there's no concrete second-language target
yet — revisit this doc when there is.
