import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';

import { visibleIndices } from './visible-indices.js';

/**
 * The background pill. A pure decoration positioned and sized manually under
 * the current label. It reports a zero preferred size so animating its width
 * never feeds back into the parent's layout — otherwise the parent would
 * re-measure the names row every animation frame and the last label would
 * flicker between ellipsized and not.
 */
const Pill = GObject.registerClass(
class Pill extends St.Widget {
  vfunc_get_preferred_width() {
    return [0, 0];
  }

  vfunc_get_preferred_height() {
    return [0, 0];
  }
});

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

    // Background pill, rendered behind the row (added first). Its zero
    // preferred size keeps it out of the parent's measurement.
    this._pill = new Pill({ style_class: 'workspace-pill' });
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
    if (mode !== this._mode) {
      this._lastIndices = null; // force snap on mode change
      this._pillTarget = null;  // forget the old target so the first place snaps
    }
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
    const indices = visibleIndices(this._mode, activeIndex, nWorkspaces);

    // Animate the pill only when the mode animates AND the visible structure is
    // stable between renders (same indices in the same slots). A structural
    // change (crossing an edge, slot count change, mode change) snaps instead —
    // a slide toward shifted labels would look wrong.
    const animates = this._mode === 'scroll' || this._mode === 'overview';
    const sameStructure = this._lastIndices
      && this._lastIndices.length === indices.length
      && this._lastIndices.every((v, i) => v === indices[i]);
    this._shouldAnimatePill = animates && sameStructure;
    this._lastIndices = indices;

    this._row.destroy_all_children();
    this._currentLabel = null;

    for (const index of indices) {
      const isCurrent = index === activeIndex;
      const label = new St.Label({
        text: this._displayName(names, index),
        style_class: 'workspace-name-label',
        y_align: Clutter.ActorAlign.CENTER,
        reactive: true,
        track_hover: true,
      });
      // Never ellipsize: names show in full. Letting Pango ellipsize made the
      // last label flicker between truncated and not as the row was re-allocated
      // during the pill animation. Overflow is the scroll view's job (overview).
      label.clutter_text.set({
        ellipsize: Pango.EllipsizeMode.NONE,
        single_line_mode: true,
      });
      label.connect('button-press-event', (_actor, event) => {
        // Only the primary button acts on a name; let secondary/middle clicks
        // propagate to the panel button's vfunc_event (context menu, etc.).
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
          return Clutter.EVENT_PROPAGATE;
        this.emit('workspace-clicked', index);
        return Clutter.EVENT_STOP;
      });
      this._row.add_child(label);
      if (isCurrent) this._currentLabel = label;
    }

    // The pill is repositioned in vfunc_allocate, once the new labels are laid
    // out. A relayout is needed because we just changed the children.
    this.queue_relayout();
  }

  /**
   * Allocates the bar, then positions the pill under the current label. Doing
   * this here (rather than from a per-label notify::allocation handler) means
   * the label geometry is always valid and there are no stray handlers to leak
   * — that handler approach made the pill oscillate between labels.
   * @param {Clutter.ActorBox} box
   */
  vfunc_allocate(box) {
    super.vfunc_allocate(box);
    this._allocatePill();
  }

  /**
   * Positions the pill under the current label. Slides with an eased transition
   * when _shouldAnimatePill is set (and the pill was already placed), otherwise
   * snaps. Called from vfunc_allocate, so the label allocation is valid.
   */
  _allocatePill() {
    const label = this._currentLabel;
    if (!label) {
      this._pill.hide();
      this._pillTarget = null;
      return;
    }

    // Snap the pill to whole pixels: a translucent rounded rect reads cleaner on
    // an integer grid, and the slide still looks smooth.
    const lbox = label.get_allocation_box();
    const target = {
      x: Math.round(lbox.x1),
      y: Math.round(lbox.y1),
      w: Math.round(lbox.x2 - lbox.x1),
      h: Math.round(lbox.y2 - lbox.y1),
    };

    // Re-arm only when the TARGET changes, not when the pill's current (possibly
    // mid-animation) geometry differs from it. vfunc_allocate fires several
    // times during a workspace switch; comparing against the live geometry would
    // restart the animation each time and make it stutter. Comparing against the
    // last requested target lets an in-flight ease run to completion untouched.
    const prev = this._pillTarget;
    const unchanged = prev
      && Math.abs(prev.x - target.x) < 1 && Math.abs(prev.y - target.y) < 1
      && Math.abs(prev.w - target.w) < 1 && Math.abs(prev.h - target.h) < 1;
    if (this._pill.visible && unchanged) return;

    const wasVisible = this._pill.visible;
    this._pillTarget = target;
    this._pill.show();
    this._pill.remove_all_transitions();

    if (this._shouldAnimatePill && wasVisible) {
      // Pill keeps its previous geometry; ease it toward the new label box.
      this._pill.ease({
        x: target.x, y: target.y, width: target.w, height: target.h,
        duration: 200,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    } else {
      this._pill.set_size(target.w, target.h);
      this._pill.set_position(target.x, target.y);
    }
  }
});

export default WorkspaceBar;
