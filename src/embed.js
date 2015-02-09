/*
 * Copyright (c) 2011, 2013 Red Hat, Inc.
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

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const MainToolbar = imports.mainToolbar;
const Notifications = imports.notifications;
const Password = imports.password;
const Preview = imports.preview;
const Edit = imports.edit;
const Selections = imports.selections;
const View = imports.view;
const WindowMode = imports.windowMode;
const Documents = imports.documents;

const EvView = imports.gi.EvinceView;
const Gd = imports.gi.Gd;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const _ICON_SIZE = 128;
const _PDF_LOADER_TIMEOUT = 400;

const SpinnerBox = new Lang.Class({
    Name: 'SpinnerBox',

    _init: function() {
        this.widget = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                     row_spacing: 24,
                                     hexpand: true,
                                     vexpand: true,
                                     halign: Gtk.Align.CENTER,
                                     valign: Gtk.Align.CENTER });

        this._spinner = new Gtk.Spinner({ width_request: _ICON_SIZE,
                                          height_request: _ICON_SIZE,
                                          halign: Gtk.Align.CENTER,
                                          valign: Gtk.Align.CENTER });
        this.widget.add(this._spinner);

        this.widget.show_all();
    },

    start: function() {
        this._spinner.start();
    },

    stop: function() {
        this._spinner.stop();
    }
});

const Embed = new Lang.Class({
    Name: 'Embed',

    _init: function() {
        this._queryErrorId = 0;
        this._noResultsChangeId = 0;
        this._loadShowId = 0;

        this.widget = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL,
                                    visible: true });

        let toplevel = Application.application.get_windows()[0];
        this._titlebar = new Gtk.Grid({ visible: true });
        toplevel.set_titlebar(this._titlebar);

        // create the toolbar for selected items, it's hidden by default
        this._selectionToolbar = new Selections.SelectionToolbar();
        this.widget.pack_end(this._selectionToolbar.widget, false, false, 0);

        this._stackOverlay = new Gtk.Overlay({ visible: true });
        this.widget.pack_end(this._stackOverlay, true, true, 0);

        this._stack = new Gtk.Stack({ visible: true,
                                      homogeneous: true,
                                      transition_type: Gtk.StackTransitionType.CROSSFADE });
        this._stackOverlay.add(this._stack);

        // pack the OSD notification widget
        this._stackOverlay.add_overlay(Application.notificationManager.widget);

        // now create the actual content widgets
        this._view = new View.ViewContainer();
        this._stack.add_named(this._view.widget, 'view');

        this._preview = new Preview.PreviewView(this._stackOverlay);
        this._stack.add_named(this._preview.widget, 'preview');

        this._edit = new Edit.EditView(this._stackOverlay);
        this._stack.add_named(this._edit.widget, 'edit');

        this._spinnerBox = new SpinnerBox();
        this._stack.add_named(this._spinnerBox.widget, 'spinner');

        Application.modeController.connect('window-mode-changed',
                                           Lang.bind(this, this._onWindowModeChanged));

        Application.modeController.connect('fullscreen-changed',
                                           Lang.bind(this, this._onFullscreenChanged));
        Application.trackerController.connect('query-status-changed',
                                              Lang.bind(this, this._onQueryStatusChanged));

        Application.documentManager.connect('active-changed',
                                            Lang.bind(this, this._onActiveItemChanged));
        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-finished',
                                            Lang.bind(this, this._onLoadFinished));
        Application.documentManager.connect('load-error',
                                            Lang.bind(this, this._onLoadError));
        Application.documentManager.connect('password-needed',
                                            Lang.bind(this, this._onPasswordNeeded));

        this._onQueryStatusChanged();

        let windowMode = Application.modeController.getWindowMode();
        if (windowMode != WindowMode.WindowMode.NONE)
            this._onWindowModeChanged(Application.modeController, windowMode, WindowMode.WindowMode.NONE);
    },

    _onActivateResult: function() {
        let windowMode = Application.modeController.getWindowMode();

        if (windowMode == WindowMode.WindowMode.OVERVIEW)
            this._view.activateResult();
        else if (windowMode == WindowMode.WindowMode.PREVIEW)
            this._preview.activateResult();
    },

    _onQueryStatusChanged: function() {
        let windowMode = Application.modeController.getWindowMode();
        if (windowMode != WindowMode.WindowMode.OVERVIEW)
            return;

        let queryStatus = Application.trackerController.getQueryStatus();

        if (queryStatus) {
            this._spinnerBox.start();
            this._stack.set_visible_child_name('spinner');
        } else {
            this._spinnerBox.stop();
            this._stack.set_visible_child_name('view');
        }
    },

    _onFullscreenChanged: function(controller, fullscreen) {
        this._toolbar.widget.visible = !fullscreen;
        this._toolbar.widget.sensitive = !fullscreen;
    },

    _onWindowModeChanged: function(object, newMode, oldMode) {
        switch (newMode) {
        case WindowMode.WindowMode.OVERVIEW:
            this._prepareForOverview();
            break;
        case WindowMode.WindowMode.PREVIEW:
            if (oldMode == WindowMode.WindowMode.EDIT)
                Application.documentManager.reloadActiveItem();
            this._prepareForPreview();
            break;
        case WindowMode.WindowMode.EDIT:
            this._prepareForEdit();
            break;
        case WindowMode.WindowMode.NONE:
            break;
         default:
            throw(new Error('Not handled'));
            break;
        }

        if (this._toolbar.searchbar) {
            this._toolbar.searchbar.connect('activate-result',
                                            Lang.bind(this, this._onActivateResult));
        }
    },

    _onActiveItemChanged: function(manager, doc) {
    },

    _clearLoadTimer: function() {
        if (this._loadShowId != 0) {
            Mainloop.source_remove(this._loadShowId);
            this._loadShowId = 0;
        }
    },

    _onLoadStarted: function() {
        Application.modeController.setWindowMode(WindowMode.WindowMode.PREVIEW);

        this._clearLoadTimer();
        this._loadShowId = Mainloop.timeout_add(_PDF_LOADER_TIMEOUT, Lang.bind(this,
            function() {
                this._loadShowId = 0;

                this._stack.set_visible_child_name('spinner');
                this._spinnerBox.start();
                return false;
            }));
    },

    _onLoadFinished: function(manager, doc, docModel) {
        if (!Application.application.isBooks)
            docModel.set_sizing_mode(EvView.SizingMode.AUTOMATIC);
        else
            docModel.set_sizing_mode(EvView.SizingMode.FIT_PAGE);
        docModel.set_page_layout(EvView.PageLayout.AUTOMATIC);
        this._toolbar.setModel(docModel);
        this._preview.setModel(docModel);
        this._preview.widget.grab_focus();

        this._clearLoadTimer();
        this._spinnerBox.stop();
        this._stack.set_visible_child_name('preview');
    },

    _onLoadError: function(manager, doc, message, exception) {
        this._clearLoadTimer();
        this._spinnerBox.stop();
    },

    _onPasswordNeeded: function(manager, doc) {
        this._clearLoadTimer();
        this._spinnerBox.stop();

        let dialog = new Password.PasswordDialog(doc);
        dialog.widget.connect('response', Lang.bind(this,
            function(widget, response) {
                dialog.widget.destroy();
                if (response == Gtk.ResponseType.CANCEL || response == Gtk.ResponseType.DELETE_EVENT)
                    Application.documentManager.setActiveItem(null);
            }));
    },

    _prepareForOverview: function() {
        if (this._preview)
            this._preview.reset();
        if (this._edit)
            this._edit.setUri(null);
        if (this._toolbar)
            this._toolbar.widget.destroy();

        // pack the toolbar
        this._toolbar = new MainToolbar.OverviewToolbar(this._stackOverlay, this._stack);
        this._titlebar.add(this._toolbar.widget);

        this._spinnerBox.stop();
        this._stack.set_visible_child_name('view');
    },

    _prepareForPreview: function() {
        if (this._edit)
            this._edit.setUri(null);
        if (this._toolbar)
            this._toolbar.widget.destroy();

        // pack the toolbar
        this._toolbar = new Preview.PreviewToolbar(this._preview);
        this._titlebar.add(this._toolbar.widget);

        this._stack.set_visible_child_name('preview');
    },

    _prepareForEdit: function() {
        if (this._preview)
            this._preview.setModel(null);
        if (this._toolbar)
            this._toolbar.widget.destroy();

        // pack the toolbar
        this._toolbar = new Edit.EditToolbar(this._preview);
        this._titlebar.add(this._toolbar.widget);

        this._stack.set_visible_child_name('edit');
    },

    getMainToolbar: function() {
        let windowMode = Application.modeController.getWindowMode();
        let fullscreen = Application.modeController.getFullscreen();

        if (fullscreen && (windowMode == WindowMode.WindowMode.PREVIEW))
            return this._preview.getFullscreenToolbar();
        else
            return this._toolbar;
    },

    getPreview: function() {
        return this._preview;
    }
});
