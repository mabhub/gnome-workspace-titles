import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

export const InputDialog = GObject.registerClass(
    class InputDialog extends ModalDialog.ModalDialog {
        /**
         * Single-line text dialog built on the Shell's standard ModalDialog, so it
         * follows the system theme and handles focus/dimming/Escape natively.
         * Enter confirms (default button). Resolves with the trimmed text.
         * @param {string} prompt - Label text shown above the entry
         * @param {string} [initialText=''] - Pre-filled text in the entry
         */
        _init(prompt, initialText = '') {
            super._init({ styleClass: 'rename-dialog', destroyOnClose: true });

            this._resolve = null;

            if (prompt) {
                const label = new St.Label({ text: prompt, style_class: 'input-dialog-prompt' });
                this.contentLayout.add_child(label);
            }

            this._entry = new St.Entry({
                text: initialText,
                style_class: 'input-dialog-entry',
                hint_text: 'Enter text...',
                x_expand: true,
                track_hover: true,
                can_focus: true
            });

            // Enable mouse/keyboard text selection.
            const clutterText = this._entry.clutter_text;
            clutterText.editable = true;
            clutterText.selectable = true;
            clutterText.reactive = true;

            this.contentLayout.add_child(this._entry);

            this.setButtons([
                {
                    label: 'Cancel',
                    action: () => this.close(false),
                    key: Clutter.KEY_Escape
                },
                {
                    label: 'OK',
                    action: () => this.close(true),
                    default: true   // Enter confirms
                }
            ]);
        }

        /**
         * Opens the dialog, selects all text and focuses the entry. Returns a
         * Promise that resolves with `{ text: string }` on confirm, or `null` on
         * cancel / Escape.
         * @returns {Promise<{text: string}|null>}
         */
        open() {
            super.open();
            this._entry.clutter_text.set_selection(0, -1);
            this._entry.grab_key_focus();
            return new Promise(resolve => this._resolve = resolve);
        }

        /**
         * Closes the dialog and resolves the open() Promise. On confirm, resolves
         * with the trimmed entry text.
         * @param {boolean} [confirm=false]
         */
        close(confirm = false) {
            const result = confirm ? { text: this._entry.text.trim() } : null;
            super.close();
            if (this._resolve) {
                this._resolve(result);
                this._resolve = null;
            }
        }
    });

export const MultilineInputDialog = GObject.registerClass(
    class MultilineInputDialog extends ModalDialog.ModalDialog {
        /**
         * Multiline editor for the full workspace-names list (one name per line),
         * built on the Shell's standard ModalDialog (focus, dimming and Escape
         * handling come for free). Return inserts a newline; confirmation is via
         * the OK button only. Resolves with the raw text — no global trim.
         * @param {string} prompt - Label text shown above the entry
         * @param {string} [initialText=''] - Pre-filled multiline text
         * @param {(text: string) => string} [onSort=null] - Sort callback wired to the
         *   "Sort hidden" button; receives the current text, returns the reordered text
         */
        _init(prompt, initialText = '', onSort = null) {
            super._init({ styleClass: 'multiline-dialog', destroyOnClose: true });

            this._onSort = onSort;
            this._resolve = null;
            this._pendingShiftAnchor = null;

            if (prompt) {
                const label = new St.Label({ text: prompt, style_class: 'input-dialog-prompt' });
                this.contentLayout.add_child(label);
            }

            // Multiline text entry. St.Entry cannot be a direct child of an
            // St.ScrollView (it does not implement StScrollable), so it is wrapped
            // in an St.BoxLayout (which does). The entry's height is driven to its
            // natural content height (see _syncEntryHeight) so the ScrollView has
            // something to scroll once the list is taller than its fixed area.
            this._entry = new St.Entry({
                text: initialText,
                style_class: 'input-dialog-entry input-dialog-entry-multiline',
                x_expand: true,
                track_hover: true,
                can_focus: true
            });

            this._clutterText = this._entry.clutter_text;
            this._clutterText.single_line_mode = false;
            this._clutterText.activatable = false;   // Return inserts a newline, not "activate"
            this._clutterText.line_wrap = true;
            this._clutterText.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            // Enable mouse/keyboard text selection (Shift+Click, Shift+Arrows).
            this._clutterText.editable = true;
            this._clutterText.selectable = true;
            this._clutterText.reactive = true;
            // Let the text fill the entry's full width (does not, on its own, make
            // clicks past a short line land at the line's end — a known minor quirk).
            this._clutterText.x_expand = true;
            this._clutterText.x_align = Clutter.ActorAlign.FILL;

            // Shift+Click should extend the selection from the current cursor to the
            // clicked position (click-to-extend). ClutterText does not do this on its
            // own here, so handle it explicitly.
            this._clutterText.connect('button-press-event', (text, event) =>
                this._onTextButtonPress(text, event));

            // Grow the entry as the text grows, so the ScrollView can scroll.
            this._clutterText.connect('text-changed', () => this._syncEntryHeight());

            const scrollContent = new St.BoxLayout({ vertical: true, x_expand: true });
            scrollContent.add_child(this._entry);

            this._scrollView = new St.ScrollView({
                style_class: 'input-dialog-scroll',
                x_expand: true,
                y_expand: true,
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                enable_mouse_scrolling: true
            });
            this._scrollView.add_child(scrollContent);
            this.contentLayout.add_child(this._scrollView);

            // The ScrollView's drag-to-pan steals mouse drags from the entry,
            // breaking Shift+Click text selection. Remove its PanAction so drags
            // reach the ClutterText; wheel + scrollbar still scroll.
            this._disableDragPan(this._scrollView);

            this.setButtons([
                {
                    label: 'Cancel',
                    action: () => this.close(false),
                    key: Clutter.KEY_Escape
                },
                {
                    label: 'Sort hidden',
                    action: () => {
                        if (this._onSort) this.setText(this._onSort(this.getText()));
                    }
                },
                {
                    label: 'OK',
                    action: () => this.close(true),
                    default: true
                }
            ]);
        }

        /**
         * Removes the ScrollView's drag-to-pan gesture so mouse drags fall through
         * to the ClutterText (enabling Shift+Click selection). Wheel scrolling and
         * the scrollbar are unaffected. Enumerates actions by type to stay robust
         * across naming changes.
         * @param {St.ScrollView} scrollView
         */
        _disableDragPan(scrollView) {
            for (const action of scrollView.get_actions()) {
                if (action instanceof Clutter.PanAction)
                    scrollView.remove_action(action);
            }
        }

        /**
         * Implements Shift+Click "click-to-extend": keeps the current cursor as the
         * selection anchor, lets ClutterText place the cursor at the clicked
         * position itself (so scroll offset is handled correctly), then extends the
         * selection from the anchor to the new cursor. Plain clicks are untouched,
         * so native click-and-drag selection keeps working.
         * @param {Clutter.Text} text
         * @param {Clutter.Event} event
         * @returns {boolean} Clutter.EVENT_PROPAGATE (never stops the event)
         */
        _onTextButtonPress(text, event) {
            const isLeft = event.get_button() === Clutter.BUTTON_PRIMARY;
            const shift = (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
            if (!isLeft || !shift)
                return Clutter.EVENT_PROPAGATE;

            // Anchor = where the cursor currently sits (-1 means end-of-text).
            let anchor = text.get_cursor_position();
            if (anchor < 0)
                anchor = text.get_text().length;

            // Let the default handler place the cursor at the click (correct even
            // when scrolled), then extend the selection from the anchor to it.
            this._pendingShiftAnchor = anchor;
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (this._pendingShiftAnchor !== null) {
                    text.set_selection(this._pendingShiftAnchor, text.get_cursor_position());
                    this._pendingShiftAnchor = null;
                }
                return GLib.SOURCE_REMOVE;
            });

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Sets the entry's height to its text's natural (unclipped) height, so the
         * wrapping BoxLayout exceeds the ScrollView area and the ScrollView scrolls.
         */
        _syncEntryHeight() {
            const themeNode = this._entry.get_theme_node();
            const forWidth = this._entry.get_width() || 320;
            const [, natH] = this._clutterText.get_preferred_height(forWidth);
            // Add the entry's vertical padding/border so the text is not clipped.
            const inner = themeNode.get_vertical_padding() + themeNode.get_border_width(St.Side.TOP) + themeNode.get_border_width(St.Side.BOTTOM);
            this._entry.set_height(natH + inner + 4);
        }

        /**
         * Opens the dialog and returns a Promise that resolves when it closes.
         * Resolves with `{ text: string }` (raw, untrimmed) on confirm, `null` on
         * cancel / Escape.
         * @returns {Promise<{text: string}|null>}
         */
        open() {
            super.open();
            this._syncEntryHeight();
            this._entry.grab_key_focus();
            return new Promise(resolve => this._resolve = resolve);
        }

        /**
         * Closes the dialog and resolves the open() Promise. On confirm, resolves
         * with the raw entry text (no trim — line-level stripping is the caller's).
         * @param {boolean} [confirm=false]
         */
        close(confirm = false) {
            const result = confirm ? { text: this._entry.text } : null;
            super.close();
            if (this._resolve) {
                this._resolve(result);
                this._resolve = null;
            }
        }

        /**
         * Returns the current raw text of the entry.
         * @returns {string}
         */
        getText() {
            return this._entry.text;
        }

        /**
         * Rewrites the entry content in place (used by the Sort hidden button).
         * @param {string} text
         */
        setText(text) {
            this._entry.set_text(text);
            this._clutterText.set_cursor_position(-1);
        }
    });