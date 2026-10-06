/**
 * English translation table for UI chrome and engine-emitted event text —
 * the strings that change with engine/view code, not with city content.
 * World content text (location/item/NPC/transit-line/pass names and
 * descriptions) lives separately in `src/i18n/content/en.yaml`, loaded by
 * `contentLocale.ts` and merged into this table by `resolver.ts`, so it can
 * be authored as data (edited by hand or by the map editor) the same way
 * `content/city/world.yaml` is, without touching this hand-written source
 * file. See docs/localization.md for how to add a new language, and
 * docs/content-schema.md for the content/text split.
 */
export const en: Record<string, string> = {
  // UI chrome
  "ui.prompt": "> ",
  "ui.unknownCommand": "I don't understand \"{raw}\".",
  "ui.help":
    'Try: look, go <place or direction>, take <item>, talk to <npc>, examine <thing>, inventory, time, buy, notebook, jot down <text> (or "jot down last" to jot what you just read, or bare "jot down" to click a line in the log). Type "verbs" to toggle the full verb list.',
  "ui.verbsPanelTitle": "Known verbs",
  "ui.locationsPanelTitle": "Known locations",
  "ui.inventoryPanelTitle": "Inventory",
  "ui.factsPanelTitle": "Facts",
  "ui.worldMapTitle": "City map",
  "ui.worldMapShowAll": "Show entire map",
  "ui.worldMapShowDiscovered": "Show discovered only",
  "ui.worldMapClose": "Close",
  // A PATTERN, not a {placeholder} template — passed straight to
  // formatCalendarDate (see TerminalView.updateStatusBar), not through
  // t()'s substitution. Storing the pattern itself here (rather than a
  // fixed day/month/year ORDER hardcoded in the view) is what lets a
  // different language pick its own date ordering later.
  "ui.clockDisplay": "D MMMM YYYY · HH:mm",
  "ui.moneyDisplay": "{sign}${major}.{minor}",
  "ui.locationDisplay": "{locationKey}",
  "ui.cannotAfford": " — can't afford it (you have {balanceSign}${balanceMajor}.{balanceMinor})",
  "ui.preferredOption": " (preferred)",
  "ui.fastestOption": "(fastest) ",
  "ui.cheapestOption": "(cheapest) ",
  "ui.pickCustomDestination": "Pick a custom destination",
  "ui.goBackToDirectConnections": "Go back to direct connections",
  // Disambiguation menu (see docs/systems/parts.md's "Ambiguous targets") —
  // {itemKey} is the shared name every candidate has in common, {locationKey}
  // distinguishes them (a container's own nameKey, "ui.inventoryLabel", or
  // the current location's nameKey).
  "ui.disambiguationOption": "{itemKey} ({locationKey})",
  "ui.inventoryLabel": "carried",
  // Printed after every command's output while GameEngine.getFocusedItem()
  // is non-null — status chrome (like the money/clock/location status
  // bar), not an engine event, since it's a reminder about interaction
  // mode rather than something that happened. See docs/systems/parts.md.
  "ui.examiningReminder": "You are examining {itemKey}.",

  // Generalized buy menu (view/menu/buyMenu.ts) — see docs/systems/notebooks.md's "Economy integration" decision.
  "ui.buyNotebookOption": "{productKey} — {priceSign}${priceMajor}.{priceMinor}",
  "ui.buyPassOption": "{passKey} — {priceSign}${priceMajor}.{priceMinor}",

  // NPC topic menu (view/menu/npcMenus.ts) — see docs/systems/dialogue.md's "Topic menus" section.
  "ui.leaveConversationOption": "Leave it there",

  // Notebook menus (view/menu/notebookMenus.ts) and the page-view overlay (TerminalView) — see docs/systems/notebooks.md.
  "ui.unnamedNotebook": "(unnamed notebook)",
  "ui.notebookOption": "{name}",
  "ui.openNotebookOption": "Open it",
  "ui.renameNotebookOption": "Rename it",
  "ui.setActiveNotebookOption": "Make it your active notebook",
  "ui.clearActiveNotebookOption": "Stop using it as your active notebook",
  "ui.disposeNotebookOption": "Get rid of it",
  "ui.confirmDispose": "Yes, get rid of it",
  "ui.cancelDispose": "No, keep it",
  "ui.disposeActiveNotebookWarning": " It's currently your ACTIVE notebook.",
  "ui.notebookPrevPage": "‹ Prev",
  "ui.notebookNextPage": "Next ›",
  "ui.notebookNewNote": "+ New note",
  "ui.notebookNewNotePlaceholder": "Write something…",
  "ui.notebookEditNote": "Edit",
  "ui.notebookPageIndicator": "Page\n{page} / {pageCount}",
  "ui.notebookCharsMeter": "{used} / {capacity} used",
  "ui.notebookSaveNote": "Save note",
  "ui.notebookBlockHeader": "{day} · {time} · {locationKey}",

  // Engine events
  "event.playerMoved": "You head {direction}.",
  "event.moveBlocked": "You can't go {direction} from here.",
  "event.playerTraveled": "You travel to {locationKey}, arriving after {minutes} minutes.",
  "event.alreadyThere": "You're already at {locationKey}.",
  "event.routeNotFound": "There's no way to reach {locationKey} from here.",
  "event.locationNotFound": 'You don\'t know how to get to "{query}" from here.',
  "event.timeChecked": "It's {day} {monthKey} {year}, {hour}:{minute}.",
  "event.itemTaken": "You take the {itemKey}.",
  // Memory verbs — how a stored memory renders as testimony. See docs/systems/npcs.md.
  "memory.verb.took": "{subject} took {object}",
  "memory.verb.entered": "{subject} arrived",
  "memory.verb.left": "{subject} left",
  "memory.verb.spoke-to": "{subject} spoke to {object}",
  "memory.verb.gave": "{subject} gave {object} away",
  "memory.verb.attacked": "{subject} attacked {object}",
  "memory.verb.saw": "{subject} saw {object}",
  "memory.verb.learned": "{subject} learned about {object}",
  "event.itemNotFound": 'There\'s no "{query}" here.',
  "event.targetAmbiguous": "Which one do you mean?",
  "event.itemNotPortable": "You can't take the {itemKey}.",
  "event.locationVisibility": "{tierKey}",
  "visibility.tier.dark": "It's pitch dark here — you can barely make anything out.",
  "visibility.tier.dim": "The light here is dim.",
  "visibility.tier.normal": "The lighting here is unremarkable.",
  "visibility.tier.bright": "It's brightly lit here.",
  "event.setpiecesPresent": "You notice: {objects}.",
  "event.itemsPresent": "You see: {items}.",
  "event.npcsPresent": "Also here: {npcs}.",
  "event.inventoryListed": "You are carrying: {items}.",
  "event.inventoryEmpty": "You aren't carrying anything.",
  "event.npcNotFound": 'There\'s no "{query}" here to talk to.',
  "event.examineNotFound": 'You don\'t see a "{query}" here.',
  "event.partNotFocused": "You'd need to take a closer look first.",
  "event.partVerbNotApplicable": "You can't {verb} {partKey}.",
  "event.partAlreadyInState": "It's already {stateKey}.",
  "event.focusCleared": "You stop examining {itemKey}.",
  "event.nothingFocused": "You're not examining anything in particular.",
  "event.moneyAdded": "You gain {amountSign}${amountMajor}.{amountMinor}.",
  "event.moneySpent": "You spend {amountSign}${amountMajor}.{amountMinor}.",
  "event.insufficientFunds":
    "That costs {amountSign}${amountMajor}.{amountMinor}, but you only have {balanceSign}${balanceMajor}.{balanceMinor}.",
  "event.stealthModeOn": "You slip into stealth, moving carefully.",
  "event.stealthModeOff": "You drop out of stealth.",
  "event.concealmentUpdated": "{concealmentKey}",
  "concealment.tier.failedSpectacularly": "You're completely exposed — there's nowhere to hide here.",
  "concealment.tier.failedBadly": "You're badly exposed.",
  "concealment.tier.failed": "You're exposed.",
  "concealment.tier.succeeded": "You're reasonably concealed.",
  "concealment.tier.succeededWell": "You're well hidden.",
  "concealment.tier.succeededSpectacularly": "You're completely unseen — perfectly concealed.",
  "event.travelPreferenceSet": "You'll travel by the {preferenceKey} option from now on.",
  "event.travelPreferenceChecked": "You're currently traveling by the {preferenceKey} option.",
  "event.inquiryHeader": "Ways to reach {locationKey}:",
  "event.footRouteNotFullyWalkable":
    "Getting there entirely on foot isn't possible — showing the cheapest route that walks where it can.",
  "event.routeOptionByMode": "{modeKey}: {minutes} min, {costSign}${costMajor}.{costMinor}{afford}",
  // Used by GameEngine.categoryChoice — the natural foot/transit/taxi
  // options a named-destination inquiry offers. {fastestNote}/
  // {cheapestNote} are prefix badges (resolve to "" when not earned) so
  // "(fastest)"/"(cheapest)" appear at the START of the line, per
  // docs/systems/economy.md; {preferredNote} stays a trailing suffix.
  "event.routeOptionByCategory": "{fastestNote}{cheapestNote}{categoryKey}: {minutes} min, {costSign}${costMajor}.{costMinor}, {hops} hop(s) ({modesKey}){afford}{preferredNote}",
  // Kept for a future "navigator device" (see TravelStrategy in types.ts)
  // — not emitted by any code path today.
  "event.routeOptionByStrategy": "{strategyKey}: {minutes} min, {costSign}${costMajor}.{costMinor}, {hops} hop(s) ({modesKey}){afford}{preferredNote}",
  "event.directConnectionsHeader": "Here are the locations you can travel directly from here:",
  "event.directConnectionsIntro": "These use your preferred method ({preferenceKey}). Ask about a place by name to see other options.",
  "event.directConnectionOption": "{locationKey}: {minutes} min, {costSign}${costMajor}.{costMinor} ({modeKey}){afford}",
  "event.askDestinationPrompt": "Where do you want to inquire about?",
  "event.menuCancelled": "You decided not to go anywhere for now.",
  "event.menuInvalidChoice": 'That\'s not one of the options — pick a number, or type "back"/"exit".',
  "event.passNotFound": 'There\'s no pass called "{query}" for sale.',
  // Always shown as an expiry DATE (never a countdown/duration) — see
  // docs/systems/economy.md's pass system and GameEngine.buyPass.
  "event.passPurchased": "You buy the {passKey}. Expires: {day} {monthKey} {year}.",
  // Notebooks — see docs/systems/notebooks.md.
  "event.notebookProductNotFound": 'There\'s no notebook called "{query}" for sale.',
  "event.notebookPurchased": "You buy a {productKey}.",
  "event.notebookNotFound": 'No such notebook ("{query}").',
  "event.notebookRenamed": 'You label the notebook "{name}".',
  "event.activeNotebookSet": '"{name}" is now your active notebook.',
  "event.activeNotebookCleared": "You no longer have an active notebook — jotting something down will ask you which one to use.",
  "event.notebookDisposed": 'You get rid of "{name}".',
  "event.notebookFull": 'There\'s no room left in "{name}" for that.',
  "event.notebookPageFull": 'That edit would overflow the page in "{name}".',
  "event.noteJotted": 'You jot it down in "{name}".',
  "event.noteAmended": 'You amend the note in "{name}".',
  "event.noteBlockNotFound": "That note doesn't exist anymore.",
  "event.noteTooLong": 'That\'s too long to fit on a page in "{name}" (max {maxChars} characters) — jot down a shorter note.',
  "event.jotNothingToJot": "There's nothing recent to jot down yet.",
  "ui.jotDownPickPrompt": "Click a line above to jot it down. Type \"cancel\" to stop.",
  "ui.jotDownPickStillWaiting": "Click a line to jot it down, or type \"cancel\" to stop.",
  "ui.jotDownPickInvalidLine": "You can't jot that down — click a line of what's happened, not your own input or a menu.",
  "event.topicPrompt": "What do you want to ask about?",
  "event.noNotebooksOwned": "You don't have a notebook. You can buy one with \"buy notebook\".",
  "event.buyMenuHeader": "What would you like to buy?",
  "event.panelMenuHeader": "Which panel should be displayed on the {slot}?",
  "ui.panelOptionLocations": "Known locations",
  "ui.panelOptionVerbs": "Known verbs",
  "ui.panelOptionInventory": "Inventory",
  "ui.panelOptionFacts": "Facts",
  "ui.panelOptionNone": "None",
  "event.whichNotebookPrompt": "Which notebook?",
  "event.notebookActionsHeader": '"{name}" — what would you like to do?',
  "event.renameNotebookPrompt": "What would you like to call it?",
  "event.disposeNotebookConfirm": 'Really get rid of "{name}"?{activeNote}',
  "event.notebookOpened": 'You flip open "{name}".',
  "event.gameSaved": "Game saved.",
  "event.gameLoaded": "Game loaded.",
  "event.noSaveFound": "There's no saved game to load.",
  "event.saveIncompatible": "That save can't be loaded — it's from an incompatible version of the game.",

  // Case board — see docs/systems/case-board.md.
  "event.boardNodeAdded": "You pin that to the board.",
  "event.boardNodeRemoved": "You take that off the board.",
  "event.boardNoteEdited": "You update the note.",
  "event.boardConnectionAdded": "You tie a string between them.",
  "event.boardConnectionRemoved": "You cut that string.",
  "event.boardConnectionRecolored": "You swap the string's color.",
  "event.boardConnectionInvalid": "You can't connect that.",
  "ui.logModeAuto": "Auto",
  "ui.logModeExpanded": "Expanded",
  "ui.logModeCollapsed": "Collapsed",
  "ui.logToggleHint": "Click to change how the log covers the image",
  "ui.boardTitle": "Case board",
  "ui.boardClose": "Close",
  "ui.boardEmptyState": "Nothing pinned yet.",
  "ui.boardAddNode": "+ Add node",
  "ui.boardCategoryFacts": "Fact",
  "ui.boardCategoryPeople": "Person",
  "ui.boardCategoryPlaces": "Place",
  "ui.boardCategoryItems": "Item",
  "ui.boardCategoryNote": "Note",
  "ui.boardNoteTextPrompt": "Write a note...",
  "ui.boardNoAddableEntities": "Nothing to add here yet.",
  "ui.boardBack": "‹ Back",

  // Natural travel category names — resolved recursively through
  // {preferenceKey}/{categoryKey} params (see resolver.ts). These are the
  // player-facing default (see TravelCategory in types.ts).
  "preference.foot": "foot",
  "preference.transit": "public transport",
  "preference.taxi": "taxi",
  // Legacy mixed-mode strategy labels — kept for a future "navigator
  // device" (see TravelStrategy in types.ts); not used by any current UI.
  "preference.fastest": "fastest",
  "preference.cheapest": "cheapest",

  // Transport mode display names — resolved recursively through {modeKey} params.
  "mode.foot.name": "on foot",
  "mode.car.name": "by car",
  "mode.taxi.name": "by taxi",
  "mode.bus.name": "by bus",
  "mode.ship.name": "by ship",

  // Calendar names — consumed by formatCalendarDate (src/i18n/calendarFormat.ts)
  // for MMMM/MMM/dddd/ddd tokens, and (via the dynamically-built
  // monthKey/weekdayKey params — see calendarDisplayParams in
  // engine/time/calendar.ts) by GameEngine event text like
  // event.timeChecked/event.passPurchased. This IS the only date/time
  // format the game shows — see docs/systems/time.md for why an earlier
  // relative "Day N" format was dropped entirely.
  "calendar.month.1.long": "January",
  "calendar.month.1.short": "Jan",
  "calendar.month.2.long": "February",
  "calendar.month.2.short": "Feb",
  "calendar.month.3.long": "March",
  "calendar.month.3.short": "Mar",
  "calendar.month.4.long": "April",
  "calendar.month.4.short": "Apr",
  "calendar.month.5.long": "May",
  "calendar.month.5.short": "May",
  "calendar.month.6.long": "June",
  "calendar.month.6.short": "Jun",
  "calendar.month.7.long": "July",
  "calendar.month.7.short": "Jul",
  "calendar.month.8.long": "August",
  "calendar.month.8.short": "Aug",
  "calendar.month.9.long": "September",
  "calendar.month.9.short": "Sep",
  "calendar.month.10.long": "October",
  "calendar.month.10.short": "Oct",
  "calendar.month.11.long": "November",
  "calendar.month.11.short": "Nov",
  "calendar.month.12.long": "December",
  "calendar.month.12.short": "Dec",
  "calendar.weekday.0.long": "Sunday",
  "calendar.weekday.0.short": "Sun",
  "calendar.weekday.1.long": "Monday",
  "calendar.weekday.1.short": "Mon",
  "calendar.weekday.2.long": "Tuesday",
  "calendar.weekday.2.short": "Tue",
  "calendar.weekday.3.long": "Wednesday",
  "calendar.weekday.3.short": "Wed",
  "calendar.weekday.4.long": "Thursday",
  "calendar.weekday.4.short": "Thu",
  "calendar.weekday.5.long": "Friday",
  "calendar.weekday.5.short": "Fri",
  "calendar.weekday.6.long": "Saturday",
  "calendar.weekday.6.short": "Sat",

  // Verb catalog — debug/help display, sourced from EnglishCommandParser's VERB_RULES
  "verb.look.usage": "look (l)",
  "verb.inventory.usage": "inventory (i, inv)",
  "verb.help.usage": "help (?)",
  "verb.verbs.usage": "verbs (commands)",
  "verb.locations.usage": "locations (map)",
  "verb.worldmap.usage": "worldmap — visual city map, click a discovered location to travel there",
  "verb.panel.usage": "panel <left/right> [verbs/locations/inventory/facts/close] — choose what a side panel shows; leave off the content to pick from a menu",
  "verb.travel.usage": "go <place> (travel, n, s, e, w, up, down) — or bare \"travel\" for a menu of nearby destinations",
  "verb.take.usage": "take <item> (get, pick up)",
  "verb.buy.usage": "buy <pass or notebook> (purchase) — or bare \"buy\" for a menu of what's for sale",
  "verb.talk.usage": "talk to <npc> (ask, speak)",
  "verb.examine.usage": "examine <thing> (x, inspect)",
  "verb.interact.usage": "open/close <part> (shut) — needs a closer look first (examine it, or it's already in view)",
  "verb.unfocus.usage": "back (stop) — stop examining the currently focused thing",
  "verb.time.usage": "time (clock)",
  "verb.prefer.usage": "prefer <foot|transit|taxi> (preference)",
  "verb.sneak.usage": "sneak — toggle stealth mode",
  "verb.notebook.usage": "notebook (notebooks) — open your notebook(s)",
  "verb.board.usage": "board (corkboard) — open your case board",
  "verb.jotDown.usage":
    'jot down <text> (jotdown) — write a note in your active notebook; "jot down last" jots whatever was just printed; bare "jot down" lets you click a line in the log to jot it',
  "verb.save.usage": "save — saves your game",
  "verb.load.usage": "load — loads your last saved game",
  "verb.devMoney.usage": "devmoney <amount> — dev only, credits/debits the player directly",
  "verb.devLocations.usage": "devlocations — dev only, toggles the locations panel between discovered and all",
};
