# Gnome Workspace Titles

A GNOME Shell extension that shows workspace names in the panel, highlights the current one with an
animated background pill, switches workspace on click, and lets you name every workspace from a
single editor.

> Fork of [MahdadGhasemian/gnome-workspace-titles](https://github.com/MahdadGhasemian/gnome-workspace-titles),
> rebranded under the `mabhub` namespace. Targets GNOME Shell 45 and 46.

## Features

- **Display modes** chosen from the right-click menu:
  - *Default* — the current workspace's name only.
  - *Scroll* — the previous / current / next names (the missing slot is simply absent at the edges).
  - *Overview* — every workspace's name, scrolling to keep the current one centered.
- **Current workspace highlight**: a rounded background pill sits behind the current name and slides
  to follow it when you switch (in the animated modes). Names fall back to `Workspace N` when unnamed.
- **Last workspace as `+`**: with dynamic workspaces GNOME always keeps one empty workspace at the
  end; the panel labels it `+` (the "go here for a new workspace" slot) instead of its name.
- **Left-click a name** to switch to that workspace. Clicking the current name does nothing; the
  editor is no longer opened by a left-click (use the menu or a shortcut).
- **Right-click** opens a context menu: pick the display mode, rename the current workspace, reset
  it, hide it (park it below the blank line instead of deleting it), edit all names, and toggle the
  two keyboard shortcuts on or off.
- **Parked names**: keep spare workspace names below a blank line in the editor. GNOME only shows
  the active ones; the rest wait there, ready to be moved back up. As you add or remove workspaces,
  the extension keeps the parked block past the panel automatically, so a parked name never leaks
  into view.
- **Sort hidden**: alphabetically reorders the parked names, ignoring a leading emoji/bullet prefix,
  with natural numeric ordering — the active names and the blank-line separator are left untouched.
- **Keyboard shortcuts**: the extension registers <kbd>Super</kbd>+<kbd>F2</kbd> (rename the current
  workspace, single-line) and <kbd>Super</kbd>+<kbd>F3</kbd> (edit all names). Both open the same
  standalone editor as the context menu, toggle on/off from that menu, and can be reconfigured via
  the schema keys — see *Keyboard shortcuts* below.

Names are stored in the standard GNOME key `org.gnome.desktop.wm.preferences` → `workspace-names`,
so they persist independently of the extension and interoperate with `gsettings` and your own
scripts.

## Usage

- **Left-click** a name to switch to that workspace.
- **Right-click** for the context menu: pick the **display mode**, rename/reset/hide the current
  workspace, or open the all-names editor (**Edit all**).
- Open the all-names editor from the menu or with <kbd>Super</kbd>+<kbd>F3</kbd>. In it, press
  **Enter** for a new line; click **OK** (or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>) to save and close,
  <kbd>Ctrl</kbd>+<kbd>S</kbd> to save without closing, **Cancel** or **Esc** to discard.
- Put a **blank line** after your active names; anything below it is "parked" and hidden from GNOME.
- Click **Sort hidden** to alphabetize the parked block.

## Keyboard shortcuts

The extension registers two keybindings itself (no manual `gsettings` wiring):

- <kbd>Super</kbd>+<kbd>F2</kbd> — rename the **current** workspace (single-line entry).
- <kbd>Super</kbd>+<kbd>F3</kbd> — **edit all** workspace names (multiline editor).

Both launch the same single-instance editor as the **Edit all** menu entry; pressing a shortcut
again raises (or re-renders) the open window rather than opening a second one. Each shortcut has a
toggle in the right-click context menu, and the accelerators live in the extension's own schema keys
(`rename-shortcut`, `edit-all-shortcut`) if you want to reconfigure them, e.g.:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/gnome-workspace-titles@mabhub.github.io/schemas/ \
  set org.gnome.shell.extensions.gnome-workspace-titles@mabhub rename-shortcut "['<Super>F2']"
```

Because the extension owns these accelerators, remove any of your own custom keybindings bound to
the same combinations (otherwise they conflict and the extension's binding is ignored).

## Install from source

From the repository root. The `glib-compile-schemas` step is required: the compiled schema
(`gschemas.compiled`) is a build artifact that is not checked in, and `gnome-extensions enable` does
not compile it — without it the extension fails to load its settings. (The zip flow below compiles
the schema for you; this manual flow does not.)

```bash
EXT=~/.local/share/gnome-shell/extensions/gnome-workspace-titles@mabhub.github.io
mkdir -p "$EXT"
cp -r src/* "$EXT/"
glib-compile-schemas "$EXT/schemas/"
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
