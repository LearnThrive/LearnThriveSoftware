"use client";

import { useCallback, useMemo } from "react";
import { searchAppAction } from "@/lib/actions/search";
import type { Role } from "@/lib/auth/types";
import { buildAppCommands } from "@/lib/palette/appCommands";
import { groupLabelFor, type AppSearchResult } from "@/lib/search/appSearchTypes";
import { CommandPalette, type PaletteCommand } from "./CommandPalette";

/**
 * The signed-in app's palette: the shared CommandPalette with the role's own pages and actions as the static
 * commands, and the role-scoped server search for records. Loaded lazily by AppPaletteHost, never statically,
 * so none of this is in the app's first load.
 */
export default function AppPalette({
  open,
  onClose,
  shortcutLabel,
  role,
  onShowShortcuts,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  shortcutLabel: string;
  role: Role;
  onShowShortcuts: () => void;
  onSignOut: () => void;
}) {
  const commands = useMemo(
    () => buildAppCommands(role, { showShortcuts: onShowShortcuts, signOut: onSignOut }),
    [role, onShowShortcuts, onSignOut],
  );

  // Server results become ordinary palette rows: a title, a quiet second line, a route.
  const search = useCallback(async (query: string): Promise<PaletteCommand[]> => {
    const results: AppSearchResult[] = await searchAppAction(query);
    return results.map((result) => ({
      id: `${result.kind}:${result.id}`,
      title: result.title,
      group: groupLabelFor(result.kind),
      href: result.href,
      hint: result.subtitle,
    }));
  }, []);

  return (
    <CommandPalette
      open={open}
      onClose={onClose}
      commands={commands}
      search={search}
      storageKey="lt-palette-app"
      label="Search LearnThrive"
      placeholder="Search lessons, people and reports, or jump to a page…"
      shortcutLabel={shortcutLabel}
    />
  );
}
