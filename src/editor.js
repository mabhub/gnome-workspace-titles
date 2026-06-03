#!/usr/bin/env -S gjs -m
// Standalone, single-instance editor for the workspace-names list. Unlike the
// previous pipe-driven version, this reads and writes
// org.gnome.desktop.wm.preferences → workspace-names itself (like the old zenity
// script), and registers as a single-instance Gtk.Application: launching it
// again while the window is open just raises the existing window instead of
// spawning a second one.
//
// Entry points (all land on the same window):
//   - the extension spawns `gjs -m editor.js` on panel left-click
//   - a Super+F3 custom shortcut runs the same command
//
// A real GTK4 Gtk.TextView gives native multiline behaviour for free — clicking
// in the empty space past a short line, click/drag/double/triple-click
// selection, wrapping and scrolling.
//
// Standalone test (acts on the real gsettings key, like zenity):
//   gjs -m editor.js

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';

import { parseEditorText, sortHiddenNames } from './workspace-names.js';

const wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });

const app = new Gtk.Application({
    application_id: 'io.github.mabhub.WorkspaceTitlesEditor',
});

// Built lazily on first activate, reused (and raised) on later activations.
let win = null;

/**
 * Builds the editor window: a multiline TextView pre-filled with the current
 * workspace-names, a HeaderBar with Cancel / Sort hidden / OK, and Escape to
 * cancel. OK writes workspace-names back; Cancel / Escape / closing the window
 * leave it untouched.
 * @returns {Gtk.ApplicationWindow}
 */
const buildWindow = () => {
    const window = new Gtk.ApplicationWindow({
        application: app,
        title: 'Edit workspace names',
        default_width: 460,
        default_height: 420,
    });
    window.connect('destroy', () => { win = null; });

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
    buffer.set_text(wmSettings.get_strv('workspace-names').join('\n'), -1);

    const scroll = new Gtk.ScrolledWindow({
        hexpand: true,
        vexpand: true,
        child: textView,
    });
    window.set_child(scroll);

    const getText = () => buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), false);

    sortBtn.connect('clicked', () => buffer.set_text(sortHiddenNames(getText()), -1));

    okBtn.connect('clicked', () => {
        wmSettings.set_strv('workspace-names', parseEditorText(getText()));
        window.close();
    });

    cancelBtn.connect('clicked', () => window.close());

    // Escape cancels (close without writing).
    const key = new Gtk.EventControllerKey();
    key.connect('key-pressed', (_controller, keyval) => {
        if (keyval === Gdk.KEY_Escape) {
            window.close();
            return true;
        }
        return false;
    });
    window.add_controller(key);

    textView.grab_focus();
    return window;
};

app.connect('activate', () => {
    // Already open → just bring it back to view (handles a second panel click or
    // Super+F3 while the window is hidden behind others or on another workspace).
    if (!win)
        win = buildWindow();
    win.present();
});

app.run(['gnome-workspace-titles-editor']);
