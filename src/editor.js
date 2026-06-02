#!/usr/bin/env -S gjs -m
// External multiline editor for the workspace-names list, run as a separate
// process by the extension (see extension.js _openEditAllPopup). Using a real
// GTK4 Gtk.TextView gives us native multiline behaviour for free — clicking in
// the empty space past a short line, click/drag/double/triple-click selection,
// wrapping and scrolling — none of which St.Entry (a single-line widget) handles
// correctly when bent into a multiline editor inside the Shell process.
//
// Exchange contract with the extension:
//   - initial text is read from STDIN  (UTF-8, one name per line)
//   - on OK:               the final text is written to STDOUT, exit code 0
//   - on Cancel / Escape:  nothing is written,                 exit code 1
//
// Standalone test:
//   printf 'Web\nCode\n\n🅱 alpha\n🅰 zeta\n' | gjs -m editor.js

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import system from 'system';

import { sortHiddenNames } from './workspace-names.js';

/**
 * Reads STDIN to EOF and returns it as a UTF-8 string (one name per line).
 * @returns {string}
 */
function readStdin() {
    const base = new GioUnix.InputStream({ fd: 0, close_fd: false });
    const stream = new Gio.DataInputStream({ base_stream: base });
    const lines = [];
    let line;
    while ((line = stream.read_line_utf8(null)[0]) !== null)
        lines.push(line);
    return lines.join('\n');
}

const initialText = readStdin();

const app = new Gtk.Application({
    application_id: 'io.github.mabhub.WorkspaceTitlesEditor',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

let resultText = null;   // text to emit on STDOUT if confirmed (null = cancelled)

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({
        application: app,
        title: 'Edit workspace names',
        default_width: 460,
        default_height: 420,
    });

    // HeaderBar with custom buttons — the whole point of an external GTK window
    // over zenity (which allows only a single extra button and no in-place edit).
    const header = new Gtk.HeaderBar();
    win.set_titlebar(header);

    const cancelBtn = new Gtk.Button({ label: 'Cancel' });
    const sortBtn = new Gtk.Button({ label: 'Sort hidden' });
    const okBtn = new Gtk.Button({ label: 'OK', css_classes: ['suggested-action'] });

    header.pack_start(cancelBtn);
    header.pack_end(okBtn);
    header.pack_end(sortBtn);

    const textView = new Gtk.TextView({
        wrap_mode: Gtk.WrapMode.WORD_CHAR,
        top_margin: 8, bottom_margin: 8, left_margin: 8, right_margin: 8,
    });
    const buffer = textView.get_buffer();
    buffer.set_text(initialText, -1);

    const scroll = new Gtk.ScrolledWindow({
        hexpand: true, vexpand: true,
        child: textView,
    });
    win.set_child(scroll);

    const getText = () => {
        const [start, end] = [buffer.get_start_iter(), buffer.get_end_iter()];
        return buffer.get_text(start, end, false);
    };

    sortBtn.connect('clicked', () => buffer.set_text(sortHiddenNames(getText()), -1));

    okBtn.connect('clicked', () => {
        resultText = getText();
        win.close();
    });

    cancelBtn.connect('clicked', () => {
        resultText = null;
        win.close();
    });

    // Escape cancels.
    const key = new Gtk.EventControllerKey();
    key.connect('key-pressed', (_controller, keyval) => {
        if (keyval === Gdk.KEY_Escape) {
            resultText = null;
            win.close();
            return true;
        }
        return false;
    });
    win.add_controller(key);

    textView.grab_focus();
    win.present();
});

app.run([]);

if (resultText !== null)
    print(resultText);

system.exit(resultText !== null ? 0 : 1);
