import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Local imports
import { InputDialog } from './dialog.js';
import { hideName, padSeparator } from './workspace-names.js';

const WorkspaceIndicatorButton = GObject.registerClass(
class WorkspaceIndicatorButton extends PanelMenu.Button {
    /**
     * @param {GnomeWorkspaceTitlesExtension} extension - Parent extension instance
     */
    _init(extension) {
        super._init(0.0, extension.metadata.name, false);
        this._ext = extension;
    }

    /**
     * Dispatches pointer button events: left click opens the multiline editor
     * for all workspace names, right click rebuilds and toggles the context menu.
     * Middle click and other events are forwarded to the parent implementation.
     * @param {Clutter.Event} event
     * @returns {boolean} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
     */
    vfunc_event(event) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                this._ext._openEditAllPopup();
                return Clutter.EVENT_STOP;
            }
            if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                this._ext._rebuildContextMenu();
                this.menu.toggle();
                return Clutter.EVENT_STOP;
            }
        }
        return super.vfunc_event(event);
    }
});

export default class GnomeWorkspaceTitlesExtension extends Extension {
    enable() {
        // Use proper extension settings (schema)
        this._settings = this.getSettings();

        // Access standard WM workspace-names setting
        this._wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });

        // Create a panel button
        this._indicator = new WorkspaceIndicatorButton(this);

        // Create a horizontal box to hold icon + label
        const box = new St.BoxLayout({ style_class: 'workspace-indicator-box', vertical: false });

        // Label for workspace number
        this._workspaceLabel = new St.Label({
            text: '1',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'workspace-number-label',
        });
        box.add_child(this._workspaceLabel);

        // Add the box to the panel button
        this._indicator.add_child(box);

        // Add the indicator to the panel
        const panelBox = this._settings.get_string('panel-box');
        const panelPosition = this._settings.get_int('panel-position');
        Main.panel.addToStatusArea(this.uuid, this._indicator, panelPosition, panelBox);

        // Update the label initially
        this._updateWorkspaceNumber();

        // Connect signal to update on workspace change
        this._workspaceSignal = global.workspace_manager.connect(
            'active-workspace-changed',
            () => this._updateWorkspaceNumber()
        );

        // Keep the hidden block from leaking into the panel as workspaces come
        // and go (dynamic workspaces). notify::n-workspaces covers add + remove.
        this._nWorkspacesSignal = global.workspace_manager.connect(
            'notify::n-workspaces',
            () => this._enforceSeparatorMargin()
        );

        // Enforce once at startup in case the count changed while disabled.
        this._enforceSeparatorMargin();

        // update when extension settings change
        this._settings.connect('changed', () => this._updateWorkspaceNumber());

        // update when WM workspace-names change (e.g. from rename script)
        this._wmSettingsSignal = this._wmSettings.connect('changed::workspace-names', () => this._updateWorkspaceNumber());

        console.debug("[GnomeWorkspaceTitlesExtension] Enabled");
    }

    disable() {
        // Clean up
        if (this._workspaceSignal) {
            global.workspace_manager.disconnect(this._workspaceSignal);
            this._workspaceSignal = null;
        }

        if (this._nWorkspacesSignal) {
            global.workspace_manager.disconnect(this._nWorkspacesSignal);
            this._nWorkspacesSignal = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._wmSettings) {
            if (this._wmSettingsSignal) {
                this._wmSettings.disconnect(this._wmSettingsSignal);
                this._wmSettingsSignal = null;
            }
            this._wmSettings = null;
        }

        this._settings = null;
    }

    // ───────────────────────────────────────────────
    // Helper methods
    // ───────────────────────────────────────────────

    /**
     * Returns the current workspace names array from WM settings.
     * @returns {string[]}
     */
    _getWorkspaceNames() {
        return this._wmSettings.get_strv('workspace-names');
    }

    /**
     * Sets the name for a specific workspace index, padding the array if needed.
     * @param {number} index - Zero-based workspace index
     * @param {string} newName
     */
    _setWorkspaceName(index, newName) {
        const names = this._getWorkspaceNames();

        // Ensure array is large enough
        while (names.length <= index) {
            names.push('');
        }

        names[index] = newName;
        this._wmSettings.set_strv('workspace-names', names);
    }

    /**
     * Returns a copy of the array with trailing empty strings removed.
     * @param {string[]} names
     * @returns {string[]}
     */
    _trimTrailingEmpty(names) {
        let i = names.length - 1;
        while (i >= 0 && names[i] === '') i--;
        return names.slice(0, i + 1);
    }

    /**
     * Updates the panel label to show the active workspace name,
     * or a fallback "Workspace N" if no name is set.
     */
    _updateWorkspaceNumber() {
        const activeIndex = global.workspace_manager.get_active_workspace_index();
        const names = this._getWorkspaceNames();

        let name = names[activeIndex]?.trim();
        if (name) {
            this._workspaceLabel.set_text(name);
            return;
        }

        this._workspaceLabel.set_text(`Workspace ${activeIndex + 1}`);
    }

    /**
     * Clears and repopulates the context menu with current-state actions:
     * rename, reset, hide, edit all.
     */
    _rebuildContextMenu() {
        this._indicator.menu.removeAll();

        const rename = new PopupMenu.PopupMenuItem('Rename workspace');
        rename.connect('activate', () => this._openRenamePopup());
        this._indicator.menu.addMenuItem(rename);

        const reset = new PopupMenu.PopupMenuItem('Reset workspace name');
        reset.connect('activate', () => this._resetWorkspaceName());
        this._indicator.menu.addMenuItem(reset);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const hide = new PopupMenu.PopupMenuItem('Hide current workspace name');
        hide.connect('activate', () => this._hideWorkspaceName());
        this._indicator.menu.addMenuItem(hide);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const editAll = new PopupMenu.PopupMenuItem('Edit all workspace names');
        editAll.connect('activate', () => this._openEditAllPopup());
        this._indicator.menu.addMenuItem(editAll);
    }

    /**
     * Sets the active workspace name to empty string and trims trailing empties.
     * No-op if the current index has no name entry.
     */
    _resetWorkspaceName() {
        const idx = global.workspace_manager.get_active_workspace_index();
        const names = this._getWorkspaceNames();
        if (idx >= names.length) return;
        names[idx] = '';
        this._wmSettings.set_strv('workspace-names', this._trimTrailingEmpty(names));
    }

    /**
     * Writes workspace-names only when `next` differs from `current`. Skipping
     * no-op writes avoids a redundant changed::workspace-names signal — and in
     * particular breaks the feedback loop with the notify::n-workspaces handler
     * (a second padSeparator pass produces an identical strv, so no rewrite).
     * @param {string[]} current - The names just read from settings
     * @param {string[]} next - The candidate names to persist
     */
    _setNamesIfChanged(current, next) {
        if (next.length !== current.length || next.some((n, i) => n !== current[i]))
            this._wmSettings.set_strv('workspace-names', next);
    }

    /**
     * Hides the active workspace name: moves it into the sorted hidden block
     * (see hideName) instead of deleting it, then re-pads the separator so the
     * hidden block stays past the next-workspace slot. No-op if the current
     * index has no name.
     */
    _hideWorkspaceName() {
        const idx = global.workspace_manager.get_active_workspace_index();
        const names = this._getWorkspaceNames();
        const hidden = hideName(names, idx);
        const padded = padSeparator(hidden, global.workspace_manager.get_n_workspaces());
        this._setNamesIfChanged(names, padded);
    }

    /**
     * Keeps the hidden block past the next-workspace slot as workspaces are
     * created/removed (see padSeparator).
     */
    _enforceSeparatorMargin() {
        if (!this._wmSettings) return;
        const names = this._getWorkspaceNames();
        const padded = padSeparator(names, global.workspace_manager.get_n_workspaces());
        this._setNamesIfChanged(names, padded);
    }

    /**
     * Opens the rename dialog pre-filled with the current workspace name.
     * On confirm, saves the new name (or clears it if the input is empty).
     * @returns {Promise<void>}
     */
    async _openRenamePopup() {
        const activeIndex = global.workspace_manager.get_active_workspace_index();
        const names = this._getWorkspaceNames();

        const currentName = names[activeIndex]?.trim() || `Workspace ${activeIndex + 1}`;

        const dialog = new InputDialog('Rename workspace:', currentName);

        const result = await dialog.open();

        if (result !== null) {
            const newName = result.text.trim();

            if (newName) {
                // Set the new name
                this._setWorkspaceName(activeIndex, newName);
            } else {
                // Clear the name for current workspace
                const currentNames = this._getWorkspaceNames();
                if (currentNames[activeIndex]) {
                    currentNames[activeIndex] = '';
                    this._wmSettings.set_strv('workspace-names', currentNames);
                }
            }
        }
    }

    /**
     * Launches the standalone editor (editor.js) for the full workspace-names
     * list. The editor is a single-instance GTK app that reads and writes the
     * names itself, so this is fire-and-forget: launching it again while its
     * window is open just raises that window (GTK handles instance unicity).
     */
    _openEditAllPopup() {
        const gjs = GLib.find_program_in_path('gjs');
        if (!gjs) {
            logError(new Error('gjs not found in PATH'), 'Cannot launch the workspace-names editor');
            return;
        }

        const editorPath = GLib.build_filenamev([this.path, 'editor.js']);

        try {
            const proc = new Gio.Subprocess({
                argv: [gjs, '-m', editorPath],
                flags: Gio.SubprocessFlags.NONE,
            });
            proc.init(null);
        } catch (e) {
            logError(e, 'Failed to launch the workspace-names editor');
        }
    }
}
