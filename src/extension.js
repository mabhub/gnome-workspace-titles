import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// Local import
import { InputDialog } from './dialog.js';

export default class GnomeWorkspaceTitlesExtension extends Extension {
    enable() {
        // Use proper extension settings (schema)
        this._settings = this.getSettings();

        // Create a panel button
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        // Create a horizontal box to hold icon + label
        const box = new St.BoxLayout({ style_class: 'workspace-indicator-box', vertical: false });

        // Label for workspace number
        this._workspaceLabel = new St.Label({
            text: '1',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'workspace-number-label'
        });
        box.add_child(this._workspaceLabel);

        // Add the box to the panel button
        this._indicator.add_child(box);

        // Add the indicator to the panel
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Update the label initially
        this._updateWorkspaceInitially();
        this._updateWorkspaceNumber();

        // Connect signal to update on workspace change
        this._workspaceSignal = global.workspace_manager.connect(
            'active-workspace-changed',
            () => this._updateWorkspaceNumber()
        );

        // update when settings change
        this._settings.connect('changed', () => this._updateWorkspaceNumber());

        // Make the indicator clickable
        this._indicator.connect('button-press-event', () => this._openRenamePopup());

        console.debug("[GnomeWorkspaceTitlesExtension] Enabled");
    }

    disable() {
        // Clean up
        if (this._workspaceSignal) {
            global.workspace_manager.disconnect(this._workspaceSignal);
            this._workspaceSignal = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._settings = null;
    }

    // ───────────────────────────────────────────────
    // Helper methods
    // ───────────────────────────────────────────────

    _shouldUseCustomNames() {
        return this._settings.get_boolean('enable-custom-names');
    }

    _getWorkspaceNames() {
        return this._settings.get_strv('workspace-names');
    }

    // Set the name for a specific workspace
    _setWorkspaceName(index, newName) {
        const names = this._getWorkspaceNames();

        // Ensure array is large enough
        while (names.length <= index) {
            names.push('');
        }

        names[index] = newName;
        this._settings.set_strv('workspace-names', names);
    }

    _updateWorkspaceInitially() {
        const shouldUseCustomNames = this._shouldUseCustomNames();
        const activeIndex = global.workspace_manager.get_active_workspace_index();

        if (shouldUseCustomNames) {
            this._updateWorkspaceNumber();
            return;
        }

        // Reset all names to default when feature is disabled on startup
        const nWorkspaces = global.workspace_manager.n_workspaces;
        const defaultNames = Array.from({ length: nWorkspaces }, (_, i) => `Workspace ${i + 1}`);

        this._settings.set_strv('workspace-names', defaultNames);

        this._workspaceLabel.set_text(`Workspace ${activeIndex + 1}`);
    }

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

    // Open a popup dialog to rename the current workspace
    async _openRenamePopup() {
        const activeIndex = global.workspace_manager.get_active_workspace_index();
        const names = this._getWorkspaceNames();

        const currentName = this._shouldUseCustomNames()
            ? (names[activeIndex]?.trim() || `Workspace ${activeIndex + 1}`)
            : `Workspace ${activeIndex + 1}`;

        const dialog = new InputDialog(
            'Rename workspace:',
            currentName,
            'Use custom names after restart',
            this._shouldUseCustomNames()
        );

        const result = await dialog.open();

        if (result !== null) {
            this._settings.set_boolean('enable-custom-names', result.checked);

            const newName = result.text.trim();

            if (newName) {
                // Set the new name
                this._setWorkspaceName(activeIndex, newName);
            } else {
                // Clear the name for current workspace
                const currentNames = this._getWorkspaceNames();
                if (currentNames[activeIndex]) {
                    currentNames[activeIndex] = '';
                    this._settings.set_strv('workspace-names', currentNames);
                }
            }
        }
    }
}