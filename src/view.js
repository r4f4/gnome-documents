/*
 * Copyright (c) 2011, 2015 Red Hat, Inc.
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

const Cairo = imports.gi.cairo;
const Gd = imports.gi.Gd;
const Gdk = imports.gi.Gdk;
const Gettext = imports.gettext;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const Documents = imports.documents;
const ErrorBox = imports.errorBox;
const TrackerUtils = imports.trackerUtils;
const WindowMode = imports.windowMode;
const Utils = imports.utils;

function getController(windowMode) {
    let offsetController;
    let trackerController;

    switch (windowMode) {
    case WindowMode.WindowMode.COLLECTIONS:
        offsetController = Application.offsetCollectionsController;
        trackerController = Application.trackerCollectionsController;
        break;
    case WindowMode.WindowMode.DOCUMENTS:
        offsetController = Application.offsetDocumentsController;
        trackerController = Application.trackerDocumentsController;
        break;
    case WindowMode.WindowMode.SEARCH:
        offsetController = Application.offsetSearchController;
        trackerController = Application.trackerSearchController;
        break;
    default:
        throw(new Error('Not handled'));
        break;
    }

    return [ offsetController, trackerController ];
}

const _RESET_COUNT_TIMEOUT = 500; // msecs

const ViewModel = new Lang.Class({
    Name: 'ViewModel',

    _init: function(windowMode) {
        this.model = Gtk.ListStore.new(
            [ GObject.TYPE_STRING,
              GObject.TYPE_STRING,
              GObject.TYPE_STRING,
              GObject.TYPE_STRING,
              Cairo.Surface,
              GObject.TYPE_LONG,
              GObject.TYPE_BOOLEAN,
              GObject.TYPE_UINT ]);
        this.model.set_sort_column_id(Gd.MainColumns.MTIME,
                                      Gtk.SortType.DESCENDING);

        this._resetCountId = 0;

        this._mode = windowMode;
        this._rowRefKey = "row-ref-" + this._mode;

        Application.documentManager.connect('item-added',
            Lang.bind(this, this._onItemAdded));
        Application.documentManager.connect('item-removed',
            Lang.bind(this, this._onItemRemoved));

        [ this._offsetController, this._trackerController ] = getController(this._mode);
        this._trackerController.connect('query-status-changed', Lang.bind(this,
            function(o, status) {
                if (!status)
                    return;
                this._clear();
            }));
    },

    _clear: function() {
        let items = Application.documentManager.getItems();
        for (let idx in items) {
            let doc = items[idx];
            doc.rowRefs[this._rowRefKey] = null;
        }

        this.model.clear();
    },

    _addItem: function(doc) {
        // Update the count so that OffsetController has the correct
        // values. Otherwise things like loading more items and "No
        // Results" page will not work correctly.
        this._resetCount();

        let iter = this.model.append();
        this.model.set(iter,
            [ 0, 1, 2, 3, 4, 5 ],
            [ doc.id, doc.uri, doc.name,
              doc.author, doc.surface, doc.mtime ]);

        let treePath = this.model.get_path(iter);
        let treeRowRef = Gtk.TreeRowReference.new(this.model, treePath);
        doc.rowRefs[this._rowRefKey] = treeRowRef;

        doc.connect('info-updated', Lang.bind(this, this._onInfoUpdated));
    },

    _removeItem: function(doc) {
        // Update the count so that OffsetController has the correct
        // values. Otherwise things like loading more items and "No
        // Results" page will not work correctly.
        this._resetCount();

        this.model.foreach(Lang.bind(this,
            function(model, path, iter) {
                let id = model.get_value(iter, Gd.MainColumns.ID);

                if (id == doc.id) {
                    this.model.remove(iter);
                    return true;
                }

                return false;
            }));

        doc.rowRefs[this._rowRefKey] = null;
    },

    _onInfoUpdated: function(doc) {
        let activeCollection = Application.documentManager.getActiveCollection();
        let treeRowRef = doc.rowRefs[this._rowRefKey];

        if (this._mode == WindowMode.WindowMode.COLLECTIONS) {
            if (!doc.collection && treeRowRef && !activeCollection) {
                ;
            } else if (doc.collection && !treeRowRef && !activeCollection) {
                this._addItem(doc);
            }
        } else if (this._mode == WindowMode.WindowMode.DOCUMENTS) {
            if (doc.collection && treeRowRef) {
                ;
            } else if (!doc.collection && !treeRowRef) {
                this._addItem(doc);
            }
        }

        treeRowRef = doc.rowRefs[this._rowRefKey];
        if (treeRowRef) {
            let objectPath = treeRowRef.get_path();
            if (!objectPath)
                return;

            let objectIter = this.model.get_iter(objectPath)[1];
            if (objectIter)
                this.model.set(objectIter,
                    [ 0, 1, 2, 3, 4, 5 ],
                    [ doc.id, doc.uri, doc.name,
                      doc.author, doc.surface, doc.mtime ]);
        }
    },

    _onItemAdded: function(source, doc) {
        if (doc.rowRefs[this._rowRefKey])
            return;

        let activeCollection = Application.documentManager.getActiveCollection();
        let windowMode = Application.modeController.getWindowMode();

        if (!activeCollection || this._mode != windowMode) {
            if (this._mode == WindowMode.WindowMode.COLLECTIONS && !doc.collection
                || this._mode == WindowMode.WindowMode.DOCUMENTS && doc.collection) {
                doc.connect('info-updated', Lang.bind(this, this._onInfoUpdated));
                return;
            }
        }

        this._addItem(doc);
        doc.connect('info-updated', Lang.bind(this, this._onInfoUpdated));
    },

    _onItemRemoved: function(source, doc) {
        this._removeItem(doc);
    },

    _resetCount: function() {
        if (this._resetCountId == 0) {
            this._resetCountId = Mainloop.timeout_add(_RESET_COUNT_TIMEOUT, Lang.bind(this,
                function() {
                    this._resetCountId = 0;
                    this._offsetController.resetItemCount();
                    return false;
                }));
        }
    }
});

const EmptyResultsBox = new Lang.Class({
    Name: 'EmptyResultsBox',

    _init: function() {
        this.widget = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL,
                                     column_spacing: 12,
                                     hexpand: true,
                                     vexpand: true,
                                     halign: Gtk.Align.CENTER,
                                     valign: Gtk.Align.CENTER });
        this.widget.get_style_context().add_class('dim-label');

        this._image = new Gtk.Image({ pixel_size: 64,
                                      icon_name: 'emblem-documents-symbolic' });
        this.widget.add(this._image);

        this._labelsGrid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                          row_spacing: 12 });
        this.widget.add(this._labelsGrid);

        let titleLabel = new Gtk.Label({ label: '<b><span size="large">' +
                                         (Application.application.isBooks ?
                                          _("No Books Found") :
                                          _("No Documents Found")) +
                                         '</span></b>',
                                         use_markup: true,
                                         halign: Gtk.Align.START,
                                         vexpand: true });
        this._labelsGrid.add(titleLabel);

        if (Application.sourceManager.hasOnlineSources() ||
            Application.application.isBooks) {
            titleLabel.valign = Gtk.Align.CENTER;
        } else {
            titleLabel.valign = Gtk.Align.START;
            this._addSystemSettingsLabel();
        }

        this.widget.show_all();
    },

    _addSystemSettingsLabel: function() {
        let detailsStr =
            // Translators: %s here is "Settings", which is in a separate string due to
            // markup, and should be translated only in the context of this sentence
            _("You can add your online accounts in %s").format(
            " <a href=\"system-settings\">" +
            // Translators: this should be translated in the context of the
            // "You can add your online accounts in Settings" sentence above
            _("Settings") +
            "</a>");
        let details = new Gtk.Label({ label: detailsStr,
                                      use_markup: true,
                                      halign: Gtk.Align.START,
                                      xalign: 0,
                                      max_width_chars: 24,
                                      wrap: true });
        this._labelsGrid.add(details);

        details.connect('activate-link', Lang.bind(this,
            function(label, uri) {
                if (uri != 'system-settings')
                    return false;

                try {
                    let app = Gio.AppInfo.create_from_commandline(
                        'gnome-control-center online-accounts', null, 0);

                    let screen = this.widget.get_screen();
                    let display = screen ? screen.get_display() : Gdk.Display.get_default();
                    let ctx = display.get_app_launch_context();

                    if (screen)
                        ctx.set_screen(screen);

                    app.launch([], ctx);
                } catch(e) {
                    log('Unable to launch gnome-control-center: ' + e.message);
                }

                return true;
            }));
    }
});

const ViewContainer = new Lang.Class({
    Name: 'ViewContainer',

    _init: function(windowMode) {
        this._edgeHitId = 0;
        this._mode = windowMode;

        this._model = new ViewModel(this._mode);

        this.widget = new Gtk.Stack({ homogeneous: true,
                                      transition_type: Gtk.StackTransitionType.CROSSFADE });

        let grid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL });
        this.widget.add_named(grid, 'view');

        this._noResults = new EmptyResultsBox();
        this.widget.add_named(this._noResults.widget, 'no-results');

        this._errorBox = new ErrorBox.ErrorBox();
        this.widget.add_named(this._errorBox.widget, 'error');

        this.view = new Gd.MainView({ shadow_type: Gtk.ShadowType.NONE });
        grid.add(this.view);

        this.widget.show_all();
        this.widget.set_visible_child_full('view', Gtk.StackTransitionType.NONE);

        this.view.connect('item-activated',
                            Lang.bind(this, this._onItemActivated));
        this.view.connect('selection-mode-request',
                            Lang.bind(this, this._onSelectionModeRequest));
        this.view.connect('view-selection-changed',
                            Lang.bind(this, this._onViewSelectionChanged));

        // connect to settings change for list/grid view
        this._viewSettingsId = Application.application.connect('action-state-changed::view-as',
            Lang.bind(this, this._updateTypeForSettings));
        this._updateTypeForSettings();

        // setup selection controller => view
        this._selectionModeId = Application.selectionController.connect('selection-mode-changed',
            Lang.bind(this, this._onSelectionModeChanged));
        this._onSelectionModeChanged();

        Application.modeController.connect('window-mode-changed',
            Lang.bind(this, this._onWindowModeChanged));
        this._onWindowModeChanged();

        let selectAll = Application.application.lookup_action('select-all');
        selectAll.connect('activate', Lang.bind(this,
            function() {
                this.view.select_all();
            }));

        let selectNone = Application.application.lookup_action('select-none');
        selectNone.connect('activate', Lang.bind(this,
            function() {
                this.view.unselect_all();
            }));

        [ this._offsetController, this._trackerController ] = getController(this._mode);

        this._offsetController.connect('item-count-changed', Lang.bind(this,
            function(controller, count) {
                if (count == 0)
                    this.widget.set_visible_child_name('no-results');
                else
                    this.widget.set_visible_child_name('view');
            }));

        this._trackerController.connect('query-error',
            Lang.bind(this, this._onQueryError));
        this._queryId = this._trackerController.connect('query-status-changed',
            Lang.bind(this, this._onQueryStatusChanged));
        // ensure the tracker controller is started
        this._trackerController.start();

        // this will create the model if we're done querying
        this._onQueryStatusChanged();
    },

    _updateTypeForSettings: function() {
        let viewType = Application.settings.get_enum('view-as');
        this.view.set_view_type(viewType);

        if (viewType == Gd.MainViewType.LIST)
            this._addListRenderers();
    },

    activateResult: function() {
        let doc = this._getFirstDocument();
        if (doc)
            Application.documentManager.setActiveItem(doc)
    },

    _getFirstDocument: function() {
        let doc = null;

        let iter = this._model.model.get_iter_first()[1];
        if (iter) {
            let id = this._model.model.get_value(iter, Gd.MainColumns.ID);
            doc = Application.documentManager.getItemById(id);
        }

        return doc;
    },

    _addListRenderers: function() {
        let listWidget = this.view.get_generic_view();

        let typeRenderer =
            new Gd.StyledTextRenderer({ xpad: 16 });
        typeRenderer.add_class('dim-label');
        listWidget.add_renderer(typeRenderer, Lang.bind(this,
            function(col, cell, model, iter) {
                let id = model.get_value(iter, Gd.MainColumns.ID);
                let doc = Application.documentManager.getItemById(id);

                typeRenderer.text = doc.typeDescription;
            }));

        let whereRenderer =
            new Gd.StyledTextRenderer({ xpad: 16 });
        whereRenderer.add_class('dim-label');
        listWidget.add_renderer(whereRenderer, Lang.bind(this,
            function(col, cell, model, iter) {
                let id = model.get_value(iter, Gd.MainColumns.ID);
                let doc = Application.documentManager.getItemById(id);

                whereRenderer.text = doc.sourceName;
            }));

        let dateRenderer =
            new Gtk.CellRendererText({ xpad: 32 });
        listWidget.add_renderer(dateRenderer, Lang.bind(this,
            function(col, cell, model, iter) {
                let id = model.get_value(iter, Gd.MainColumns.ID);
                let doc = Application.documentManager.getItemById(id);
                let DAY = 86400000000;

                let now = GLib.DateTime.new_now_local();
                let mtime = GLib.DateTime.new_from_unix_local(doc.mtime);
                let difference = now.difference(mtime);
                let days = Math.floor(difference / DAY);
                let weeks = Math.floor(difference / (7 * DAY));
                let months = Math.floor(difference / (30 * DAY));
                let years = Math.floor(difference / (365 * DAY));

                if (difference < DAY) {
                    dateRenderer.text = mtime.format('%X');
                } else if (difference < 2 * DAY) {
                    dateRenderer.text = _("Yesterday");
                } else if (difference < 7 * DAY) {
                    dateRenderer.text = Gettext.ngettext("%d day ago",
                                                         "%d days ago",
                                                         days).format(days);
                } else if (difference < 14 * DAY) {
                    dateRenderer.text = _("Last week");
                } else if (difference < 28 * DAY) {
                    dateRenderer.text = Gettext.ngettext("%d week ago",
                                                         "%d weeks ago",
                                                         weeks).format(weeks);
                } else if (difference < 60 * DAY) {
                    dateRenderer.text = _("Last month");
                } else if (difference < 360 * DAY) {
                    dateRenderer.text = Gettext.ngettext("%d month ago",
                                                         "%d months ago",
                                                         months).format(months);
                } else if (difference < 730 * DAY) {
                    dateRenderer.text = _("Last year");
                } else {
                    dateRenderer.text = Gettext.ngettext("%d year ago",
                                                         "%d years ago",
                                                         years).format(years);
                }
            }));
    },

    _onSelectionModeRequest: function() {
        Application.selectionController.setSelectionMode(true);
    },

    _onItemActivated: function(widget, id, path) {
        Application.documentManager.setActiveItemById(id);
    },

    _onQueryError: function(manager, message, exception) {
        this._setError(message, exception.message);
    },

    _onQueryStatusChanged: function() {
        let status = this._trackerController.getQueryStatus();

        if (!status) {
            // setup a model if we're not querying
            this.view.set_model(this._model.model);

            // unfreeze selection
            Application.selectionController.freezeSelection(false);
            this._updateSelection();
        } else {
            // save the last selection
            Application.selectionController.freezeSelection(true);

            // if we're querying, clear the model from the view,
            // so that we don't uselessly refresh the rows
            this.view.set_model(null);
        }
    },

    _setError: function(primary, secondary) {
        this._errorBox.update(primary, secondary);
        this.widget.set_visible_child_name('error');
    },

    _updateSelection: function() {
        let selected = Application.selectionController.getSelection();
        let newSelection = [];

        if (!selected.length)
            return;

        let generic = this.view.get_generic_view();
        let first = true;
        this._model.model.foreach(Lang.bind(this,
            function(model, path, iter) {
                let id = this._model.model.get_value(iter, Gd.MainColumns.ID);
                let idIndex = selected.indexOf(id);

                if (idIndex != -1) {
                    this._model.model.set_value(iter, Gd.MainColumns.SELECTED, true);
                    newSelection.push(id);

                    if (first) {
                        generic.scroll_to_path(path);
                        first = false;
                    }
                }

                if (newSelection.length == selected.length)
                    return true;

                return false;
            }));

        Application.selectionController.setSelection(newSelection);
    },

    _onSelectionModeChanged: function() {
        let selectionMode = Application.selectionController.getSelectionMode();
        this.view.set_selection_mode(selectionMode);
    },

    _onViewSelectionChanged: function() {
        // update the selection on the controller when the view signals a change
        let selectedURNs = Utils.getURNsFromPaths(this.view.get_selection(),
                                                  this._model.model);
        Application.selectionController.setSelection(selectedURNs);
    },

    _onWindowModeChanged: function() {
        let mode = Application.modeController.getWindowMode();
        if (mode == this._mode)
            this._connectView();
        else
            this._disconnectView();
    },

    _connectView: function() {
        this._edgeHitId = this.view.connect('edge-reached', Lang.bind(this,
            function (view, pos) {
                if (pos == Gtk.PositionType.BOTTOM)
                    this._offsetController.increaseOffset();
            }));
    },

    _disconnectView: function() {
        if (this._edgeHitId != 0) {
            this.view.disconnect(this._edgeHitId);
            this._edgeHitId = 0;
        }
    }
});
