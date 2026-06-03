// Pure text helpers for the workspace-names list (no GNOME/GTK dependency,
// unit-testable with a plain `node`). Shared between the extension
// (extension.js) and the external editor process (editor.js) so the
// "Sort hidden" logic stays a single source of truth.

/**
 * Converts editor text into a workspace-names array: split on newlines,
 * right-strip each line, then drop trailing empty entries (matching the
 * zenity rename-all-workspaces.sh semantics).
 * @param {string} text
 * @returns {string[]}
 */
export function parseEditorText(text) {
    const names = text.split('\n').map(l => l.replace(/\s+$/, ''));
    while (names.length && names[names.length - 1] === '') names.pop();
    return names;
}

/**
 * Derives the sort key for a hidden name: strips any leading non-alphanumeric
 * prefix (emoji, bullet, dash…) plus following whitespace. Falls back to the
 * raw name if the key would be empty.
 * @param {string} name
 * @returns {string}
 */
export function sortKey(name) {
    const stripped = name.replace(/^[^\p{L}\p{N}]+\s*/u, '');
    return stripped || name;
}

/**
 * Reorders ONLY the hidden block (lines after the first blank line)
 * alphabetically, ignoring decorative prefixes. The active block and the
 * blank-line separator are preserved verbatim. No-op when there is no blank
 * line (i.e. nothing is hidden).
 * @param {string} text
 * @returns {string}
 */
export function sortHiddenNames(text) {
    const lines = text.split('\n');

    const frontier = lines.findIndex(l => l.replace(/\s+$/, '') === '');
    if (frontier === -1) return text; // no separator → nothing hidden

    let j = frontier;
    while (j < lines.length && lines[j].replace(/\s+$/, '') === '') j++;

    const active = lines.slice(0, frontier);
    const separator = lines.slice(frontier, j);
    const hidden = lines.slice(j);

    hidden.sort((a, b) =>
        sortKey(a).localeCompare(sortKey(b), undefined, { sensitivity: 'base', numeric: true })
    );

    return [...active, ...separator, ...hidden].join('\n');
}

/**
 * Moves the active name at `index` into the hidden block (the entries after the
 * first blank ''), then re-sorts the hidden block alphabetically with the same
 * prefix-aware natural ordering as sortHiddenNames. Creates the blank-line
 * separator when none exists yet. Returns a new array. No-op (returns a copy
 * unchanged) when the index has no name or the name is empty.
 * @param {string[]} strv
 * @param {number} index
 * @returns {string[]}
 */
export function hideName(strv, index) {
    if (index < 0 || index >= strv.length || strv[index] === '')
        return [...strv];

    const name = strv[index];
    const next = strv.toSpliced(index, 1); // active zone shifts left

    const frontier = next.findIndex(s => s === '');
    let firstHidden = frontier === -1 ? next.length : frontier;
    while (firstHidden < next.length && next[firstHidden] === '') firstHidden++;

    // Everything up to the hidden block (actives + separator), with at least one
    // blank line so a separator exists even when nothing was hidden before.
    const head = frontier === -1 ? [...next, ''] : next.slice(0, firstHidden);
    const hidden = [...next.slice(firstHidden), name].toSorted((a, b) =>
        sortKey(a).localeCompare(sortKey(b), undefined, { sensitivity: 'base', numeric: true })
    );

    return [...head, ...hidden];
}

/**
 * Guarantees the hidden block starts beyond the next-workspace slot, so a hidden
 * name never leaks into the panel. Resizes the run of blank '' items between the
 * active zone and the hidden block so the first hidden name sits at index
 * workspaceCount + 1 (symmetric: pads when workspaces grow, trims the surplus
 * when they shrink, but always keeps at least one blank). No-op when there is no
 * hidden block. Returns a new array.
 * @param {string[]} strv
 * @param {number} workspaceCount
 * @returns {string[]}
 */
export function padSeparator(strv, workspaceCount) {
    const frontier = strv.findIndex(s => s === '');
    if (frontier === -1) return [...strv]; // no separator → nothing hidden

    let firstHidden = frontier;
    while (firstHidden < strv.length && strv[firstHidden] === '') firstHidden++;
    if (firstHidden >= strv.length) return [...strv]; // only trailing blanks → nothing hidden

    const active = strv.slice(0, frontier);
    const hidden = strv.slice(firstHidden);
    const blanks = Math.max(workspaceCount + 1 - active.length, 1);

    return [...active, ...Array(blanks).fill(''), ...hidden];
}
