/*
 * Copyright (c) 2011 Red Hat, Inc.
 *
 * Gnome Documents is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gnome Documents is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const Embed = imports.embed;
const Selections = imports.selections;
const Utils = imports.utils;
const WindowMode = imports.windowMode;

const _ = imports.gettext.gettext;

const _CONFIGURE_ID_TIMEOUT = 100; // msecs
const _WINDOW_MIN_WIDTH = 600;
const _WINDOW_MIN_HEIGHT = 500;

const MainWindow = new Lang.Class({
    Name: 'MainWindow',
    Extends: Gtk.ApplicationWindow,

    _init: function(app) {
        this._configureId = 0;

        this.parent({ application: app,
                      width_request: _WINDOW_MIN_WIDTH,
                      height_request: _WINDOW_MIN_HEIGHT,
                      window_position: Gtk.WindowPosition.CENTER,
                      show_menubar: false,
                      title: _("Documents") });

        // apply the last saved window size and position
        let size = Application.settings.get_value('window-size');
        if (size.n_children() == 2) {
            let width = size.get_child_value(0);
            let height = size.get_child_value(1);

            this.set_default_size(width.get_int32(), height.get_int32());
        }

        let position = Application.settings.get_value('window-position');
        if (position.n_children() == 2) {
            let x = position.get_child_value(0);
            let y = position.get_child_value(1);

            this.move(x.get_int32(), y.get_int32());
        }

        if (Application.settings.get_boolean('window-maximized'))
            this.maximize();

        this.connect('delete-event', Lang.bind(this, this._quit));
        this.connect('button-press-event', Lang.bind(this, this._onButtonPressEvent));
        this.connect('key-press-event', Lang.bind(this, this._onKeyPressEvent));
        this.connect('configure-event', Lang.bind(this, this._onConfigureEvent));
        this.connect('window-state-event', Lang.bind(this, this._onWindowStateEvent));

        this._fsId = Application.modeController.connect('fullscreen-changed',
            Lang.bind(this, this._onFullscreenChanged));

        this._embed = new Embed.Embed();
        this.add(this._embed);
    },

    _saveWindowGeometry: function() {
        let window = this.get_window();
        let state = window.get_state();

        if (state & Gdk.WindowState.MAXIMIZED)
            return;

        // GLib.Variant.new() can handle arrays just fine
        let size = this.get_size();
        let variant = GLib.Variant.new ('ai', size);
        Application.settings.set_value('window-size', variant);

        let position = this.get_position();
        variant = GLib.Variant.new ('ai', position);
        Application.settings.set_value('window-position', variant);
    },

    _onConfigureEvent: function(widget, event) {
        if (Application.modeController.getFullscreen())
            return;

        if (this._configureId != 0) {
            Mainloop.source_remove(this._configureId);
            this._configureId = 0;
        }

        this._configureId = Mainloop.timeout_add(_CONFIGURE_ID_TIMEOUT, Lang.bind(this,
            function() {
                this._configureId = 0;
                this._saveWindowGeometry();
                return false;
            }));
    },

    _onWindowStateEvent: function(widget, event) {
        let window = widget.get_window();
        let state = window.get_state();

        if (state & Gdk.WindowState.FULLSCREEN) {
            Application.modeController.setFullscreen(true);
            return;
        }

        Application.modeController.setFullscreen(false);

        let maximized = (state & Gdk.WindowState.MAXIMIZED);
        Application.settings.set_boolean('window-maximized', maximized);
    },

    _onFullscreenChanged: function(controller, fullscreen) {
        if (fullscreen)
            this.fullscreen();
        else
            this.unfullscreen();
    },

    _goBack: function() {
        let windowMode = Application.modeController.getWindowMode();
        let activeCollection = Application.documentManager.getActiveCollection();
        let handled = true;

        switch (windowMode) {
        case WindowMode.WindowMode.NONE:
        case WindowMode.WindowMode.DOCUMENTS:
            handled = false;
            break;
        case WindowMode.WindowMode.EDIT:
        case WindowMode.WindowMode.PREVIEW:
            Application.documentManager.setActiveItem(null);
            Application.modeController.goBack();
            break;
        case WindowMode.WindowMode.COLLECTIONS:
        case WindowMode.WindowMode.SEARCH:
            if (activeCollection)
                Application.documentManager.activatePreviousCollection();
            break;
        default:
            throw(new Error('Not handled'));
            break;
        }

        return handled;
    },

    _onButtonPressEvent: function(widget, event) {
        let button = event.get_button()[1];
        let clickCount = event.get_click_count()[1];

        if (clickCount > 1)
            return false;

        // mouse back button
        if (button != 8)
            return false;

        return this._goBack();
    },

    _onKeyPressEvent: function(widget, event) {
        if (this._handleBackKey(event))
            return true;

        let toolbar = this._embed.getMainToolbar();
        if (toolbar.handleEvent(event))
            return true;

        switch (Application.modeController.getWindowMode()) {
        case WindowMode.WindowMode.NONE:
            return false;
        case WindowMode.WindowMode.PREVIEW:
            return this._handleKeyPreview(event);
        case WindowMode.WindowMode.COLLECTIONS:
        case WindowMode.WindowMode.DOCUMENTS:
        case WindowMode.WindowMode.SEARCH:
            return this._handleKeyOverview(event);
        case WindowMode.WindowMode.EDIT:
        case WindowMode.WindowMode.PREVIEW_LOK: //FIXME should be same as preview
            return false;
        default:
            throw(new Error('Not handled'));
            break;
        }

        return false;
    },

    _isBackKey: function(event) {
        let direction = this.get_direction();
        let keyval = event.get_keyval()[1];
        let state = event.get_state()[1];

        let isBack = (((state & Gdk.ModifierType.MOD1_MASK) != 0 &&
                       ((direction == Gtk.TextDirection.LTR && keyval == Gdk.KEY_Left) ||
                       (direction == Gtk.TextDirection.RTL && keyval == Gdk.KEY_Right))) ||
                      keyval == Gdk.KEY_Back);

        return isBack;
    },

    _handleBackKey: function(event) {
        let isBack = this._isBackKey(event);
        if (!isBack)
            return false;

        return this._goBack();
    },

    _handleKeyPreview: function(event) {
        let keyval = event.get_keyval()[1];
        let fullscreen = Application.modeController.getFullscreen();
        let def_mod_mask = Gtk.accelerator_get_default_mod_mask();
        let preview = this._embed.getPreview();
        let state = event.get_state()[1];

        if (keyval == Gdk.KEY_Escape) {
            let model = preview.getModel();

            if (preview.controlsVisible && (model != null)) {
                preview.controlsVisible = false;
            } else if (fullscreen) {
                Application.documentManager.setActiveItem(null);
                Application.modeController.goBack();
            }

            return false;
        }

        if (((keyval == Gdk.KEY_Page_Up) &&
            ((state & Gdk.ModifierType.CONTROL_MASK) != 0)) ||
            ((keyval == Gdk.KEY_Left) && ((state & def_mod_mask) == 0))) {
            preview.view.previous_page();
            return true;
        }

        if (((keyval == Gdk.KEY_Page_Down) &&
            ((state & Gdk.ModifierType.CONTROL_MASK) != 0)) ||
            ((keyval == Gdk.KEY_Right) && ((state & def_mod_mask) == 0))) {
            preview.view.next_page();
            return true;
        }

        if (keyval == Gdk.KEY_Page_Up) {
            preview.view.scroll(Gtk.ScrollType.PAGE_BACKWARD, false);
            return true;
        }

        if (keyval == Gdk.KEY_space ||
            keyval == Gdk.KEY_Page_Down) {
            preview.view.scroll(Gtk.ScrollType.PAGE_FORWARD, false);
            return true;
        }

        return false;
    },

    _handleKeyOverview: function(event) {
        let keyval = event.get_keyval()[1];

        if (Application.selectionController.getSelectionMode() &&
            keyval == Gdk.KEY_Escape) {
            Application.selectionController.setSelectionMode(false);
            return true;
        }

        return false;
    },

    _quit: function() {
        // remove configure event handler if still there
        if (this._configureId != 0) {
            Mainloop.source_remove(this._configureId);
            this._configureId = 0;
        }

        // always save geometry before quitting
        this._saveWindowGeometry();

        return false;
    },

    showAbout: function(isBooks) {
        GdPrivate.show_about_dialog(this, isBooks);
    }
});
