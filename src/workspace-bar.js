import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { visibleIndices } from './visible-indices.js';

/**
 * The panel names bar: a background "pill" actor behind a horizontal row of
 * clickable workspace-name labels. Driven by a display mode and a snapshot of
 * state pushed via render(). Emits 'workspace-clicked' with the real workspace
 * index; the extension decides what a click means (editor vs switch).
 */
export const WorkspaceBar = GObject.registerClass({
  Signals: { 'workspace-clicked': { param_types: [GObject.TYPE_INT] } },
}, class WorkspaceBar extends St.Widget {
  _init() {
    super._init({
      style_class: 'workspace-indicator-box',
      layout_manager: new Clutter.BinLayout(),
      reactive: false,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._mode = 'default';
    this._overviewMaxWidth = 600;

    // Background pill, rendered behind the row (added first).
    this._pill = new St.Widget({ style_class: 'workspace-pill' });
    this.add_child(this._pill);

    // Row of labels, on top.
    this._row = new St.BoxLayout({
      style_class: 'workspace-names-row',
      vertical: false,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.add_child(this._row);
  }

  /**
   * Sets the display mode ('default' | 'scroll' | 'overview').
   * @param {string} mode
   */
  setMode(mode) {
    this._mode = mode;
  }

  /**
   * Sets the overview max width in pixels (used for scrolling in overview).
   * @param {number} px
   */
  setOverviewMaxWidth(px) {
    this._overviewMaxWidth = px;
  }

  /**
   * Resolves the display name for an index: the trimmed stored name, or the
   * "Workspace N" fallback.
   * @param {string[]} names
   * @param {number} index
   * @returns {string}
   */
  _displayName(names, index) {
    return names[index]?.trim() || `Workspace ${index + 1}`;
  }

  /**
   * Recomposes labels and pill for the given state.
   * @param {string[]} names - Full workspace-names strv
   * @param {number} activeIndex - Active workspace index
   * @param {number} nWorkspaces - Total workspace count
   */
  render(names, activeIndex, nWorkspaces) {
    this._row.destroy_all_children();
    this._currentLabel = null;

    const indices = visibleIndices(this._mode, activeIndex, nWorkspaces);

    for (const index of indices) {
      const isCurrent = index === activeIndex;
      const label = new St.Label({
        text: this._displayName(names, index),
        style_class: 'workspace-name-label',
        y_align: Clutter.ActorAlign.CENTER,
        reactive: true,
        track_hover: true,
      });
      label.connect('button-press-event', () => {
        this.emit('workspace-clicked', index);
        return Clutter.EVENT_STOP;
      });
      this._row.add_child(label);
      if (isCurrent) this._currentLabel = label;
    }

    // Place the pill under the current label once allocation is known.
    this._positionPill();
  }

  /**
   * Positions the pill under the current label (no animation here). Reads the
   * label allocation; if it is not allocated yet, defers one frame.
   */
  _positionPill() {
    const label = this._currentLabel;
    if (!label) {
      this._pill.hide();
      return;
    }
    this._pill.show();

    const apply = () => {
      const box = label.get_allocation_box();
      this._pill.set_position(box.x1, box.y1);
      this._pill.set_size(box.x2 - box.x1, box.y2 - box.y1);
    };

    if (label.get_allocation_box().x2 > 0) apply();
    else label.connect('notify::allocation', () => apply());
  }
});

export default WorkspaceBar;
