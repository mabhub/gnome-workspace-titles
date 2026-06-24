// SPDX-FileCopyrightText: Mahdad Ghasemian and gnome-workspace-titles@mabhub contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Pure selection logic: which workspace indices a given display mode shows in
// the panel, in order. No GNOME/Shell dependency, so it is testable under a
// plain `node` import (run the snippets in the project README/CLAUDE notes).

/**
 * Returns the workspace indices (0-based) to display for a given mode.
 * @param {'default'|'scroll'|'overview'} mode
 * @param {number} activeIndex - Index of the active workspace
 * @param {number} nWorkspaces - Total number of workspaces
 * @returns {number[]} Indices to show, in display order
 */
export const visibleIndices = (mode, activeIndex, nWorkspaces) => {
  if (nWorkspaces <= 0) return [];

  if (mode === 'overview')
    return Array.from({ length: nWorkspaces }, (_, i) => i);

  if (mode === 'scroll')
    return [activeIndex - 1, activeIndex, activeIndex + 1]
      .filter(i => i >= 0 && i < nWorkspaces);

  // 'default' and any unknown mode: active only.
  return [activeIndex];
};
