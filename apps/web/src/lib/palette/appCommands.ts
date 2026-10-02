import type { PaletteCommand } from "@/components/palette/CommandPalette";
import type { Role } from "@/lib/auth/types";
import { navigationFor } from "@/lib/navigation/appNavigation";
import { quickCreateFor } from "@/lib/navigation/quickCreate";
import { goToTargetsFor } from "@/lib/palette/appShortcuts";
import { setTheme } from "@/lib/theme";

/**
 * The signed-in app's static command set (plan15 Wave 11 section 15.2), built for ONE role: pages come from
 * that role's own navigation (lib/navigation/appNavigation.ts), "create" from what the quick-create menu
 * offers that role (lib/navigation/quickCreate.ts), so an Admin-only page or action cannot appear for
 * anyone else. Records (people, lessons, reports) are not here: they come from the role-scoped search
 * (lib/search/appSearch.ts) as the person types, never as a dataset shipped to the browser.
 *
 * Nothing in this list is destructive. Signing out is the one action with an effect, it is a deliberate
 * menu item the account menu already has, and it needs the person to choose it by name.
 */
export interface AppCommandActions {
  showShortcuts: () => void;
  signOut: () => void;
}

export function buildAppCommands(role: Role, actions: AppCommandActions): PaletteCommand[] {
  const commands: PaletteCommand[] = [];
  const shortcutByHref = new Map(goToTargetsFor(role).map((t) => [t.href, `G ${t.key.toUpperCase()}`]));

  for (const section of navigationFor(role)) {
    for (const item of section.items) {
      commands.push({
        id: `nav:${item.href}`,
        title: item.label,
        group: "Go to",
        href: item.href,
        hint: shortcutByHref.get(item.href),
        keywords: section.title ? [section.title.toLowerCase()] : [],
      });
    }
  }

  for (const item of quickCreateFor(role)) {
    commands.push({
      id: `create:${item.href}`,
      title: `Create ${item.label.toLowerCase()}`,
      group: "Create",
      href: item.href,
      keywords: ["new", "add", item.label.toLowerCase()],
    });
  }

  commands.push(
    { id: "theme:system", title: "Use the system appearance", group: "Appearance", run: () => setTheme("system"), keywords: ["theme", "dark", "light", "auto"] },
    { id: "theme:light", title: "Switch to the light theme", group: "Appearance", run: () => setTheme("light"), keywords: ["theme", "day", "bright"] },
    { id: "theme:dark", title: "Switch to the dark theme", group: "Appearance", run: () => setTheme("dark"), keywords: ["theme", "night"] },
    { id: "help:shortcuts", title: "Keyboard shortcuts", group: "Help", run: actions.showShortcuts, hint: "?", keywords: ["keys", "hotkeys", "help"] },
    { id: "account:sign-out", title: "Sign out", group: "Account", run: actions.signOut, keywords: ["log out", "logout", "exit"] },
  );

  return commands;
}
