/*
 * Copyright (c) 2011, 2012, 2014, 2015 Red Hat, Inc.
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
const Signals = imports.signals;
const _ = imports.gettext.gettext;

const EvDoc = imports.gi.EvinceDocument;
const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const Goa = imports.gi.Goa;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Tracker = imports.gi.Tracker;
const TrackerControl = imports.gi.TrackerControl;

const ChangeMonitor = imports.changeMonitor;
const Documents = imports.documents;
const Format = imports.format;
const Main = imports.main;
const MainWindow = imports.mainWindow;
const MainToolbar = imports.mainToolbar;
const Manager = imports.manager;
const Miners = imports.miners;
const Notifications = imports.notifications;
const Properties = imports.properties;
const Query = imports.query;
const Search = imports.search;
const Selections = imports.selections;
const ShellSearchProvider = imports.shellSearchProvider;
const TrackerController = imports.trackerController;
const TrackerUtils = imports.trackerUtils;
const Utils = imports.utils;
const WindowMode = imports.windowMode;

// used globally
let application = null;
let connection = null;
let connectionQueue = null;
let goaClient = null;
let settings = null;

// used by the application, but not by the search provider
let changeMonitor = null;
let cssProvider = null;
let documentManager = null;
let modeController = null;
let notificationManager = null;
let offsetCollectionsController = null;
let offsetDocumentsController = null;
let offsetSearchController = null;
let queryBuilder = null;
let searchCategoryManager = null;
let searchController = null;
let searchMatchManager = null;
let searchTypeManager = null;
let selectionController = null;
let sourceManager = null;
let trackerCollectionsController = null;
let trackerDocumentsController = null;
let trackerSearchController = null;

const TrackerExtractPriorityIface = '<node> \
<interface name="org.freedesktop.Tracker1.Extract.Priority"> \
    <method name="ClearRdfTypes" /> \
    <method name="SetRdfTypes"> \
        <arg name="rdf_types" type="as" /> \
    </method> \
</interface> \
</node>';

var TrackerExtractPriorityProxy = Gio.DBusProxy.makeProxyWrapper(TrackerExtractPriorityIface);
function TrackerExtractPriority() {
    return new TrackerExtractPriorityProxy(Gio.DBus.session,
                                           'org.freedesktop.Tracker1.Miner.Extract',
                                           '/org/freedesktop/Tracker1/Extract/Priority');
}

const MINER_REFRESH_TIMEOUT = 60; /* seconds */

const Application = new Lang.Class({
    Name: 'Application',
    Extends: Gtk.Application,

    _init: function(isBooks) {
        this.minersRunning = [];
        this._activationTimestamp = Gdk.CURRENT_TIME;
        this._extractPriority = null;

        this.isBooks = isBooks;

        let appid;
        if (this.isBooks) {
            GLib.set_application_name(_("Books"));
            appid = 'org.gnome.Books';
        } else {
            GLib.set_application_name(_("Documents"));
            appid = 'org.gnome.Documents';
        }

        // needed by data/ui/view-menu.ui
        GObject.type_ensure(Gio.ThemedIcon);

        this.parent({ application_id: appid,
                      inactivity_timeout: 12000 });

        this._searchProvider = new ShellSearchProvider.ShellSearchProvider();
        this._searchProvider.connect('activate-result', Lang.bind(this, this._onActivateResult));
        this._searchProvider.connect('launch-search', Lang.bind(this, this._onLaunchSearch));
    },

    _initGettingStarted: function() {
        let manager = TrackerControl.MinerManager.new_full(false);

        let languages = GLib.get_language_names();
        let files = languages.map(
            function(language) {
                return Gio.File.new_for_path(pkg.pkgdatadir + '/getting-started/' + language +
                    '/gnome-documents-getting-started.pdf');
            });

        this.gettingStartedLocation = null;

        function checkNextFile(obj) {
            let file = files.shift();
            if (!file) {
                log('Can\'t find a valid getting started PDF document');
                return;
            }

            file.query_info_async('standard::type', Gio.FileQueryInfoFlags.NONE, 0, null, Lang.bind(this,
                function(object, res) {
                    try {
                        let info = object.query_info_finish(res);
                        this.gettingStartedLocation = file.get_parent();

                        manager.index_file_async(file, null,
                            function(object, res) {
                                try {
                                    manager.index_file_finish(res);
                                } catch (e) {
                                    log('Error indexing the getting started PDF: ' + e.message);
                                }
                            });
                    } catch (e) {
                        checkNextFile.apply(this);
                    }
                }));
        }

        checkNextFile.apply(this);
    },

    _fullscreenCreateHook: function(action) {
        modeController.connect('can-fullscreen-changed', Lang.bind(this,
            function() {
                let canFullscreen = modeController.getCanFullscreen();
                action.set_enabled(canFullscreen);
            }));
    },

    _viewAsCreateHook: function(action) {
        settings.connect('changed::view-as', Lang.bind(this,
            function() {
                let state = settings.get_value('view-as');
                if (state.get_string()[0] != action.state.get_string()[0])
                    action.state = state;
            }));
    },

    _nightModeCreateHook: function(action) {
        settings.connect('changed::night-mode', Lang.bind(this,
            function() {
                let state = settings.get_value('night-mode');
                if (state.get_boolean() != action.state.get_boolean())
                    action.state = state;

                let gtkSettings = Gtk.Settings.get_default();
                gtkSettings.gtk_application_prefer_dark_theme = state.get_boolean();
            }));

        let state = settings.get_value('night-mode');
        let gtkSettings = Gtk.Settings.get_default();
        gtkSettings.gtk_application_prefer_dark_theme = state.get_boolean();
    },

    _sortByCreateHook: function(action) {
        settings.connect('changed::sort-by', Lang.bind(this,
            function() {
                let state = settings.get_value('sort-by');
                if (state.get_string()[0] != action.state.get_string()[0])
                    action.state = state;
            }));
    },

    _onActionQuit: function() {
        this._mainWindow.destroy();
    },

    _onActionAbout: function() {
        this._mainWindow.showAbout(this.isBooks);
    },

    _onActionHelp: function() {
        try {
            Gtk.show_uri(this._mainWindow.get_screen(),
                         'help:gnome-documents',
                         Gtk.get_current_event_time());
        } catch (e) {
            log('Unable to display help: ' + e.message);
        }
    },

    _onActionNightMode: function(action) {
        let state = action.get_state();
        settings.set_value('night-mode', GLib.Variant.new('b', !state.get_boolean()));
    },

    _onActionFullscreen: function() {
        modeController.toggleFullscreen();
    },

    _onActionViewAs: function(action, parameter) {
        if (parameter.get_string()[0] != action.state.get_string()[0])
            settings.set_value('view-as', parameter);
    },

    _onActionSortBy: function(action, parameter) {
        if (parameter.get_string()[0] != action.state.get_string()[0])
            settings.set_value('sort-by', parameter);
    },

    _onActionOpenCurrent: function() {
        let doc = documentManager.getActiveItem();
        if (doc)
            doc.open(this._mainWindow.get_screen(), Gtk.get_current_event_time());
    },

    _onActionPrintCurrent: function() {
        let doc = documentManager.getActiveItem();
        if (doc)
            doc.print(this._mainWindow);
    },

    _onActionToggle: function(action) {
        let state = action.get_state();
        action.change_state(GLib.Variant.new('b', !state.get_boolean()));
    },

    _onActionProperties: function() {
        let doc = documentManager.getActiveItem();
        if (!doc)
            return;

        let dialog = new Properties.PropertiesDialog(doc.id);
        dialog.connect('response', Lang.bind(this,
            function(widget, response) {
                widget.destroy();
            }));
    },

    _initActions: function() {
        this._actionEntries.forEach(Lang.bind(this,
            function(actionEntry) {
                let state = actionEntry.state;
                let parameterType = actionEntry.parameter_type ?
                    GLib.VariantType.new(actionEntry.parameter_type) : null;
                let action;

                if (state)
                    action = Gio.SimpleAction.new_stateful(actionEntry.name,
                        parameterType, actionEntry.state);
                else
                    action = new Gio.SimpleAction({ name: actionEntry.name,
                        parameter_type: parameterType });

                if (actionEntry.create_hook)
                    actionEntry.create_hook.apply(this, [action]);

                if (actionEntry.callback)
                    action.connect('activate', Lang.bind(this, actionEntry.callback));

                if (actionEntry.accels)
                    this.set_accels_for_action('app.' + actionEntry.name, actionEntry.accels);

                this.add_action(action);
            }));
    },

    _connectActionsToMode: function() {
        this._actionEntries.forEach(Lang.bind(this,
            function(actionEntry) {
                if (actionEntry.window_mode) {
                    modeController.connect('window-mode-changed', Lang.bind(this,
                        function() {
                            let mode = modeController.getWindowMode();
                            let action = this.lookup_action(actionEntry.name);
                            action.set_enabled(mode == actionEntry.window_mode);
                        }));
                } else if (actionEntry.window_modes) {
                    modeController.connect('window-mode-changed', Lang.bind(this,
                        function() {
                            let mode = modeController.getWindowMode();
                            let action = this.lookup_action(actionEntry.name);
                            let enable = false;
                            for (let idx in actionEntry.window_modes) {
                                if (mode == actionEntry.window_modes[idx]) {
                                    enable = true;
                                    break;
                                }
                            }
                            action.set_enabled(enable);
                        }));
                }
            }));
    },

    _initAppMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Documents/ui/app-menu.ui');

        let menu = builder.get_object('app-menu');
        this.set_app_menu(menu);
    },

    _createMiners: function(callback) {
        let count = 3;

        this.gdataMiner = new Miners.GDataMiner(Lang.bind(this,
            function() {
                count--;
                if (count == 0)
                    callback();
            }));

        this.owncloudMiner = new Miners.OwncloudMiner(Lang.bind(this,
            function() {
                count--;
                if (count == 0)
                    callback();
            }));

        this.zpjMiner = new Miners.ZpjMiner(Lang.bind(this,
            function() {
                count--;
                if (count == 0)
                    callback();
            }));
    },

    _refreshMinerNow: function(miner) {
        let env = GLib.getenv('DOCUMENTS_DISABLE_MINERS');
        if (env)
            return false;

        if (!miner)
            return false;

        this.minersRunning.push(miner);
        this.emitJS('miners-changed', this.minersRunning);

        miner._cancellable = new Gio.Cancellable();
        miner.RefreshDBRemote(['documents'], miner._cancellable, Lang.bind(this,
            function(res, error) {
                this.minersRunning = this.minersRunning.filter(
                    function(element) {
                        return element != miner;
                    });
                this.emitJS('miners-changed', this.minersRunning);

                if (error) {
                    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        log('Error updating the cache: ' + error.toString());

                    return;
                }

                Mainloop.timeout_add_seconds(MINER_REFRESH_TIMEOUT,
                                             Lang.bind(this, function() {
                                                 this._refreshMinerNow(miner);
                                             }));
            }));

        return false;
    },

    _refreshMiners: function() {
        if (sourceManager.hasProviderType('google')) {
            try {
                // startup a refresh of the gdocs cache
                this._refreshMinerNow(this.gdataMiner);
            } catch (e) {
                log('Unable to start GData miner: ' + e.message);
            }
        }

        if (sourceManager.hasProviderType('owncloud')) {
            try {
                // startup a refresh of the owncloud cache
                this._refreshMinerNow(this.owncloudMiner);
            } catch (e) {
                log('Unable to start Owncloud miner: ' + e.message);
            }
        }

        if (sourceManager.hasProviderType('windows_live')) {
            try {
                // startup a refresh of the skydrive cache
                this._refreshMinerNow(this.zpjMiner);
            } catch (e) {
                log('Unable to start Zpj miner: ' + e.message);
            }
        }
    },

    _startMiners: function() {
        this._createMiners(Lang.bind(this,
            function() {
                this._refreshMiners();

                this._sourceAddedId = sourceManager.connect('item-added',
                                                            Lang.bind(this, this._refreshMiners));
                this._sourceRemovedId = sourceManager.connect('item-removed',
                                                              Lang.bind(this, this._refreshMiners));
            }));
    },

    _stopMiners: function() {
        if (this._sourceAddedId != 0) {
            sourceManager.disconnect(this._sourceAddedId);
            this._sourceAddedId = 0;
        }

        if (this._sourceRemovedId != 0) {
            sourceManager.disconnect(this._sourceRemovedId);
            this._sourceRemovedId = 0;
        }

        this.minersRunning.forEach(Lang.bind(this,
            function(miner) {
                miner._cancellable.cancel();
            }));

        this.gdataMiner = null;
        this.owncloudMiner = null;
        this.zpjMiner = null;
    },

    _themeChanged: function(gtkSettings) {
        let screen = Gdk.Screen.get_default();

        if (gtkSettings.gtk_theme_name == 'Adwaita') {
            if (cssProvider == null) {
                cssProvider = new Gtk.CssProvider();
                let file = Gio.File.new_for_uri("resource:///org/gnome/Documents/application.css");
                cssProvider.load_from_file(file);
            }

            Gtk.StyleContext.add_provider_for_screen(screen,
                                                     cssProvider,
                                                     Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        } else if (cssProvider != null) {
            Gtk.StyleContext.remove_provider_for_screen(screen, cssProvider);
        }
    },

    vfunc_startup: function() {
        this.parent();
        String.prototype.format = Format.format;

        EvDoc.init();

        application = this;
        if (application.isBooks)
            settings = new Gio.Settings({ schema_id: 'org.gnome.books' });
        else
            settings = new Gio.Settings({ schema_id: 'org.gnome.documents' });

        let gtkSettings = Gtk.Settings.get_default();
        gtkSettings.connect('notify::gtk-theme-name', Lang.bind(this, this._themeChanged));
        this._themeChanged(gtkSettings);

        // connect to tracker
        try {
            connection = Tracker.SparqlConnection.get(null);
        } catch (e) {
            log('Unable to connect to the tracker database: ' + e.toString());
            return;
        }

        if (!application.isBooks) {
            try {
                goaClient = Goa.Client.new_sync(null);
            } catch (e) {
                log('Unable to create the GOA client: ' + e.toString());
                return;
            }
        }

        connectionQueue = new TrackerController.TrackerConnectionQueue();
        changeMonitor = new ChangeMonitor.TrackerChangeMonitor();

        // now init application components
        Search.initSearch(imports.application);
        Search.initSearch(imports.shellSearchProvider);

        modeController = new WindowMode.ModeController();
        offsetCollectionsController = new Search.OffsetCollectionsController();
        offsetDocumentsController = new Search.OffsetDocumentsController();
        offsetSearchController = new Search.OffsetSearchController();
        trackerCollectionsController = new TrackerController.TrackerCollectionsController();
        trackerDocumentsController = new TrackerController.TrackerDocumentsController();
        trackerSearchController = new TrackerController.TrackerSearchController();
        selectionController = new Selections.SelectionController();

        this._actionEntries = [
            { name: 'quit',
              callback: this._onActionQuit,
              accels: ['<Primary>q'] },
            { name: 'about',
              callback: this._onActionAbout },
            { name: 'help',
              callback: this._onActionHelp,
              accels: ['F1'] },
            { name: 'fullscreen',
              callback: this._onActionFullscreen,
              create_hook: this._fullscreenCreateHook,
              accels: ['F11'],
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'night-mode',
              callback: this._onActionNightMode,
              create_hook: this._nightModeCreateHook,
              state: settings.get_value('night-mode') },
            { name: 'gear-menu',
              callback: this._onActionToggle,
              state: GLib.Variant.new('b', false),
              accels: ['F10'] },
            { name: 'view-as',
              callback: this._onActionViewAs,
              create_hook: this._viewAsCreateHook,
              parameter_type: 's',
              state: settings.get_value('view-as'),
              window_modes: [WindowMode.WindowMode.COLLECTIONS,
                             WindowMode.WindowMode.DOCUMENTS,
                             WindowMode.WindowMode.SEARCH] },
            { name: 'sort-by',
              callback: this._onActionSortBy,
              create_hook: this._sortByCreateHook,
              parameter_type: 's',
              state: settings.get_value('sort-by'),
              window_modes: [WindowMode.WindowMode.COLLECTIONS,
                             WindowMode.WindowMode.DOCUMENTS,
                             WindowMode.WindowMode.SEARCH] },
            { name: 'open-current',
              callback: this._onActionOpenCurrent,
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'edit-current' },
            { name: 'view-current',
              window_mode: WindowMode.WindowMode.EDIT },
            { name: 'present-current',
              window_mode: WindowMode.WindowMode.PREVIEW,
              callback: this._onActionToggle,
              state: GLib.Variant.new('b', false),
              accels: ['F5'] },
            { name: 'print-current', accels: ['<Primary>p'],
              callback: this._onActionPrintCurrent },
            { name: 'search',
              callback: this._onActionToggle,
              state: GLib.Variant.new('b', false),
              accels: ['<Primary>f'] },
            { name: 'find-next', accels: ['<Primary>g'],
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'find-prev', accels: ['<Shift><Primary>g'],
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'zoom-in', accels: ['<Primary>plus', '<Primary>equal'],
              window_modes: [WindowMode.WindowMode.PREVIEW,
                             WindowMode.WindowMode.PREVIEW_LOK] },
            { name: 'zoom-out', accels: ['<Primary>minus'],
              window_modes: [WindowMode.WindowMode.PREVIEW,
                             WindowMode.WindowMode.PREVIEW_LOK] },
            { name: 'rotate-left', accels: ['<Primary>Left'],
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'rotate-right', accels: ['<Primary>Right'],
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'select-all', accels: ['<Primary>a'],
              window_modes: [WindowMode.WindowMode.COLLECTIONS,
                             WindowMode.WindowMode.DOCUMENTS,
                             WindowMode.WindowMode.SEARCH] },
            { name: 'select-none',
              window_modes: [WindowMode.WindowMode.COLLECTIONS,
                             WindowMode.WindowMode.DOCUMENTS,
                             WindowMode.WindowMode.SEARCH] },
            { name: 'properties',
              callback: this._onActionProperties,
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'bookmark-page',
              callback: this._onActionToggle,
              state: GLib.Variant.new('b', false),
              accels: ['<Primary>d'],
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'places',
              accels: ['<Primary>b'],
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'copy',
              accels: ['<Primary>c'],
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'search-source',
              parameter_type: 's',
              state: GLib.Variant.new('s', Search.SearchSourceStock.ALL),
              window_modes: [WindowMode.WindowMode.COLLECTIONS,
                             WindowMode.WindowMode.DOCUMENTS,
                             WindowMode.WindowMode.SEARCH] },
            { name: 'search-type',
              parameter_type: 's',
              state: GLib.Variant.new('s', Search.SearchTypeStock.ALL),
              window_modes: [WindowMode.WindowMode.COLLECTIONS,
                             WindowMode.WindowMode.DOCUMENTS,
                             WindowMode.WindowMode.SEARCH] },
            { name: 'search-match',
              parameter_type: 's',
              state: GLib.Variant.new('s', Search.SearchMatchStock.ALL),
              window_modes: [WindowMode.WindowMode.COLLECTIONS,
                             WindowMode.WindowMode.DOCUMENTS,
                             WindowMode.WindowMode.SEARCH] }
        ];

        this._initActions();
        this._initAppMenu();

        if (!this.isBooks)
            this._initGettingStarted();
    },

    _createWindow: function() {
        if (this._mainWindow)
            return;

        notificationManager = new Notifications.NotificationManager();
        this._connectActionsToMode();
        this._mainWindow = new MainWindow.MainWindow(this);
        this._mainWindow.connect('destroy', Lang.bind(this, this._onWindowDestroy));

        try {
            this._extractPriority = TrackerExtractPriority();
            this._extractPriority.SetRdfTypesRemote(['nfo:Document']);
        } catch (e) {
            log('Unable to connect to the tracker extractor: ' + e.toString());
        }

        // start miners
        this._startMiners();
    },

    vfunc_dbus_register: function(connection, path) {
        this.parent(connection, path);

        this._searchProvider.export(connection);
        return true;
    },

    vfunc_dbus_unregister: function(connection, path) {
        this._searchProvider.unexport(connection);

        this.parent(connection, path);
    },

    vfunc_activate: function() {
        if (!this._mainWindow) {
            this._createWindow();
            modeController.setWindowMode(WindowMode.WindowMode.DOCUMENTS);
        }

        this._mainWindow.present_with_time(this._activationTimestamp);
        this._activationTimestamp = Gdk.CURRENT_TIME;
    },

    _clearState: function() {
        // clean up signals
        changeMonitor.disconnectAll();
        documentManager.disconnectAll();
        offsetCollectionsController.disconnectAll();
        offsetDocumentsController.disconnectAll();
        offsetSearchController.disconnectAll();
        trackerCollectionsController.disconnectAll();
        trackerDocumentsController.disconnectAll();
        trackerSearchController.disconnectAll();
        selectionController.disconnectAll();
        modeController.disconnectAll();
        this.disconnectAllJS();

        // reset state
        documentManager.clearRowRefs();
        documentManager.setActiveItem(null);
        modeController.setWindowMode(WindowMode.WindowMode.NONE);
        selectionController.setSelection(null);
        notificationManager = null;

        // stop miners
        this._stopMiners();

        if (this._extractPriority)
            this._extractPriority.ClearRdfTypesRemote();
    },

    _onWindowDestroy: function(window) {
        this._mainWindow = null;

        // clear our state in an idle, so other handlers connected
        // to 'destroy' have the chance to perform their cleanups first
        Mainloop.idle_add(Lang.bind(this, this._clearState));
    },

    _onActivateResult: function(provider, urn, terms, timestamp) {
        this._createWindow();
        modeController.setWindowMode(WindowMode.WindowMode.PREVIEW);

        let doc = documentManager.getItemById(urn);
        if (doc) {
            doActivate.apply(this, [doc]);
        } else {
            let job = new TrackerUtils.SingleItemJob(urn, queryBuilder);
            job.run(Query.QueryFlags.UNFILTERED, Lang.bind(this,
                function(cursor) {
                    if (cursor)
                        doc = documentManager.addDocumentFromCursor(cursor);

                    doActivate.apply(this, [doc]);
                }));
        }

        function doActivate(doc) {
            documentManager.setActiveItem(doc);

            this._activationTimestamp = timestamp;
            this.activate();

            // forward the search terms next time we enter the overview
            let modeChangeId = modeController.connect('window-mode-changed', Lang.bind(this,
                function(object, newMode) {
                    if (newMode == WindowMode.WindowMode.EDIT
                        || newMode == WindowMode.WindowMode.PREVIEW)
                        return;

                    modeController.disconnect(modeChangeId);

                    searchController.setString(terms.join(' '));
                    this.change_action_state('search', GLib.Variant.new('b', true));
                }));
        }
    },

    _onLaunchSearch: function(provider, terms, timestamp) {
        this._createWindow();
        modeController.setWindowMode(WindowMode.WindowMode.DOCUMENTS);
        searchController.setString(terms.join(' '));
        this.change_action_state('search', GLib.Variant.new('b', true));

        this._activationTimestamp = timestamp;
        this.activate();
    },

    getScaleFactor: function() {
        let scaleFactor = 1;
        if (this._mainWindow)
            scaleFactor = this._mainWindow.get_scale_factor();

        return scaleFactor;
    },

    getGdkWindow: function() {
        let window = null;
        if (this._mainWindow)
            window = this._mainWindow.get_window();

        return window;
    }
});
Utils.addJSSignalMethods(Application.prototype);
