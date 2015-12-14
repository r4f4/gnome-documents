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

try {
	const LOKDocView = imports.gi.LOKDocView;
} catch(e) {
	// LOKDocView will be undefined, and we'll
	// use this to warn when LO files can't be opened
}

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
const Tweener = imports.tweener.tweener;

const Application = imports.application;
const ErrorBox = imports.errorBox;
const MainToolbar = imports.mainToolbar;
const Searchbar = imports.searchbar;
const Utils = imports.utils;
const View = imports.view;
const WindowMode = imports.windowMode;
const Documents = imports.documents;

const openDocumentFormats = ['application/vnd.oasis.opendocument.text',
                             'application/vnd.oasis.opendocument.text-template',
                             'application/vnd.oasis.opendocument.text-web',
                             'application/vnd.oasis.opendocument.text-master',
                             'application/vnd.oasis.opendocument.graphics',
                             'application/vnd.oasis.opendocument.graphics-template',
                             'application/vnd.oasis.opendocument.presentation',
                             'application/vnd.oasis.opendocument.presentation-template',
                             'application/vnd.oasis.opendocument.spreadsheet',
                             'application/vnd.oasis.opendocument.spreadsheet-template',
                             'application/vnd.oasis.opendocument.chart',
                             'application/vnd.oasis.opendocument.formula',
                             'application/vnd.oasis.opendocument.database',
                             'application/vnd.oasis.opendocument.image',
                             'application/vnd.openofficeorg.extension'];

// These are the documents consisting of document parts.
const openDocumentPartFormats = ['application/vnd.oasis.opendocument.presentation',
                                 'application/vnd.oasis.opendocument.presentation-template',
                                 'application/vnd.oasis.opendocument.spreadsheet',
                                 'application/vnd.oasis.opendocument.spreadsheet-template',];

function isAvailable() {
    return (LOKDocView != undefined);
}

function isOpenDocumentPartDocument(mimeType) {
     if (openDocumentPartFormats.indexOf(mimeType) != -1)
         return true;
     return false;
}

function isOpenDocumentFormat(mimeType) {
    if (openDocumentFormats.indexOf(mimeType) != -1)
        return true;
    return false;
}

const LOKView = new Lang.Class({
    Name: 'LOKView',
    Extends: Gtk.Stack,

    _init: function(overlay) {
        this.parent({ homogeneous: true,
                      transition_type: Gtk.StackTransitionType.CROSSFADE });

        this._uri = null;
        this._overlay = overlay;
        this.get_style_context().add_class('documents-scrolledwin');

        this._errorBox = new ErrorBox.ErrorBox();
        this.add_named(this._errorBox, 'error');

        this._sw = new Gtk.ScrolledWindow({hexpand: true,
                                           vexpand: true});

        this._progressBar = new Gtk.ProgressBar({ halign: Gtk.Align.FILL,
                                                  valign: Gtk.Align.START });
        this._progressBar.get_style_context().add_class('osd');
        this._overlay.add_overlay(this._progressBar);

        this.add_named(this._sw, 'view');
        this._createView();

        this.show_all();

        this._zoomIn = Application.application.lookup_action('zoom-in');
        let zoomInId = this._zoomIn.connect('activate', Lang.bind(this,
            function() {
                let zoomLevel = this.view.get_zoom();
                this.view.set_zoom(zoomLevel * 2);
            }));

        this._zoomOut = Application.application.lookup_action('zoom-out');
        let zoomOutId = this._zoomOut.connect('activate', Lang.bind(this,
            function() {
                let zoomLevel = this.view.get_zoom();
                this.view.set_zoom(zoomLevel / 2);
            }));

        this._copy = Application.application.lookup_action('copy');
        let copyId = this._copy.connect('activate', Lang.bind(this, this._onCopyActivated));

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-error',
                                            Lang.bind(this, this._onLoadError));

        this.connect('destroy', Lang.bind(this,
           function() {
               this._zoomIn.disconnect(zoomInId);
               this._zoomOut.disconnect(zoomOutId);
           }));
    },

    _onCopyActivated: function() {
        let [selectedText, mimeType] = this.view.copy_selection('text/plain;charset=utf-8');
        let display = Gdk.Display.get_default();
        let clipboard = Gtk.Clipboard.get_default(display);

        clipboard.set_text(selectedText, selectedText.length);
    },

    _onLoadStarted: function(manager, doc) {
        if (doc.viewType != Documents.ViewType.LOK)
            return;
        if (!isAvailable())
            return;
        let file = Gio.File.new_for_uri (doc.uri);
        let location = file.get_path();
        this._doc = doc;
        this._copy.enabled = false;
        this.view.open_document(location, "{}", null, Lang.bind(this, this.open_document_cb));
        this._progressBar.show();
    },

    _onLoadError: function(manager, doc, message, exception) {
        if (doc.viewType != Documents.ViewType.LOK)
            return;
        //FIXME we should hide controls
        this._setError(message, exception.message);
    },

    open_document_cb: function(res, doc) {
        // TODO: Call _finish and check failure
        if (isOpenDocumentPartDocument(this._doc.mimeType)) {
            this.hasParts = true;
            this.totalParts = this.view.get_parts();
            this.currentPart = this.view.get_part();
        } else
            this.hasParts = false;

        this._progressBar.hide();
        this.set_visible_child_name('view');
        this.view.set_edit(false);
    },

    reset: function () {
        if (!this.view)
            return;
        this.view.reset_view();
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
        this._copy.enabled = false;
    },

    _createView: function() {
        if (isAvailable()) {
            this.view = LOKDocView.View.new(null, null, null);
            this._sw.add(this.view);
            this.view.show();
            this.view.connect('load-changed', Lang.bind(this, this._onProgressChanged));
            this.view.connect('text-selection', Lang.bind(this, this._onTextSelection));
        }

        this._navControls = new LOKViewNavControls(this, this._overlay);
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
    },

    _onProgressChanged: function() {
        this._progressBar.fraction = this.view.load_progress;
    },

    _onTextSelection: function(hasSelection) {
        this._copy.enabled = hasSelection;
    },

    _setError: function(primary, secondary) {
        this._errorBox.update(primary, secondary);
        this.set_visible_child_name('error');
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

        this._lokView._zoomIn.enabled = true;
        this._lokView._zoomOut.enabled = true;

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
        builder.add_from_resource('/org/gnome/Documents/ui/preview-context-menu.ui');
        let menu = builder.get_object('preview-context-menu');

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

const _LOKVIEW_NAVBAR_MARGIN = 30;
const _AUTO_HIDE_TIMEOUT = 2;

const LOKViewNavControls = new Lang.Class({
    Name: 'LOKViewNavControls',

    _init: function(lokView, overlay) {
        this._lokView = lokView;
        this._overlay = overlay;

        this._visible = false;
        this._visibleInternal = false;
        this._pageChangedId = 0;
        this._autoHideId = 0;
        this._motionId = 0;

        this.prev_widget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-previous-symbolic',
                                                                    pixel_size: 16 }),
                                            margin_start: _LOKVIEW_NAVBAR_MARGIN,
                                            margin_end: _LOKVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.START,
                                            valign: Gtk.Align.CENTER });
        this.prev_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.prev_widget);
        this.prev_widget.connect('clicked', Lang.bind(this, this._onPrevClicked));
        this.prev_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.prev_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));

        this.next_widget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-next-symbolic',
                                                                    pixel_size: 16 }),
                                            margin_start: _LOKVIEW_NAVBAR_MARGIN,
                                            margin_end: _LOKVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.END,
                                            valign: Gtk.Align.CENTER });
        this.next_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.next_widget);
        this.next_widget.connect('clicked', Lang.bind(this, this._onNextClicked));
        this.next_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.next_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));
        this._overlay.connect('motion-notify-event', Lang.bind(this, this._onMotion));
    },

    _onEnterNotify: function() {
        this._unqueueAutoHide();
        return false;
    },

    _onLeaveNotify: function() {
        this._queueAutoHide();
        return false;
    },

    _motionTimeout: function() {
        this._motionId = 0;
        this._visibleInternal = true;
        this._updateVisibility();
        this._queueAutoHide();
        return false;
    },

    _onMotion: function(widget, event) {
        if (this._motionId != 0) {
            return false;
        }

        let device = event.get_source_device();
        if (device.input_source == Gdk.InputSource.TOUCHSCREEN) {
            return false;
        }

        this._motionId = Mainloop.idle_add(Lang.bind(this, this._motionTimeout));
        return false;
    },

    _onPrevClicked: function() {
        let currentPart = this._lokView.view.get_part();
        currentPart -= 1;
        if (currentPart < 0)
            return;
        this._lokView.view.set_part(currentPart);
        this._lokView.currentPart = currentPart;
    },

    _onNextClicked: function() {
        let totalParts  = this._lokView.view.get_parts();
        let currentPart = this._lokView.view.get_part();
        currentPart += 1;
        if (currentPart > totalParts)
            return;
        this._lokView.view.set_part(currentPart);
        this._lokView.currentPart = currentPart;
    },

    _autoHide: function() {
        this._autoHideId = 0;
        this._visibleInternal = false;
        this._updateVisibility();
        return false;
    },

    _unqueueAutoHide: function() {
        if (this._autoHideId == 0)
            return;

        Mainloop.source_remove(this._autoHideId);
        this._autoHideId = 0;
    },

    _queueAutoHide: function() {
        this._unqueueAutoHide();
        //FIXME: disable this temporarily till motion-notify-event works
        //this._autoHideId = Mainloop.timeout_add_seconds(_AUTO_HIDE_TIMEOUT, Lang.bind(this, this._autoHide));
    },

    _updateVisibility: function() {
        if (!this._lokView.hasParts) {
            this._fadeOutButton(this.prev_widget);
            this._fadeOutButton(this.next_widget);
            return;
        }

        if (this._lokView.currentPart > 0)
            this._fadeInButton(this.prev_widget);
        else
            this._fadeOutButton(this.prev_widget);

        if (this._lokView.currentPart < this._lokView.totalParts)
            this._fadeInButton(this.next_widget);
        else
            this._fadeOutButton(this.next_widget);
    },

    _fadeInButton: function(widget) {
        widget.show_all();
        Tweener.addTween(widget, { opacity: 1,
                                   time: 0.30,
                                   transition: 'easeOutQuad' });
    },

    _fadeOutButton: function(widget) {
        Tweener.addTween(widget, { opacity: 0,
                                   time: 0.30,
                                   transition: 'easeOutQuad',
                                   onComplete: function() {
                                       widget.hide();
                                   },
                                   onCompleteScope: this });
    },

    show: function() {
        this._visible = true;
        this._visibleInternal = true;
        this._updateVisibility();
        this._queueAutoHide();
    },

    hide: function() {
        this._visible = false;
        this._visibleInternal = false;
        this._updateVisibility();
    },

    destroy: function() {
        this.prev_widget.destroy();
        this.next_widget.destroy();
    }
});
