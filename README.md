# Gnome Workspace Titles

A GNOME Shell extension that shows the active workspace's name in the panel and lets you name
every workspace from a single editor.

![Screenshot](./.images/screenshot2.png)

> Fork of [MahdadGhasemian/gnome-workspace-titles](https://github.com/MahdadGhasemian/gnome-workspace-titles),
> rebranded under the `mabhub` namespace. Targets GNOME Shell 45 and 46.

## Features

- **Panel indicator** showing the active workspace's name (falls back to `Workspace N` when unnamed).
- **Left-click** opens a multiline editor for the whole workspace list — one name per line.
- **Right-click** opens a context menu: rename the current workspace, reset it, remove it, or edit
  all names.
- **Parked names**: keep spare workspace names below a blank line in the editor. GNOME only shows
  the active ones; the rest wait there, ready to be moved back up.
- **Sort hidden**: alphabetically reorders the parked names, ignoring a leading emoji/bullet prefix,
  with natural numeric ordering — the active names and the blank-line separator are left untouched.

Names are stored in the standard GNOME key `org.gnome.desktop.wm.preferences` → `workspace-names`,
so they persist independently of the extension and interoperate with `gsettings` and your own
scripts.

## Usage

- **Click** the indicator (left button) to open the all-names editor.
- In the editor, press **Enter** for a new line; click **OK** to save, **Cancel** or **Esc** to
  discard.
- Put a **blank line** after your active names; anything below it is "parked" and hidden from GNOME.
- Click **Sort hidden** to alphabetize the parked block.

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
