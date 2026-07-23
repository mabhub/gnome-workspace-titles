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
import { EDITOR_WIDTH, clampEditorHeight } from './editor-sizing.js';

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

// Defensive only: a GTK widget always answers with a Pango layout, so this is
// never expected to be used. It just keeps a broken measurement from producing
// a zero-height window.
const FALLBACK_LINE_HEIGHT = 20;

/**
 * Measures one line of text as the widget's own font would render it, so the
 * sizing follows the system font instead of a hardcoded guess.
 * @param {Gtk.Widget} widget - Widget whose Pango context provides the font
 * @returns {number} Line height in pixels
 */
const lineHeightOf = widget => {
  const layout = widget.create_pango_layout('Ag');
  if (!layout) return FALLBACK_LINE_HEIGHT;
  const [, height] = layout.get_pixel_size();
  return height > 0 ? height : FALLBACK_LINE_HEIGHT;
};

/**
 * Collects the measurements clampEditorHeight needs, then defers the
 * arithmetic to it.
 *
 * The monitor is a known approximation: the height must be decided before the
 * window exists, but which monitor it lands on is the compositor's call and is
 * only knowable once it has been mapped. Monitor 0 is therefore a guess, and on
 * a multi-monitor setup whose displays differ in height it can be the wrong
 * one -- a list sized for a tall monitor may overflow a shorter one. Resolving
 * it properly means re-clamping from a `map` handler via
 * get_monitor_at_surface(), at the cost of a visible resize on open.
 * @param {Gtk.Widget} widget - Widget used to measure the line and find the monitor
 * @param {number} lineCount - Number of lines the editor starts with
 * @returns {number} Height in pixels
 */
const editorHeightFor = (widget, lineCount) => {
  const monitor = widget.get_display()?.get_monitors()?.get_item(0);
  const monitorHeight = monitor?.get_geometry()?.height ?? 0;
  return clampEditorHeight(lineCount, lineHeightOf(widget), monitorHeight);
};

/**
 * Builds the multiline view: a TextView pre-filled with the whole list, a
 * HeaderBar with Cancel / Sort hidden / OK. Escape cancels, Ctrl+Enter saves
 * and closes (like OK), Ctrl+S saves in place without closing. OK writes the
 * parsed list back.
 * @returns {Gtk.ApplicationWindow}
 */
const buildMultilineView = () => {
  const window = new Gtk.ApplicationWindow({
    application: app,
    title: 'Edit workspace names',
    default_width: EDITOR_WIDTH,
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
  // Read the key once: the buffer, the cursor position and the window height
  // must all describe the same list, and the extension writes this same key
  // from its own signal handlers.
  const text = namesText();
  const buffer = textView.get_buffer();
  buffer.set_text(text, -1);

  // Start the cursor at the end of the last active name (the line just before
  // the first blank separator), the natural spot to edit/add active names. When
  // there is no blank line (everything is active), leave it at the start.
  const lines = text.split('\n');
  const frontier = lines.indexOf('');
  if (frontier > 0) {
    // gjs returns [ok, iter] for get_iter_at_line (the iter is an out param).
    const [, iter] = buffer.get_iter_at_line(frontier - 1);
    iter.forward_to_line_end();
    buffer.place_cursor(iter);
  }

  window.set_child(new Gtk.ScrolledWindow({ hexpand: true, vexpand: true, child: textView }));

  // Open tall enough for the whole list, within bounds. Done after set_child so
  // the TextView is in the widget tree and its font/display are resolvable.
  window.set_default_size(EDITOR_WIDTH, editorHeightFor(textView, lines.length));

  const getText = () => buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), false);
  const save = () => wmSettings.set_strv('workspace-names', parseEditorText(getText()));

  sortBtn.connect('clicked', () => buffer.set_text(sortHiddenNames(getText()), -1));
  okBtn.connect('clicked', () => { save(); window.close(); });
  cancelBtn.connect('clicked', () => window.close());

  const key = new Gtk.EventControllerKey();
  // CAPTURE phase: the TextView consumes Return to insert a newline before a
  // bubble-phase controller would ever see it, so Ctrl+Enter must be caught on
  // the way down. We only swallow our own combos; everything else returns false
  // and reaches the TextView untouched.
  key.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
  key.connect('key-pressed', (_c, keyval, _code, state) => {
    if (keyval === Gdk.KEY_Escape) { window.close(); return true; }
    const ctrl = (state & Gdk.ModifierType.CONTROL_MASK) !== 0;
    // Ctrl+Enter: save and close (like OK). Ctrl+S: save in place, stay open.
    if (ctrl && (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter)) {
      save();
      window.close();
      return true;
    }
    if (ctrl && (keyval === Gdk.KEY_s || keyval === Gdk.KEY_S)) {
      save();
      return true;
    }
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
