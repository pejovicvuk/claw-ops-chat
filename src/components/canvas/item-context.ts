"use client";

import { createContext } from "react";

export interface ItemContextValue {
  projectSlug: string;
  itemSlug: string;
  /** Server-resolved absolute path (e.g. `/root/projects/x/y`). */
  absolutePath: string;
  /** Display name for headers / titles. */
  displayName: string;
}

/**
 * Provides the active item to every window inside the canvas without
 * threading a prop through `WindowHost`. Windows that need the item's
 * absolute path (e.g. `ChatWindow` for `defaultCwd`) read it via
 * `useContext(ItemContext)`. Other window kinds can ignore it.
 *
 * The value is `null` only outside an `ItemCanvas` render OR while the
 * item meta is still loading — windows must tolerate that.
 */
export const ItemContext = createContext<ItemContextValue | null>(null);
