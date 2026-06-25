// SPDX-FileCopyrightText: Mahdad Ghasemian and gnome-workspace-titles@mabhub contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';

import { visibleIndices } from './visible-indices.js';

// Slide duration shared by the pill and the overview scroll, in milliseconds.
const ANIM_MS = 200;

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

    // The pill and the label row share one BinLayout (_content) so the pill
    // stays glued to the labels when scrolled. A ScrollView only accepts a
    // St.Scrollable child, and a plain St.Widget is not one, so _content is
    // wrapped in a St.BoxLayout (which is scrollable) before going in.
    this._content = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      y_align: Clutter.ActorAlign.CENTER,
    });

    // Background pill, rendered behind the row (added first). Its zero preferred
    // size keeps it out of the content's measurement. We place it ourselves with
    // set_position/set_size from vfunc_allocate, so it must opt out of the
    // BinLayout via fixed position: otherwise the layout re-allocates it on every
    // pass and overrides our geometry, leaving the pill mis-placed (centered and
    // mis-sized) at startup / after resume from suspend until the next workspace
    // switch happened to re-sync the timing.
    this._pill = new Pill({ style_class: 'workspace-pill' });
    this._pill.set_fixed_position_set(true);
    this._content.add_child(this._pill);

    // Row of labels, on top.
    this._row = new St.BoxLayout({
      style_class: 'workspace-names-row',
      vertical: false,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._content.add_child(this._row);

    // Scrollable wrapper so the ScrollView accepts the content.
    this._scrollable = new St.BoxLayout({
      vertical: false,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._scrollable.add_child(this._content);

    // The content lives in a scroll view; only overview caps its width and
    // scrolls. Other modes let it size naturally (no scrollbar shows).
    this._scroll = new St.ScrollView({
      style_class: 'workspace-names-scroll',
      hscrollbar_policy: St.PolicyType.EXTERNAL,
      vscrollbar_policy: St.PolicyType.NEVER,
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._scroll.set_child(this._scrollable);
    this.add_child(this._scroll);
  }

  /**
   * Stops any in-flight pill / scroll animations. Call before the widget is
   * destroyed (extension disable) so a transition can't fire a callback into a
   * half-torn-down actor — the "call back into JSAPI during GC" hazard.
   */
  stopAnimations() {
    this._pill?.remove_all_transitions();
    this._scroll?.get_hadjustment()?.remove_transition('value');
  }

  /**
   * Sets the display mode ('default' | 'scroll' | 'overview').
   * @param {string} mode
   */
  setMode(mode) {
    if (mode !== this._mode) {
      this._lastIndices = null;   // force snap on mode change
      this._pillTarget = null;    // forget the old target so the first place snaps
      this._scrollTarget = null;  // and re-center from scratch in overview
    }
    this._mode = mode;
    this._applyScrollCap();
  }

  /**
   * Sets the overview max width in pixels (used for scrolling in overview).
   * @param {number} px
   */
  setOverviewMaxWidth(px) {
    this._overviewMaxWidth = px;
    this._applyScrollCap();
  }

  /**
   * Caps the scroll view width in overview (so it scrolls), and removes the cap
   * in other modes (natural size, no scrollbar). Driven by mode/width changes
   * rather than every render, since the value only changes there.
   */
  _applyScrollCap() {
    this._scroll.set_style(this._mode === 'overview'
      ? `max-width: ${this._overviewMaxWidth}px;`
      : '');
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
    if (this._mode === 'overview') this._centerOnCurrent();
  }

  /**
   * Scrolls the overview content so the current label is centered in the visible
   * width. Animates the horizontal adjustment when the target moves; snaps the
   * first time. St.Adjustment is a GObject (not an actor), so it has no ease()
   * helper — animate its `value` with an explicit Clutter.PropertyTransition.
   */
  _centerOnCurrent() {
    const label = this._currentLabel;
    if (!label) return;

    const adjustment = this._scroll.get_hadjustment();
    if (!adjustment) return;

    const lbox = label.get_allocation_box();
    const labelCenter = (lbox.x1 + lbox.x2) / 2;
    const pageSize = adjustment.page_size;
    const maxValue = Math.max(0, adjustment.upper - pageSize);
    const target = Math.round(Math.max(0, Math.min(labelCenter - pageSize / 2, maxValue)));

    // Re-arm only when the target changes (vfunc_allocate fires repeatedly).
    // Record it even when already at the target so the next equal render is a
    // no-op too — keeps this guard and the value check in agreement.
    if (this._scrollTarget === target) return;
    this._scrollTarget = target;
    if (Math.abs(adjustment.value - target) < 1) return;

    adjustment.remove_transition('value');
    if (this._shouldAnimatePill) {
      const t = new Clutter.PropertyTransition({
        property_name: 'value',
        duration: ANIM_MS,
        progress_mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
      t.set_from(adjustment.value);
      t.set_to(target);
      adjustment.add_transition('value', t);
    } else {
      adjustment.value = target;
    }
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
    // Skip only when the pill is already shown at this target. The `visible`
    // check forces a (re)placement after the pill was hidden (no current
    // label), even if the target happens to match the pre-hide one.
    if (this._pill.visible && unchanged) return;

    const wasVisible = this._pill.visible;
    this._pillTarget = target;
    this._pill.show();
    this._pill.remove_all_transitions();

    if (this._shouldAnimatePill && wasVisible) {
      // Pill keeps its previous geometry; ease it toward the new label box.
      this._pill.ease({
        x: target.x, y: target.y, width: target.w, height: target.h,
        duration: ANIM_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    } else {
      this._pill.set_size(target.w, target.h);
      this._pill.set_position(target.x, target.y);
    }
  }
});

export default WorkspaceBar;
