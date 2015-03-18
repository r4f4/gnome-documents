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

const Gd = imports.gi.Gd;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Tracker = imports.gi.Tracker;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const Application = imports.application;
const Manager = imports.manager;
const Tweener = imports.tweener.tweener;
const Utils = imports.utils;

const Searchbar = new Lang.Class({
    Name: 'Searchbar',

    _init: function() {
        this.searchChangeBlocked = false;

        this.widget = new Gtk.SearchBar();

        // subclasses will create this._searchEntry and this._searchContainer
        // GtkWidgets
        this.createSearchWidgets();

        this.widget.add(this._searchContainer);
        this.widget.connect_entry(this._searchEntry);

        this._searchEntry.connect('search-changed', Lang.bind(this,
            function() {
                if (this.searchChangeBlocked)
                    return;

                this.entryChanged();
            }));
        this.widget.connect('notify::search-mode-enabled', Lang.bind(this,
            function() {
                let searchEnabled = this.widget.search_mode_enabled;
                Application.application.change_action_state('search', GLib.Variant.new('b', searchEnabled));
            }));

        // connect to the search action state for visibility
        let searchStateId = Application.application.connect('action-state-changed::search',
            Lang.bind(this, this._onActionStateChanged));
        this._onActionStateChanged(Application.application, 'search', Application.application.get_action_state('search'));

        this.widget.connect('destroy', Lang.bind(this,
            function() {
                Application.application.disconnect(searchStateId);
                Application.application.change_action_state('search', GLib.Variant.new('b', false));
            }));

        this.widget.show_all();
    },

    _onActionStateChanged: function(source, actionName, state) {
        if (state.get_boolean())
            this.show();
        else
            this.hide();
    },

    createSearchWidgets: function() {
        log('Error: Searchbar implementations must override createSearchWidgets');
    },

    entryChanged: function() {
        log('Error: Searchbar implementations must override entryChanged');
    },

    destroy: function() {
        this.widget.destroy();
    },

    handleEvent: function(event) {
        // Skip if the search bar is shown and the focus is elsewhere
        if (this.widget.search_mode_enabled && !this._searchEntry.is_focus)
            return false;

        let keyval = event.get_keyval()[1];
        if (this.widget.search_mode_enabled && keyval == Gdk.KEY_Return) {
            this.emit('activate-result');
            return true;
        }

        return this.widget.handle_event(event);
    },

    show: function() {
        this.widget.search_mode_enabled = true;
    },

    hide: function() {
        this.widget.search_mode_enabled = false;

        // clear all the search properties when hiding the entry
        this._searchEntry.set_text('');
    }
});
Signals.addSignalMethods(Searchbar.prototype);

const Dropdown = new Lang.Class({
    Name: 'Dropdown',
    Extends: Gtk.Popover,

    _init: function(relativeTo) {
        this.parent({ relative_to: relativeTo, position: Gtk.PositionType.BOTTOM });

        let grid = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL,
                                  row_homogeneous: true });
        this.add(grid);

        [Application.sourceManager,
         Application.searchTypeManager,
         Application.searchMatchManager].forEach(Lang.bind(this, function(manager) {
             let model = new Manager.BaseModel(manager);

             // HACK: see https://bugzilla.gnome.org/show_bug.cgi?id=733977
             let popover = new Gtk.Popover();
             popover.bind_model(model.model, 'app');
             let w = popover.get_child();
             w.reparent(grid);
             w.valign = Gtk.Align.START;
             w.vexpand = true;
             popover.destroy();
         }));
    }
});

const OverviewSearchbar = new Lang.Class({
    Name: 'OverviewSearchbar',
    Extends: Searchbar,

    _init: function() {
        this._selectAll = Application.application.lookup_action('select-all');

        this.parent();

        this._sourcesId = Application.sourceManager.connect('active-changed',
            Lang.bind(this, this._onActiveSourceChanged));
        this._searchTypeId = Application.searchTypeManager.connect('active-changed',
            Lang.bind(this, this._onActiveTypeChanged));
        this._searchMatchId = Application.searchMatchManager.connect('active-changed',
            Lang.bind(this, this._onActiveMatchChanged));
        this._collectionId = Application.documentManager.connect('active-collection-changed',
            Lang.bind(this, this._onActiveCollectionChanged));

        this._onActiveSourceChanged();
        this._onActiveTypeChanged();
        this._onActiveMatchChanged();

        this._searchEntry.set_text(Application.searchController.getString());
    },

    createSearchWidgets: function() {
        // create the search entry
        this._searchEntry = new Gd.TaggedEntry({ width_request: 500 });
        this._searchEntry.connect('tag-clicked',
            Lang.bind(this, this._onTagClicked));
        this._searchEntry.connect('tag-button-clicked',
            Lang.bind(this, this._onTagButtonClicked));

        this._sourceTag = new Gd.TaggedEntryTag();
        this._typeTag = new Gd.TaggedEntryTag();
        this._matchTag = new Gd.TaggedEntryTag();

        // connect to search string changes in the controller
        this._searchChangedId = Application.searchController.connect('search-string-changed',
            Lang.bind(this, this._onSearchStringChanged));

        this._searchEntry.connect('destroy', Lang.bind(this,
            function() {
                Application.searchController.disconnect(this._searchChangedId);
            }));

        // create the dropdown button
        this._dropdownButton = new Gtk.ToggleButton(
            { child: new Gtk.Arrow({ arrow_type: Gtk.ArrowType.DOWN }) });
        this._dropdownButton.get_style_context().add_class('raised');
        this._dropdownButton.get_style_context().add_class('image-button');
        this._dropdownButton.connect('toggled', Lang.bind(this,
            function() {
                let active = this._dropdownButton.get_active();
                if(active)
                    this._dropdown.show_all();
            }));

        this._dropdown = new Dropdown(this._dropdownButton);
        this._dropdown.connect('closed', Lang.bind(this,
            function() {
                this._dropdownButton.set_active(false);
            }));

        this._searchContainer = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                              halign: Gtk.Align.CENTER });
        this._searchContainer.get_style_context().add_class('linked');

        this._searchContainer.add(this._searchEntry);
        this._searchContainer.add(this._dropdownButton);
        this._searchContainer.show_all();
    },

    entryChanged: function() {
        let currentText = this._searchEntry.get_text();

        Application.searchController.disconnect(this._searchChangedId);
        Application.searchController.setString(currentText);

        // connect to search string changes in the controller
        this._searchChangedId = Application.searchController.connect('search-string-changed',
            Lang.bind(this, this._onSearchStringChanged));
    },

    _onSearchStringChanged: function(controller, string) {
        this._searchEntry.set_text(string);
    },

    _onActiveCollectionChanged: function() {
        let searchType = Application.searchTypeManager.getActiveItem();

        if (Application.searchController.getString() != '' ||
            searchType.id != 'all') {
            Application.searchTypeManager.setActiveItemById('all');
            this._searchEntry.set_text('');
        }
    },

    _onActiveChangedCommon: function(id, manager, tag) {
        let item = manager.getActiveItem();

        if (item.id == 'all') {
            this._searchEntry.remove_tag(tag);
        } else {
            tag.set_label(item.name);
            this._searchEntry.add_tag(tag);
        }

        this._searchEntry.grab_focus_without_selecting();
    },

    _onActiveSourceChanged: function() {
        this._onActiveChangedCommon('source', Application.sourceManager, this._sourceTag);
    },

    _onActiveTypeChanged: function() {
        this._onActiveChangedCommon('type', Application.searchTypeManager, this._typeTag);
    },

    _onActiveMatchChanged: function() {
        this._onActiveChangedCommon('match', Application.searchMatchManager, this._matchTag);
    },

    _onTagButtonClicked: function(entry, tag) {
        let manager = null;

        if (tag == this._matchTag) {
            manager = Application.searchMatchManager;
        } else if (tag == this._typeTag) {
            manager = Application.searchTypeManager;
        } else if (tag == this._sourceTag) {
            manager = Application.sourceManager;
        }

        if (manager) {
            manager.setActiveItemById('all');
        }
    },

    _onTagClicked: function() {
        this._dropdownButton.set_active(true);
    },

    destroy: function() {
        if (this._sourcesId != 0) {
            Application.sourceManager.disconnect(this._sourcesId);
            this._sourcesId = 0;
        }

        if (this._searchTypeId != 0) {
            Application.searchTypeManager.disconnect(this._searchTypeId);
            this._searchTypeId = 0;
        }

        if (this._searchMatchId != 0) {
            Application.searchMatchManager.disconnect(this._searchMatchId);
            this._searchMatchId = 0;
        }

        if (this._collectionId != 0) {
            Application.documentManager.disconnect(this._collectionId);
            this._collectionId = 0;
        }

        this.parent();
    },

    show: function() {
        this._selectAll.enabled = false;
        this.parent();
    },

    hide: function() {
        this._dropdownButton.set_active(false);
        this._selectAll.enabled = true;

        Application.searchTypeManager.setActiveItemById('all');
        Application.searchMatchManager.setActiveItemById('all');
        Application.sourceManager.setActiveItemById('all');

        this.parent();
    }
});
