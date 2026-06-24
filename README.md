# Gnome Workspace Titles

A GNOME Shell extension that shows the active workspace's name in the panel and lets you name
every workspace from a single editor.

> Fork of [MahdadGhasemian/gnome-workspace-titles](https://github.com/MahdadGhasemian/gnome-workspace-titles),
> rebranded under the `mabhub` namespace. Targets GNOME Shell 45 and 46.

## Features

- **Panel indicator** showing the active workspace's name (falls back to `Workspace N` when unnamed).
- **Left-click** opens a native GTK editor window for the whole workspace list — one name per line,
  with proper text selection and cursor placement. The editor is single-instance: clicking again
  while it is open just brings the window back to the front.
- **Right-click** opens a context menu: rename the current workspace, reset it, hide it (park it
  below the blank line instead of deleting it), edit all names, and toggle the two keyboard
  shortcuts on or off.
- **Parked names**: keep spare workspace names below a blank line in the editor. GNOME only shows
  the active ones; the rest wait there, ready to be moved back up. As you add or remove workspaces,
  the extension keeps the parked block past the panel automatically, so a parked name never leaks
  into view.
- **Sort hidden**: alphabetically reorders the parked names, ignoring a leading emoji/bullet prefix,
  with natural numeric ordering — the active names and the blank-line separator are left untouched.
- **Keyboard shortcuts**: the extension registers <kbd>Super</kbd>+<kbd>F2</kbd> (rename the current
  workspace, single-line) and <kbd>Super</kbd>+<kbd>F3</kbd> (edit all names). Both open the same
  standalone editor as the panel, toggle on/off from the context menu, and can be reconfigured via
  the schema keys — see *Keyboard shortcuts* below.

Names are stored in the standard GNOME key `org.gnome.desktop.wm.preferences` → `workspace-names`,
so they persist independently of the extension and interoperate with `gsettings` and your own
scripts.

## Usage

- **Click** the indicator (left button) to open the all-names editor.
- In the editor, press **Enter** for a new line; click **OK** to save, **Cancel** or **Esc** to
  discard.
- Put a **blank line** after your active names; anything below it is "parked" and hidden from GNOME.
- Click **Sort hidden** to alphabetize the parked block.

## Keyboard shortcuts

The extension registers two keybindings itself (no manual `gsettings` wiring):

- <kbd>Super</kbd>+<kbd>F2</kbd> — rename the **current** workspace (single-line entry).
- <kbd>Super</kbd>+<kbd>F3</kbd> — **edit all** workspace names (multiline editor).

Both launch the same single-instance editor as a left-click; pressing a shortcut again raises (or
re-renders) the open window rather than opening a second one. Each shortcut has a toggle in the
right-click context menu, and the accelerators live in the extension's own schema keys
(`rename-shortcut`, `edit-all-shortcut`) if you want to reconfigure them, e.g.:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/gnome-workspace-titles@mabhub.github.io/schemas/ \
  set org.gnome.shell.extensions.gnome-workspace-titles@mabhub rename-shortcut "['<Super>F2']"
```

Because the extension owns these accelerators, remove any of your own custom keybindings bound to
the same combinations (otherwise they conflict and the extension's binding is ignored).

## Install from source

From the repository root:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/gnome-workspace-titles@mabhub.github.io
cp -r src/* ~/.local/share/gnome-shell/extensions/gnome-workspace-titles@mabhub.github.io/
gnome-extensions enable gnome-workspace-titles@mabhub.github.io
```

Then reload GNOME Shell so it picks up the new extension:

- **X11**: press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`, press <kbd>Enter</kbd>.
- **Wayland**: log out and back in (there is no in-session reload).

If `gnome-extensions enable` reports that the extension does not exist, the running Shell has not
seen it yet — reload first, then enable.

## Build the zip

Package `src/` into an installable zip. **Delete the old zip first**: `zip` updates an existing
archive in place, so files removed from `src/` (e.g. a renamed schema) would otherwise linger.

```bash
rm -f output/gnome-workspace-titles.zip && \
cd src && \
zip -r ../output/gnome-workspace-titles.zip * && \
cd .. && \
gnome-extensions install output/gnome-workspace-titles.zip --force
```

## Publish to GNOME Extensions

Bump `version` (an integer) in `src/metadata.json`, rebuild the zip, then upload it:

```bash
rm -f output/gnome-workspace-titles.zip && \
cd src && \
zip -r ../output/gnome-workspace-titles.zip * && \
cd ..
```

🔗 [Upload to GNOME Extensions](https://extensions.gnome.org/upload/)

## Debug

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep GnomeWorkspaceTitlesExtension
```

## License

Licensed under the [GNU General Public License v2.0 or later](LICENSE) (GPL-2.0-or-later),
consistent with GNOME Shell, which this extension links against.

This is a fork of
[MahdadGhasemian/gnome-workspace-titles](https://github.com/MahdadGhasemian/gnome-workspace-titles)
(published on [GNOME Extensions](https://extensions.gnome.org/extension/8970/gnome-workspace-titles/)).
The original carried no explicit license file; as a GNOME Shell extension it is necessarily a
derivative work of GPL-licensed GNOME Shell, so this fork is distributed under GPL-2.0-or-later with
attribution to the original author.

Copyright © Mahdad Ghasemian (original) and contributors to this fork.
