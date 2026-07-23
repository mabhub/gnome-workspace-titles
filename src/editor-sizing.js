// SPDX-FileCopyrightText: gnome-workspace-titles@mabhub contributors
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Pure sizing arithmetic for the editor window, with no GTK dependency, so it
// can be exercised with plain `node` like workspace-names.js and
// visible-indices.js:
//
//   node -e "import('./src/editor-sizing.js').then(m => console.log(m.clampEditorHeight(27, 18, 1080)))"

export const EDITOR_WIDTH = 460;
export const MIN_EDITOR_HEIGHT = 180;
export const MAX_EDITOR_HEIGHT_RATIO = 0.8;
// Header bar (~46px on Adwaita) plus the TextView's 8px top/bottom margins,
// rounded up. A theme with a taller header bar makes this a slight undershoot.
export const EDITOR_CHROME_HEIGHT = 64;
// One blank line past the last one, so the end of the list reads as the end
// rather than as content continuing below the window edge.
export const EDITOR_SLACK_LINES = 1;

/**
 * Height the multiline editor should open at, from a line count and the
 * measurements its caller collected. Grows with the list, then clamps: never
 * below MIN_EDITOR_HEIGHT, never above MAX_EDITOR_HEIGHT_RATIO of the monitor.
 * The floor wins over the ceiling on absurdly short displays (a small nested
 * shell), where the two bounds would otherwise cross.
 * @param {number} lineCount - Lines the editor starts with
 * @param {number} lineHeight - Rendered height of one line, in pixels
 * @param {number} monitorHeight - Monitor height in pixels; 0 means unknown
 * @returns {number} Height in pixels
 */
export const clampEditorHeight = (lineCount, lineHeight, monitorHeight) => {
  const ceiling = monitorHeight > 0
    ? Math.round(monitorHeight * MAX_EDITOR_HEIGHT_RATIO)
    : Infinity;
  const rows = lineCount + EDITOR_SLACK_LINES;
  const wanted = rows * lineHeight + EDITOR_CHROME_HEIGHT;
  return Math.min(Math.max(wanted, MIN_EDITOR_HEIGHT), Math.max(ceiling, MIN_EDITOR_HEIGHT));
};
