import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
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
