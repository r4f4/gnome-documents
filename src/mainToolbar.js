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

const Gd = imports.gi.Gd;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Pango = imports.gi.Pango;

const Gettext = imports.gettext;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const Searchbar = imports.searchbar;

const MainToolbar = new Lang.Class({
    Name: 'MainToolbar',

    _init: function() {
        this._model = null;
        this._handleEvent = true;

        this.widget = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
        this.widget.show();

        this.toolbar = new Gtk.HeaderBar({ hexpand: true });
        this.toolbar.get_style_context().add_class('titlebar');
        this.widget.add(this.toolbar);
        this.toolbar.show();

        this.searchbar = this.createSearchbar();
        if (this.searchbar)
            this.widget.add(this.searchbar.widget);

        Application.documentManager.connect('load-started', Lang.bind(this,
            function() {
                this._handleEvent = true;
            }));

        Application.documentManager.connect('load-error', Lang.bind(this, this._onLoadErrorOrPassword));
        Application.documentManager.connect('password-needed', Lang.bind(this, this._onLoadErrorOrPassword));
    },

    _onLoadErrorOrPassword: function() {
        this._handleEvent = false;
    },

    handleEvent: function(event) {
        if (!this._handleEvent)
            return false;

        let res = this.searchbar.handleEvent(event);
        return res;
    },

    addSearchButton: function() {
        let searchButton = new Gtk.ToggleButton({ image: new Gtk.Image ({ icon_name: 'edit-find-symbolic' }),
                                                  tooltip_text: _("Search"),
                                                  action_name: 'app.search' });
        this.toolbar.pack_end(searchButton);
        return searchButton;
    },

    addBackButton: function() {
        let backButton = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'go-previous-symbolic' }),
                                          tooltip_text: _("Back") });
        this.toolbar.pack_start(backButton);
        return backButton;
    }
});

const OverviewToolbar = new Lang.Class({
    Name: 'OverviewToolbar',
    Extends: MainToolbar,

    _init: function(overlay, stack) {
        this._overlay = overlay;
        this._collBackButton = null;
        this._collectionId = 0;
        this._selectionChangedId = 0;
        this._viewGridButton = null;
        this._viewListButton = null;
        this._viewSettingsId = 0;

        this.parent();

        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/documents/selection-menu.ui');
        let selectionMenu = builder.get_object('selection-menu');
        this._selectionMenu = new Gtk.MenuButton({ menu_model: selectionMenu });
        this._selectionMenu.get_style_context().add_class('selection-menu');

        this._stackSwitcher = new Gtk.StackSwitcher({ no_show_all: true,
                                                      stack: stack });
        this._stackSwitcher.show();

        // setup listeners to mode changes that affect the toolbar layout
        this._selectionModeId = Application.selectionController.connect('selection-mode-changed',
            Lang.bind(this, this._resetToolbarMode));
        this._resetToolbarMode();

        this.widget.connect('destroy', Lang.bind(this,
            function() {
                this._clearStateData();

                if (this._selectionModeId != 0) {
                    Application.selectionController.disconnect(this._selectionModeId);
                    this._selectionModeId = 0;
                }
            }));
    },

    _addViewAsButtons: function() {
        let viewAsBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                      spacing: 0 });
        viewAsBox.get_style_context().add_class('linked');
        this.toolbar.pack_end(viewAsBox);

        this._viewListButton = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'view-list-symbolic' }),
                                                tooltip_text: _("View items as a list"),
                                                no_show_all: true,
                                                action_name: 'app.view-as',
                                                action_target: GLib.Variant.new('s', 'list') });
        viewAsBox.add(this._viewListButton);
        this._viewGridButton = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'view-grid-symbolic' }),
                                                tooltip_text: _("View items as a grid of icons"),
                                                no_show_all: true,
                                                action_name: 'app.view-as',
                                                action_target: GLib.Variant.new('s', 'icon') });
        viewAsBox.add(this._viewGridButton);

        this._viewSettingsId = Application.settings.connect('changed::view-as',
            Lang.bind(this, this._updateViewAsButtons));
        this._updateViewAsButtons();
    },

    _updateViewAsButtons: function() {
        let viewType = Application.settings.get_enum('view-as');
        this._viewGridButton.visible = (viewType != Gd.MainViewType.ICON);
        this._viewListButton.visible = (viewType != Gd.MainViewType.LIST);
    },

    _setToolbarTitle: function() {
        let selectionMode = Application.selectionController.getSelectionMode();
        let activeCollection = Application.documentManager.getActiveCollection();
        let primary = null;

        if (!selectionMode) {
            if (activeCollection)
                primary = activeCollection.name;
        } else {
            let length = Application.selectionController.getSelection().length;
            let label = null;

            if (length == 0)
                label = _("Click on items to select them");
            else
                label = Gettext.ngettext("%d selected",
                                         "%d selected",
                                         length).format(length);

            if (activeCollection)
                primary = ("<b>%s</b>  (%s)").format(activeCollection.name, label);
            else
                primary = label;
        }

        if (selectionMode) {
            if (primary) {
                this._selectionMenu.set_label(primary);
                this._selectionMenu.get_child().use_markup = true;
            }
        } else {
            this.toolbar.set_title(primary);
        }
    },

    _populateForSelectionMode: function() {
        this.toolbar.get_style_context().add_class('selection-mode');
        this.toolbar.set_custom_title(this._selectionMenu);

        let selectionButton = new Gtk.Button({ label: _("Cancel") });
        this.toolbar.pack_end(selectionButton);
        selectionButton.connect('clicked', Lang.bind(this,
            function() {
                Application.selectionController.setSelectionMode(false);
            }));

        // connect to selection changes while in this mode
        this._selectionChangedId =
            Application.selectionController.connect('selection-changed',
                                               Lang.bind(this, this._setToolbarTitle));

        this.addSearchButton();
    },

    _checkCollectionBackButton: function() {
        let item = Application.documentManager.getActiveCollection();

        if (item && !this._collBackButton) {
            this._collBackButton = this.addBackButton();
            this._collBackButton.show();
            this._collBackButton.connect('clicked', Lang.bind(this,
                function() {
                    Application.documentManager.activatePreviousCollection();
                }));
        } else if (!item && this._collBackButton) {
            this._collBackButton.destroy();
            this._collBackButton = null;
        }
    },

    _onActiveCollectionChanged: function() {
        this._checkCollectionBackButton();
        this._setToolbarTitle();
        Application.application.change_action_state('search', GLib.Variant.new('b', false));
    },

    _populateForOverview: function() {
        this.toolbar.set_show_close_button(true);
        this.toolbar.set_custom_title(this._stackSwitcher);
        this._checkCollectionBackButton();

        let selectionButton = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'object-select-symbolic' }),
                                               tooltip_text: _("Select Items") });
        this.toolbar.pack_end(selectionButton);
        selectionButton.connect('clicked', Lang.bind(this,
            function() {
                Application.selectionController.setSelectionMode(true);
            }));

        this._addViewAsButtons();
        this.addSearchButton();

        // connect to active collection changes while in this mode
        this._collectionId =
            Application.documentManager.connect('active-collection-changed',
                                             Lang.bind(this, this._onActiveCollectionChanged));
    },

    _clearStateData: function() {
        this._collBackButton = null;
        this._viewGridButton = null;
        this._viewListButton = null;
        this.toolbar.set_custom_title(null);

        if (this._collectionId != 0) {
            Application.documentManager.disconnect(this._collectionId);
            this._collectionId = 0;
        }

        if (this._selectionChangedId != 0) {
            Application.selectionController.disconnect(this._selectionChangedId);
            this._selectionChangedId = 0;
        }

        if (this._viewSettingsId != 0) {
            Application.settings.disconnect(this._viewSettingsId);
            this._viewSettingsId = 0;
        }
    },

    _clearToolbar: function() {
        this._clearStateData();
        this.toolbar.set_show_close_button(false);

        this.toolbar.get_style_context().remove_class('selection-mode');
        let children = this.toolbar.get_children();
        children.forEach(function(child) { child.destroy(); });
    },

    _resetToolbarMode: function() {
        this._clearToolbar();

        let selectionMode = Application.selectionController.getSelectionMode();
        if (selectionMode)
            this._populateForSelectionMode();
        else
            this._populateForOverview();

        this._setToolbarTitle();
        this.toolbar.show_all();

        if (Application.searchController.getString() != '')
            Application.application.change_action_state('search', GLib.Variant.new('b', true));
    },

    createSearchbar: function() {
        return new Searchbar.OverviewSearchbar();
    }
});
