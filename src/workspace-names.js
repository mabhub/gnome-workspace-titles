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
 * Comparator that orders hidden names by their sort key (decorative prefix
 * stripped), case-insensitively and with natural numeric ordering.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
const byHiddenOrder = (a, b) =>
    sortKey(a).localeCompare(sortKey(b), undefined, { sensitivity: 'base', numeric: true });

/**
 * Splits a list around the first blank entry into its active block, the
 * blank-line separator, and the hidden block. The blankness test is supplied by
 * the caller so this works both on editor text lines (which may carry trailing
 * whitespace) and on a clean strv. `frontier` is -1 (and hidden is empty) when
 * there is no separator, or when only trailing blanks remain (nothing hidden).
 * @param {string[]} items
 * @param {(item: string) => boolean} isBlank
 * @returns {{active: string[], separator: string[], hidden: string[], frontier: number}}
 */
const splitHidden = (items, isBlank) => {
    const frontier = items.findIndex(isBlank);
    if (frontier === -1)
        return { active: [...items], separator: [], hidden: [], frontier: -1 };

    let firstHidden = frontier;
    while (firstHidden < items.length && isBlank(items[firstHidden])) firstHidden++;

    return {
        active: items.slice(0, frontier),
        separator: items.slice(frontier, firstHidden),
        hidden: items.slice(firstHidden),
        frontier,
    };
};

const isBlankLine = line => line.replace(/\s+$/, '') === '';
const isBlankItem = item => item === '';

/**
 * Reorders ONLY the hidden block (lines after the first blank line)
 * alphabetically, ignoring decorative prefixes. The active block and the
 * blank-line separator are preserved verbatim. No-op when there is no blank
 * line (i.e. nothing is hidden).
 * @param {string} text
 * @returns {string}
 */
export function sortHiddenNames(text) {
    const { active, separator, hidden, frontier } = splitHidden(text.split('\n'), isBlankLine);
    if (frontier === -1) return text; // no separator → nothing hidden

    return [...active, ...separator, ...hidden.toSorted(byHiddenOrder)].join('\n');
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

    const { active, separator, hidden, frontier } = splitHidden(next, isBlankItem);

    // Keep a separator: reuse the existing blank run, or add one when nothing was
    // hidden before (frontier === -1, so active holds the whole list).
    const head = frontier === -1 ? [...active, ''] : [...active, ...separator];

    return [...head, ...[...hidden, name].toSorted(byHiddenOrder)];
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
    const { active, hidden, frontier } = splitHidden(strv, isBlankItem);
    if (frontier === -1 || hidden.length === 0) return [...strv]; // nothing hidden

    const blanks = Math.max(workspaceCount + 1 - active.length, 1);

    return [...active, ...Array(blanks).fill(''), ...hidden];
}
