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
