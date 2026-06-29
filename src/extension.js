// SPDX-FileCopyrightText: Mahdad Ghasemian and gnome-workspace-titles@mabhub contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Local imports
import { InputDialog } from './dialog.js';
import { hideName, padSeparator, setNameAt } from './workspace-names.js';
import { WorkspaceBar } from './workspace-bar.js';

const WorkspaceIndicatorButton = GObject.registerClass(
class WorkspaceIndicatorButton extends PanelMenu.Button {
  /**
   * @param {GnomeWorkspaceTitlesExtension} extension - Parent extension instance
   */
  _init(extension) {
    super._init(0.0, extension.metadata.name, false);
    this._ext = extension;
    this.add_style_class_name('workspace-titles-button');
  }

  /**
   * Dispatches pointer button events: right click rebuilds and toggles the
   * context menu (the only way to reach the editor). Left clicks are handled by
   * the name labels themselves (switch workspace); a left click on empty space
   * does nothing. Other events are forwarded to the parent implementation.
   * @param {Clutter.Event} event
   * @returns {boolean} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
   */
  vfunc_event(event) {
    if (event.type() === Clutter.EventType.BUTTON_PRESS
      && event.get_button() === Clutter.BUTTON_SECONDARY) {
      this._ext._rebuildContextMenu();
      this.menu.toggle();
      return Clutter.EVENT_STOP;
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

    // Names bar: pill + clickable labels, driven by the display mode. Set the
    // overview width before the mode so the first scroll-cap pass already has
    // the real width (setMode applies the cap).
    this._bar = new WorkspaceBar();
    this._bar.setOverviewMaxWidth(this._settings.get_int('overview-max-width'));
    this._bar.setMode(this._settings.get_string('display-mode'));
    this._bar.connect('workspace-clicked', (_b, index) => this._onWorkspaceClicked(index));
    this._indicator.add_child(this._bar);

    // Add the indicator to the panel
    const panelBox = this._settings.get_string('panel-box');
    const panelPosition = this._settings.get_int('panel-position');
    Main.panel.addToStatusArea(this.uuid, this._indicator, panelPosition, panelBox);

    // Render the bar initially
    this._refresh();

    // Connect signal to update on workspace change
    this._workspaceSignal = global.workspace_manager.connect(
      'active-workspace-changed',
      () => this._refresh()
    );

    // Keep the hidden block from leaking into the panel as workspaces come
    // and go (dynamic workspaces). notify::n-workspaces covers add + remove.
    this._nWorkspacesSignal = global.workspace_manager.connect(
      'notify::n-workspaces',
      () => { this._enforceSeparatorMargin(); this._refresh(); }
    );

    // Enforce once at startup in case the count changed while disabled.
    this._enforceSeparatorMargin();

    // update when WM workspace-names change (e.g. from rename script)
    this._wmSettingsSignal = this._wmSettings.connect('changed::workspace-names', () => this._refresh());

    // Register the editor keybindings and react to their on/off toggles.
    this._enabledSignals = [];
    for (const { key, run } of this._shortcutDefs()) {
      this._bindShortcut(key, run);
      this._enabledSignals.push(this._settings.connect(
        `changed::${key}-enabled`,
        () => this._bindShortcut(key, run)
      ));
    }

    // Apply display-mode changes live (menu radio writes the key).
    this._displayModeSignal = this._settings.connect('changed::display-mode', () => {
      this._bar.setMode(this._settings.get_string('display-mode'));
      this._refresh();
    });

    // Apply overview-max-width changes live too (only reachable via gsettings).
    this._overviewWidthSignal = this._settings.connect('changed::overview-max-width', () => {
      this._bar.setOverviewMaxWidth(this._settings.get_int('overview-max-width'));
      this._refresh();
    });

    console.debug("[GnomeWorkspaceTitlesExtension] Enabled");
  }

  disable() {
    // Clean up
    for (const { key } of this._shortcutDefs())
      Main.wm.removeKeybinding(key);
    if (this._enabledSignals) {
      for (const id of this._enabledSignals)
        this._settings.disconnect(id);
      this._enabledSignals = null;
    }

    if (this._displayModeSignal) {
      this._settings.disconnect(this._displayModeSignal);
      this._displayModeSignal = null;
    }

    if (this._overviewWidthSignal) {
      this._settings.disconnect(this._overviewWidthSignal);
      this._overviewWidthSignal = null;
    }

    if (this._workspaceSignal) {
      global.workspace_manager.disconnect(this._workspaceSignal);
      this._workspaceSignal = null;
    }

    if (this._nWorkspacesSignal) {
      global.workspace_manager.disconnect(this._nWorkspacesSignal);
      this._nWorkspacesSignal = null;
    }

    if (this._indicator) {
      this._bar?.stopAnimations(); // halt in-flight transitions before teardown
      this._bar = null; // destroyed as a child of the indicator below
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
   * Pushes the current state (names + active index + workspace count) to the
   * names bar, which recomposes its labels and pill.
   */
  _refresh() {
    if (!this._bar) return;
    const activeIndex = global.workspace_manager.get_active_workspace_index();
    const nWorkspaces = global.workspace_manager.get_n_workspaces();
    const names = this._getWorkspaceNames();
    this._bar.render(names, activeIndex, nWorkspaces);
  }

  /**
   * Builds the "Display mode" radio submenu reflecting the current
   * display-mode setting. Selecting an entry writes the key; the
   * changed::display-mode handler then applies it live.
   * @returns {PopupMenu.PopupSubMenuMenuItem}
   */
  _buildModeSubmenu() {
    const current = this._settings.get_string('display-mode');
    const submenu = new PopupMenu.PopupSubMenuMenuItem('Display mode');
    const modes = [
      { id: 'default', label: 'Default' },
      { id: 'scroll', label: 'Scroll' },
      { id: 'overview', label: 'Overview' },
    ];
    for (const { id, label } of modes) {
      const item = new PopupMenu.PopupMenuItem(label);
      item.setOrnament(id === current
        ? PopupMenu.Ornament.DOT
        : PopupMenu.Ornament.NONE);
      item.connect('activate', () => this._settings.set_string('display-mode', id));
      submenu.menu.addMenuItem(item);
    }
    return submenu;
  }

  /**
   * Clears and repopulates the context menu with current-state actions:
   * display mode, rename, reset, hide, edit all.
   */
  _rebuildContextMenu() {
    this._indicator.menu.removeAll();

    this._indicator.menu.addMenuItem(this._buildModeSubmenu());
    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

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

    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const renameSwitch = new PopupMenu.PopupSwitchMenuItem(
      'Super+F2: rename current',
      this._settings.get_boolean('rename-shortcut-enabled')
    );
    renameSwitch.connect('toggled', (_i, state) =>
      this._settings.set_boolean('rename-shortcut-enabled', state)
    );
    this._indicator.menu.addMenuItem(renameSwitch);

    const editAllSwitch = new PopupMenu.PopupSwitchMenuItem(
      'Super+F3: edit all',
      this._settings.get_boolean('edit-all-shortcut-enabled')
    );
    editAllSwitch.connect('toggled', (_i, state) =>
      this._settings.set_boolean('edit-all-shortcut-enabled', state)
    );
    this._indicator.menu.addMenuItem(editAllSwitch);

    const hideSwitch = new PopupMenu.PopupSwitchMenuItem(
      'Super+F4: hide current',
      this._settings.get_boolean('hide-shortcut-enabled')
    );
    hideSwitch.connect('toggled', (_i, state) =>
      this._settings.set_boolean('hide-shortcut-enabled', state)
    );
    this._indicator.menu.addMenuItem(hideSwitch);
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
    if (result === null) return;

    // Re-read after the (awaited) dialog: workspace-names may have changed
    // while it was open. setNameAt trims the name, pads up to the index and
    // drops trailing empties — a non-empty name is written, an empty one
    // clears it.
    const current = this._getWorkspaceNames();
    const next = setNameAt(current, activeIndex, result.text);
    this._setNamesIfChanged(current, next);
  }

  /**
   * Launches the standalone single-instance editor (editor.js), optionally
   * with extra arguments (e.g. ['--rename', '2']). Fire-and-forget: a second
   * launch raises or re-renders the existing window (GTK handles unicity).
   * @param {string[]} [extraArgv=[]]
   */
  _launchEditor(extraArgv = []) {
    const gjs = GLib.find_program_in_path('gjs');
    if (!gjs) {
      logError(new Error('gjs not found in PATH'), 'Cannot launch the workspace-names editor');
      return;
    }

    const editorPath = GLib.build_filenamev([this.path, 'editor.js']);

    try {
      const proc = new Gio.Subprocess({
        argv: [gjs, '-m', editorPath, ...extraArgv],
        flags: Gio.SubprocessFlags.NONE,
      });
      proc.init(null);
    } catch (e) {
      logError(e, 'Failed to launch the workspace-names editor');
    }
  }

  /**
   * Opens the multiline editor for all workspace names.
   */
  _openEditAllPopup() {
    this._launchEditor();
  }

  /**
   * Opens the single-line rename view for the current workspace.
   */
  _openRenameCurrent() {
    const idx = global.workspace_manager.get_active_workspace_index();
    this._launchEditor(['--rename', String(idx)]);
  }

  /**
   * Routes a click on a workspace name: switch to that workspace. Clicking the
   * current workspace does nothing (the editor is reached via the context menu
   * or the Super+F3 shortcut, never via left click).
   * @param {number} index - The clicked workspace index
   */
  _onWorkspaceClicked(index) {
    const activeIndex = global.workspace_manager.get_active_workspace_index();
    if (index === activeIndex) return;
    this._activateWorkspace(index);
  }

  /**
   * Switches to the workspace at the given index.
   * @param {number} index
   */
  _activateWorkspace(index) {
    const wm = global.workspace_manager;
    if (index < 0 || index >= wm.get_n_workspaces()) return;
    wm.get_workspace_by_index(index).activate(global.get_current_time());
  }

  /**
   * Registers (or re-registers) a keybinding from a settings key, but only
   * when its companion `<key>-enabled` boolean is true. Always removes any
   * existing binding for that key first, so toggling can't leak a binding.
   * @param {string} key - The `as` settings key holding the accelerator
   * @param {() => void} handler
   */
  _bindShortcut(key, handler) {
    Main.wm.removeKeybinding(key); // idempotent: no-op if the key was never bound
    if (!this._settings.get_boolean(`${key}-enabled`)) return;
    Main.wm.addKeybinding(
      key,
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      handler
    );
  }

  /**
   * The editor keybindings: the settings key holding each accelerator and the
   * action it runs. Single source of truth for registering, toggling and
   * removing them.
   * @returns {{key: string, run: () => void}[]}
   */
  _shortcutDefs() {
    return [
      { key: 'rename-shortcut', run: () => this._openRenameCurrent() },
      { key: 'edit-all-shortcut', run: () => this._openEditAllPopup() },
      { key: 'hide-shortcut', run: () => this._hideWorkspaceName() },
    ];
  }
}
