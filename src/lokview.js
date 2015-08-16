/*
 * Copyright (c) 2015 Pranav Kant
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
 * Author: Pranav Kant <pranavk@gnome.org>
 *
 */

const LOKDocView = imports.gi.LOKDocView;
const WebKit = imports.gi.WebKit2;
const Soup = imports.gi.Soup;
const Gd = imports.gi.Gd;
const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const Application = imports.application;
const MainToolbar = imports.mainToolbar;
const Searchbar = imports.searchbar;
const Utils = imports.utils;
const View = imports.view;
const WindowMode = imports.windowMode;
const Documents = imports.documents;

// FIXME: Find this path dynamically
const LO_PATH = '/opt/libreoffice/instdir/program'

const LOKView = new Lang.Class({
    Name: 'LOKView',
    Extends: Gtk.Overlay,

    _init: function() {
        this._uri = null;

        this.parent();
        this.get_style_context().add_class('documents-scrolledwin');

        this._sw = new Gtk.ScrolledWindow({hexpand: true,
                                           vexpand: true});

        this._progressBar = new Gtk.ProgressBar({ halign: Gtk.Align.FILL,
                                                  valign: Gtk.Align.START });
        this._progressBar.get_style_context().add_class('osd');
        this.add_overlay(this._progressBar);

        this.add(this._sw);
        this._createView();

        this.show_all();

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-finished',
                                            Lang.bind(this, this._onLoadFinished));

    },

    _onLoadStarted: function() {

    },

    open_document_cb: function() {
        // TODO: Call _finish and check failure
        this._progressBar.hide();
        this.view.show();
    },

    _onLoadFinished: function(manager, doc, docModel) {
        if (docModel == null && doc != null) {
            let location = doc.uri.replace ('file://', '');
            this.view.open_document(location, null, Lang.bind(this, this.open_document_cb), null);
            this._progressBar.show();
        }
    },

    reset: function () {
        this.view.hide()
    },

    _createView: function() {
        this.view = LOKDocView.View.new(LO_PATH, null, null);
        this._sw.add(this.view);
        this.view.connect('load-changed', Lang.bind(this, this._onProgressChanged));
    },

    _onProgressChanged: function() {
        this._progressBar.fraction = this.view.load_progress;
    },
});
Signals.addSignalMethods(LOKView.prototype);

const LOKViewToolbar = new Lang.Class({
    Name: 'LOKViewToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(lokView) {
        this._lokView = lokView;

        this.parent();
        this.toolbar.set_show_close_button(true);

        this._gearMenu = Application.application.lookup_action('gear-menu');
        this._gearMenu.enabled = true;

        // back button, on the left of the toolbar
        let backButton = this.addBackButton();
        backButton.connect('clicked', Lang.bind(this,
            function() {
                Application.documentManager.setActiveItem(null);
                Application.modeController.goBack();
            }));

        // menu button, on the right of the toolbar
        let lokViewMenu = this._getLOKViewMenu();
        let menuButton = new Gtk.MenuButton({ image: new Gtk.Image ({ icon_name: 'open-menu-symbolic' }),
                                              menu_model: lokViewMenu,
                                              action_name: 'app.gear-menu' });
        this.toolbar.pack_end(menuButton);

        // search button, on the right of the toolbar
        this.addSearchButton();

        this._setToolbarTitle();
        this.toolbar.show_all();
    },

    createSearchbar: function() {
    },

    _getLOKViewMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Documents/ui/lokview-menu.ui');
        let menu = builder.get_object('lokview-menu');

        return menu;
    },

    handleEvent: function(event) {
        return false;
    },

    _setToolbarTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.toolbar.set_title(primary);
    }
});
