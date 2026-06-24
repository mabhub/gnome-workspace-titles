#!/usr/bin/env -S gjs -m
// SPDX-FileCopyrightText: Mahdad Ghasemian and gnome-workspace-titles@mabhub contributors
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Standalone, single-instance editor for the workspace-names list. It reads and
// writes org.gnome.desktop.wm.preferences → workspace-names itself, and runs as
// a single-instance Gtk.Application: launching it again raises (and, if needed,
// re-renders) the existing window instead of spawning a second one.
//
// Two views, selected by the command line:
//   - no argument      → multiline editor for the whole list (Sort hidden)
//   - --rename <index> → single-line entry to rename that one workspace
//
// Entry points (all land on the same single window):
//   - the extension spawns `gjs -m editor.js [--rename N]` on click / shortcut
//
// Standalone test (acts on the real gsettings key):
//   gjs -m editor.js
//   gjs -m editor.js --rename 1

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import system from 'system';

import { parseEditorText, sortHiddenNames, setNameAt } from './workspace-names.js';

const wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });

const app = new Gtk.Application({
  application_id: 'io.github.mabhub.WorkspaceTitlesEditor',
  flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE,
});

// The single live window plus a tag describing what it currently shows, so a
// later invocation can tell whether to reuse it or rebuild it for another view.
let win = null;
let currentView = null; // e.g. 'multiline' or 'rename:3'

/**
 * Parses the editor's command-line arguments into a view request.
 * @param {string[]} argv - Arguments of this invocation (program name dropped)
 * @returns {{mode: 'multiline'} | {mode: 'rename', index: number}}
 */
const parseArgs = argv => {
  const i = argv.indexOf('--rename');
  if (i !== -1) {
    const index = parseInt(argv[i + 1], 10);
    if (Number.isInteger(index) && index >= 0)
      return { mode: 'rename', index };
  }
  return { mode: 'multiline' };
};

/**
 * Reads the current workspace-names as a newline-joined string.
 * @returns {string}
 */
const namesText = () => wmSettings.get_strv('workspace-names').join('\n');

/**
 * Builds the multiline view: a TextView pre-filled with the whole list, a
 * HeaderBar with Cancel / Sort hidden / OK, Escape to cancel. OK writes the
 * parsed list back.
 * @returns {Gtk.ApplicationWindow}
 */
const buildMultilineView = () => {
  const window = new Gtk.ApplicationWindow({
    application: app,
    title: 'Edit workspace names',
    default_width: 460,
    default_height: 420,
  });

  const header = new Gtk.HeaderBar();
  window.set_titlebar(header);

  const cancelBtn = new Gtk.Button({ label: 'Cancel' });
  const sortBtn = new Gtk.Button({ label: 'Sort hidden' });
  const okBtn = new Gtk.Button({ label: 'OK', css_classes: ['suggested-action'] });

  header.pack_start(cancelBtn);
  header.pack_end(okBtn);
  header.pack_end(sortBtn);

  const textView = new Gtk.TextView({
    wrap_mode: Gtk.WrapMode.WORD_CHAR,
    top_margin: 8,
    bottom_margin: 8,
    left_margin: 8,
    right_margin: 8,
  });
  const buffer = textView.get_buffer();
  buffer.set_text(namesText(), -1);

  window.set_child(new Gtk.ScrolledWindow({ hexpand: true, vexpand: true, child: textView }));

  const getText = () => buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), false);

  sortBtn.connect('clicked', () => buffer.set_text(sortHiddenNames(getText()), -1));
  okBtn.connect('clicked', () => {
    wmSettings.set_strv('workspace-names', parseEditorText(getText()));
    window.close();
  });
  cancelBtn.connect('clicked', () => window.close());

  const key = new Gtk.EventControllerKey();
  key.connect('key-pressed', (_c, keyval) => {
    if (keyval === Gdk.KEY_Escape) { window.close(); return true; }
    return false;
  });
  window.add_controller(key);

  textView.grab_focus();
  return window;
};

/**
 * Builds the single-line rename view for one workspace index: an Entry
 * pre-filled with that name, a HeaderBar with Cancel / OK, Enter confirms,
 * Escape cancels. OK writes the name at `index` via setNameAt.
 * @param {number} index
 * @returns {Gtk.ApplicationWindow}
 */
const buildRenameView = index => {
  const window = new Gtk.ApplicationWindow({
    application: app,
    title: `Rename workspace ${index + 1}`,
    default_width: 360,
    default_height: 80,
  });

  const header = new Gtk.HeaderBar();
  window.set_titlebar(header);

  const cancelBtn = new Gtk.Button({ label: 'Cancel' });
  const okBtn = new Gtk.Button({ label: 'OK', css_classes: ['suggested-action'] });
  header.pack_start(cancelBtn);
  header.pack_end(okBtn);

  const names = wmSettings.get_strv('workspace-names');
  const entry = new Gtk.Entry({
    text: names[index] ?? '',
    hexpand: true,
    margin_top: 8, margin_bottom: 8, margin_start: 8, margin_end: 8,
  });
  window.set_child(entry);

  const commit = () => {
    wmSettings.set_strv('workspace-names', setNameAt(wmSettings.get_strv('workspace-names'), index, entry.get_text()));
    window.close();
  };

  okBtn.connect('clicked', commit);
  entry.connect('activate', commit); // Enter confirms
  cancelBtn.connect('clicked', () => window.close());

  const key = new Gtk.EventControllerKey();
  key.connect('key-pressed', (_c, keyval) => {
    if (keyval === Gdk.KEY_Escape) { window.close(); return true; }
    return false;
  });
  window.add_controller(key);

  entry.grab_focus();
  return window;
};

/**
 * Shows the requested view in the single window, rebuilding it when the request
 * differs from what is currently shown, then presents (raises) it.
 * @param {{mode: 'multiline'} | {mode: 'rename', index: number}} request
 */
const showView = request => {
  const tag = request.mode === 'rename' ? `rename:${request.index}` : 'multiline';
  if (win && currentView !== tag) {
    win.destroy();
    win = null;
  }
  if (!win) {
    win = request.mode === 'rename' ? buildRenameView(request.index) : buildMultilineView();
    currentView = tag;
    win.connect('destroy', () => { win = null; currentView = null; });
  }
  win.present();
};

app.connect('command-line', (_app, cmdline) => {
  const argv = cmdline.get_arguments().slice(1); // drop program name
  showView(parseArgs(argv));
  cmdline.set_exit_status(0);
  return 0;
});

app.run([system.programInvocationName, ...ARGV]);
