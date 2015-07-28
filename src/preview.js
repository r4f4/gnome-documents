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

const EvDocument = imports.gi.EvinceDocument;
const EvView = imports.gi.EvinceView;
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
const Places = imports.places;
const Searchbar = imports.searchbar;
const Utils = imports.utils;
const View = imports.view;
const WindowMode = imports.windowMode;
const Presentation = imports.presentation;

const _FULLSCREEN_TOOLBAR_TIMEOUT = 2; // seconds

const PreviewView = new Lang.Class({
    Name: 'PreviewView',
    Extends: Gtk.Stack,

    _init: function(overlay) {
        this._model = null;
        this._jobFind = null;
        this._controlsFlipId = 0;
        this._controlsVisible = false;
        this._pageChanged = false;
        this._hasSelection = false;
        this._viewSelectionChanged = false;
        this._fsToolbar = null;
        this._overlay = overlay;
        this._lastSearch = '';

        Application.modeController.connect('fullscreen-changed', Lang.bind(this,
            this._onFullscreenChanged));
        Application.modeController.connect('window-mode-changed', Lang.bind(this,
            this._onWindowModeChanged));

        this.parent({ homogeneous: true,
                      transition_type: Gtk.StackTransitionType.CROSSFADE });

        this._errorBox = new ErrorBox.ErrorBox();
        this.add_named(this._errorBox, 'error');

        this._sw = new Gtk.ScrolledWindow({ hexpand: true,
                                            vexpand: true });
        this._sw.get_style_context().add_class('documents-scrolledwin');
        this._sw.get_hscrollbar().connect('button-press-event', Lang.bind(this, this._onScrollbarClick));
        this._sw.get_vscrollbar().connect('button-press-event', Lang.bind(this, this._onScrollbarClick));
        this._sw.get_hadjustment().connect('value-changed', Lang.bind(this, this._onAdjustmentChanged));
        this._sw.get_vadjustment().connect('value-changed', Lang.bind(this, this._onAdjustmentChanged));
        this.add_named(this._sw, 'view');

        this._createView();

        // create context menu
        let model = this._getPreviewContextMenu();
        this._previewContextMenu = Gtk.Menu.new_from_model(model);
        this._previewContextMenu.attach_to_widget(this._sw, null);

        this.show_all();

        this._bookmarkPage = Application.application.lookup_action('bookmark-page');
        this._bookmarkPage.enabled = false;
        let bookmarkPageId = this._bookmarkPage.connect('change-state',
            Lang.bind(this, this._onActionStateChanged));
        this._onActionStateChanged(this._bookmarkPage, this._bookmarkPage.state);

        this._zoomIn = Application.application.lookup_action('zoom-in');
        let zoomInId = this._zoomIn.connect('activate', Lang.bind(this,
            function() {
                this._model.set_sizing_mode(EvView.SizingMode.FREE);
                this.view.zoom_in();
            }));

        this._zoomOut = Application.application.lookup_action('zoom-out');
        let zoomOutId = this._zoomOut.connect('activate', Lang.bind(this,
            function() {
                this._model.set_sizing_mode(EvView.SizingMode.FREE);
                this.view.zoom_out();
            }));

        let findPrev = Application.application.lookup_action('find-prev');
        let findPrevId = findPrev.connect('activate', Lang.bind(this,
            function() {
                this.view.find_previous();
            }));
        let findNext = Application.application.lookup_action('find-next');
        let findNextId = findNext.connect('activate', Lang.bind(this,
            function() {
                this.view.find_next();
            }));
        this._copy = Application.application.lookup_action('copy');
        let copyId = this._copy.connect('activate', Lang.bind(this,
            function() {
                this.view.copy();
            }));

        let rotLeft = Application.application.lookup_action('rotate-left');
        let rotLeftId = rotLeft.connect('activate', Lang.bind(this,
            function() {
                this._changeRotation(-90);
            }));
        let rotRight = Application.application.lookup_action('rotate-right');
        let rotRightId = rotRight.connect('activate', Lang.bind(this,
            function() {
                this._changeRotation(90);
            }));
        let showPlaces = Application.application.lookup_action('places');
        let showPlacesId = showPlaces.connect('activate', Lang.bind(this, this._showPlaces));

        let nightModeId = Application.application.connect('action-state-changed::night-mode',
            Lang.bind(this, this._updateNightMode));

        this._togglePresentation = Application.application.lookup_action('present-current');
        let presentCurrentId = Application.application.connect('action-state-changed::present-current',
            Lang.bind(this, this._onPresentStateChanged));

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-error',
                                            Lang.bind(this, this._onLoadError));

        this.connect('destroy', Lang.bind(this,
            function() {
                this._bookmarkPage.disconnect(bookmarkPageId);
                this._zoomIn.disconnect(zoomInId);
                this._zoomOut.disconnect(zoomOutId);
                findPrev.disconnect(findPrevId);
                findNext.disconnect(findNextId);
                this._copy.disconnect(copyId);
                rotLeft.disconnect(rotLeftId);
                rotRight.disconnect(rotRightId);
                showPlaces.disconnect(showPlacesId);
                Application.application.disconnect(presentCurrentId);
                Application.application.disconnect(nightModeId);
            }));
    },

    _onLoadStarted: function() {
        this._bookmarkPage.enabled = false;
        this._showPlaces.enabled = false;
        this._copy.enabled = false;
    },

    _onLoadError: function(manager, doc, message, exception) {
        this._controlsVisible = true;
        this._syncControlsVisible();
        this._setError(message, exception.message);
    },

    _onActionStateChanged: function(action, state) {
        if (!this._model)
            return;

        let page_number = this._model.page;
        let bookmark = new GdPrivate.Bookmark({ page_number: page_number });

        if (state.get_boolean())
            this._bookmarks.add(bookmark);
        else
            this._bookmarks.remove(bookmark);
    },

    _onPresentStateChanged: function(source, actionName, state) {
        if (!this._model)
            return;

        if (state.get_boolean())
            this._promptPresentation();
        else
            this._hidePresentation();
    },

    _onPageChanged: function() {
        this._pageChanged = true;

        if (!this._bookmarks)
            return;

        let page_number = this._model.page;
        let bookmark = new GdPrivate.Bookmark({ page_number: page_number });
        let hasBookmark = (this._bookmarks.find_bookmark(bookmark) != null);

        this._bookmarkPage.state = GLib.Variant.new('b', hasBookmark);
    },

    _setError: function(primary, secondary) {
        this._errorBox.update(primary, secondary);
        this.set_visible_child_name('error');
    },

    _showPlaces: function() {
        let dialog = new Places.PlacesDialog(this._model, this._bookmarks);
        dialog.connect('response', Lang.bind(this,
            function(widget, response) {
                widget.destroy();
            }));
    },

    _hidePresentation: function() {
        if (this._presentation) {
            this._presentation.close();
            this._presentation = null;
        }

        Application.application.change_action_state('present-current', GLib.Variant.new('b', false));
    },

    _showPresentation: function(output) {
        this._presentation = new Presentation.PresentationWindow(this._model);
        this._presentation.connect('destroy', Lang.bind(this, this._hidePresentation));
        if (output)
            this._presentation.setOutput(output);
    },

    _promptPresentation: function() {
        let outputs = new Presentation.PresentationOutputs();
        if (outputs.list.length < 2) {
            this._showPresentation();
        } else {
            let chooser = new Presentation.PresentationOutputChooser(outputs);
            chooser.connect('output-activated', Lang.bind(this,
                function(chooser, output) {
                    if (output) {
                        this._showPresentation(output);
                    } else {
                        this._hidePresentation();
                    }
                }));

        }
    },

    _onViewSelectionChanged: function() {
        let hasSelection = this.view.get_has_selection();
        this._copy.enabled = hasSelection;

        if (!hasSelection &&
            hasSelection == this._hasSelection) {
            this._viewSelectionChanged = false;
            return;
        }

        this._hasSelection = hasSelection;
        this._viewSelectionChanged = true;
        if (!hasSelection)
            this._cancelControlsFlip();
    },

    _uriRewrite: function(uri) {
        if (uri.substring(0, 3) != 'www.') {
            /* Prepending "http://" when the url is a webpage (starts with
             * "www.").
             */
            uri = 'http://' + uri;
        } else {
            /* Or treating as a file, otherwise.
             * http://en.wikipedia.org/wiki/File_URI_scheme
             */
            let doc = Application.documentManager.getActiveItem();
            let file = Gio.file_new_for_uri(doc.uri);
            let parent = file.get_parent();

            if (parent)
                uri = parent.get_uri() + uri;
            else
                uri = 'file:///' + uri;
        }

        return uri;
    },

    _launchExternalUri: function(widget, action) {
        let uri = action.get_uri();
        let screen = widget.get_screen();
        let context = screen.get_display().get_app_launch_context();

        context.set_screen(screen);
        context.set_timestamp(Gtk.get_current_event_time());

        if (uri.indexOf('://') == -1 && uri.substring(0, 6) != 'mailto:')
            /* We are only interested in treat URLs (ignoring URN and Mailto
             * schemes), which have this syntax scheme:
             * scheme://domain:port/path?query_string#fragment_id
             *
             * So, if the url is bad formed (doesn't contain "://"), we need to
             * rewrite it.
             *
             * An example of URL, URN and Mailto schemes can be found in:
             * http://en.wikipedia.org/wiki/URI_scheme#Examples
             */
            uri = this._uriRewrite(uri);

        try {
            Gio.AppInfo.launch_default_for_uri(uri, context);
        } catch (e) {
            log('Unable to open external link: ' + e.message);
        }
    },

    _handleExternalLink: function(widget, action) {
        if (action.type == EvDocument.LinkActionType.EXTERNAL_URI)
            this._launchExternalUri(widget, action);
    },

    _onCanZoomInChanged: function() {
        this._zoomIn.enabled = this.view.can_zoom_in;
    },

    _onCanZoomOutChanged: function() {
        this._zoomOut.enabled = this.view.can_zoom_out;
    },

    _createView: function() {
        this.view = EvView.View.new();
        this._sw.add(this.view);
        this.view.show();

        this.view.connect('notify::can-zoom-in', Lang.bind(this,
            this._onCanZoomInChanged));
        this.view.connect('notify::can-zoom-out', Lang.bind(this,
            this._onCanZoomOutChanged));
        this.view.connect('button-press-event', Lang.bind(this,
            this._onButtonPressEvent));
        this.view.connect('button-release-event', Lang.bind(this,
            this._onButtonReleaseEvent));
        this.view.connect('selection-changed', Lang.bind(this,
            this._onViewSelectionChanged));
        this.view.connect('external-link', Lang.bind(this,
            this._handleExternalLink));

        this._navControls = new PreviewNavControls(this, this._overlay);
        this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
    },

    _getPreviewContextMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/documents/preview-context-menu.ui');
        return builder.get_object('preview-context-menu');
    },

    _syncControlsVisible: function() {
        if (this._controlsVisible) {
            if (this._fsToolbar)
                this._fsToolbar.reveal();
        } else {
            if (this._fsToolbar)
                this._fsToolbar.conceal();
        }
    },

    _onWindowModeChanged: function() {
        let windowMode = Application.modeController.getWindowMode();
        if (windowMode != WindowMode.WindowMode.PREVIEW) {
            this.controlsVisible = false;
            this._hidePresentation();
            this._navControls.hide();
        }
    },

    _onFullscreenChanged: function() {
        let fullscreen = Application.modeController.getFullscreen();

        if (fullscreen) {
            // create fullscreen toolbar (hidden by default)
            this._fsToolbar = new PreviewFullscreenToolbar(this);
            this._fsToolbar.setModel(this._model);
            this._overlay.add_overlay(this._fsToolbar);

            this._fsToolbar.connect('show-controls', Lang.bind(this,
                function() {
                    this.controlsVisible = true;
                }));
        } else {
            this._fsToolbar.destroy();
            this._fsToolbar = null;
        }

        this._syncControlsVisible();
    },

    _flipControlsTimeout: function() {
        this._controlsFlipId = 0;
        let visible = this.controlsVisible;
        this.controlsVisible = !visible;

        return false;
    },

     _cancelControlsFlip: function() {
         if (this._controlsFlipId != 0) {
             Mainloop.source_remove(this._controlsFlipId);
             this._controlsFlipId = 0;
         }
     },

     _queueControlsFlip: function() {
         if (this._controlsFlipId)
             return;

         let settings = Gtk.Settings.get_default();
         let doubleClick = settings.gtk_double_click_time;

         this._controlsFlipId = Mainloop.timeout_add(doubleClick, Lang.bind(this, this._flipControlsTimeout));
     },

    _onButtonPressEvent: function(widget, event) {
        let button = event.get_button()[1];

        if (button == 3) {
            let time = event.get_time();
            this._previewContextMenu.popup(null, null, null, button, time);
            return true;
        }

        this._viewSelectionChanged = false;
        return false;
   },

    _onButtonReleaseEvent: function(widget, event) {
        let button = event.get_button()[1];
        let clickCount = event.get_click_count()[1];

        if (button == 1
            && clickCount == 1
            && !this._viewSelectionChanged)
            this._queueControlsFlip();
        else
            this._cancelControlsFlip();

        this._viewSelectionChanged = false;

        return false;
    },

    _onScrollbarClick: function() {
        this.controlsVisible = false;
        return false;
    },

    _onAdjustmentChanged: function() {
        if (!this._pageChanged)
            this.controlsVisible = false;
        this._pageChanged = false;
    },

    _changeRotation: function(offset) {
        let rotation = this._model.get_rotation();
        this._model.set_rotation(rotation + offset);
    },

    get controlsVisible() {
        return this._controlsVisible;
    },

    set controlsVisible(visible) {
        // reset any pending timeout, as we're about to change controls state
        this._cancelControlsFlip();

        if (this._controlsVisible == visible)
            return;

        this._controlsVisible = visible;
        this._syncControlsVisible();
    },

    activateResult: function() {
        this.view.find_next();
    },

    startSearch: function(str) {
        if (!this._model)
            return;

        if (this._jobFind) {
            if (!this._jobFind.is_finished())
                this._jobFind.cancel();
            this._jobFind = null;
        }

        this._lastSearch = str;

        if (!str) {
            this.view.queue_draw();
            return;
        }

        let evDoc = this._model.get_document();
        this._jobFind = EvView.JobFind.new(evDoc, this._model.get_page(), evDoc.get_n_pages(),
                                           str, false);
        this._jobFind.connect('updated', Lang.bind(this, this._onSearchJobUpdated));

        this._jobFind.scheduler_push_job(EvView.JobPriority.PRIORITY_NONE);
    },

    _onSearchJobUpdated: function(job, page) {
        // FIXME: ev_job_find_get_results() returns a GList **
        // and thus is not introspectable
        GdPrivate.ev_view_find_changed(this.view, job, page);
        this.emit('search-changed', job.has_results());
    },

    reset: function() {
        this.setModel(null);
        this.view.destroy();
        this._navControls.destroy();
        this._createView();
    },

    setModel: function(model) {
        if (this._model == model)
            return;

        if (this.view) {
            this.controlsVisible = false;
            this._lastSearch = '';
        }

        this._model = model;

        if (this._model) {
            this.view.set_model(this._model);
            this._navControls.setModel(model);
            this._navControls.show();
            this._togglePresentation.enabled = true;

            if (Application.documentManager.metadata)
                this._bookmarks = new GdPrivate.Bookmarks({ metadata: Application.documentManager.metadata });

            let hasMultiplePages = (this._model.document.get_n_pages() > 1);
            this._bookmarkPage.enabled = hasMultiplePages && this._bookmarks;
            this._showPlaces.enabled = hasMultiplePages;

            this._model.connect('page-changed', Lang.bind(this, this._onPageChanged));

            this._updateNightMode();

            this.set_visible_child_full('view', Gtk.StackTransitionType.NONE);
        }
    },

    _updateNightMode: function() {
        if (this._model) {
            let nightMode = Application.settings.get_boolean('night-mode');
            this._model.set_inverted_colors(nightMode);
        }
    },

    getModel: function() {
        return this._model;
    },

    getFullscreenToolbar: function() {
        return this._fsToolbar;
    },

    get lastSearch() {
        return this._lastSearch;
    }
});
Signals.addSignalMethods(PreviewView.prototype);

const _PREVIEW_NAVBAR_MARGIN = 30;
const _AUTO_HIDE_TIMEOUT = 2;

const PreviewNavControls = new Lang.Class({
    Name: 'PreviewNavControls',

    _init: function(previewView, overlay) {
        this._previewView = previewView;
        this._model = previewView.getModel();
        this._overlay = overlay;

        this._visible = false;
        this._visibleInternal = false;
        this._pageChangedId = 0;
        this._autoHideId = 0;
        this._motionId = 0;

        this.bar_widget = new GdPrivate.NavBar({ document_model: this._model,
                                                 margin: _PREVIEW_NAVBAR_MARGIN,
                                                 valign: Gtk.Align.END,
                                                 opacity: 0 });
        this.bar_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.bar_widget);
        this.bar_widget.connect('notify::hover', Lang.bind(this, function() {
            if (this.bar_widget.hover)
                this._onEnterNotify();
            else
                this._onLeaveNotify();
        }));

        let buttonArea = this.bar_widget.get_button_area();

        let button = new Gtk.Button({ action_name: 'app.places',
                                      image: new Gtk.Image({ icon_name: 'view-list-symbolic',
                                                             pixel_size: 16 }),
                                      valign: Gtk.Align.CENTER,
                                      tooltip_text: _("Bookmarks")
                                    });
        buttonArea.pack_start(button, false, false, 0);

        button = new Gtk.ToggleButton({ action_name: 'app.bookmark-page',
                                        image: new Gtk.Image({ icon_name: 'bookmark-new-symbolic',
                                                               pixel_size: 16 }),
                                        valign: Gtk.Align.CENTER,
                                        tooltip_text: _("Bookmark this page")
                                      });
        buttonArea.pack_start(button, false, false, 0);

        this.prev_widget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-previous-symbolic',
                                                                    pixel_size: 16 }),
                                            margin_start: _PREVIEW_NAVBAR_MARGIN,
                                            margin_end: _PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.START,
                                            valign: Gtk.Align.CENTER });
        this.prev_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.prev_widget);
        this.prev_widget.connect('clicked', Lang.bind(this, this._onPrevClicked));
        this.prev_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.prev_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));

        this.next_widget = new Gtk.Button({ image: new Gtk.Image ({ icon_name: 'go-next-symbolic',
                                                                    pixel_size: 16 }),
                                            margin_start: _PREVIEW_NAVBAR_MARGIN,
                                            margin_end: _PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.END,
                                            valign: Gtk.Align.CENTER });
        this.next_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.next_widget);
        this.next_widget.connect('clicked', Lang.bind(this, this._onNextClicked));
        this.next_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.next_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));

        this._overlay.connect('motion-notify-event', Lang.bind(this, this._onMotion));

        this._tapGesture = new Gtk.GestureMultiPress({ propagation_phase: Gtk.PropagationPhase.CAPTURE,
                                                       touch_only: true,
                                                       widget: this._previewView.view });
        this._tapGesture.connect('released', Lang.bind(this, this._onMultiPressReleased));
        this._tapGesture.connect('stopped', Lang.bind(this, this._onMultiPressStopped));
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

    _onMultiPressReleased: function() {
        this._tapGesture.set_state(Gtk.EventSequenceState.CLAIMED);
        this._visibleInternal = !this._visibleInternal;
        this._unqueueAutoHide();
        this._updateVisibility();
    },

    _onMultiPressStopped: function() {
        this._tapGesture.set_state(Gtk.EventSequenceState.DENIED);
    },

    _onPrevClicked: function() {
        this._previewView.view.previous_page();
    },

    _onNextClicked: function() {
        this._previewView.view.next_page();
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
        this._autoHideId = Mainloop.timeout_add_seconds(_AUTO_HIDE_TIMEOUT, Lang.bind(this, this._autoHide));
    },

    _updateVisibility: function() {
        if (!this._model || !this._visible || !this._visibleInternal) {
            this._fadeOutButton(this.bar_widget);
            this._fadeOutButton(this.prev_widget);
            this._fadeOutButton(this.next_widget);
            return;
        }

        this._fadeInButton(this.bar_widget);

        if (this._model.page > 0)
            this._fadeInButton(this.prev_widget);
        else
            this._fadeOutButton(this.prev_widget);

        let doc = this._model.document;
        if (doc.get_n_pages() > this._model.page + 1)
            this._fadeInButton(this.next_widget);
        else
            this._fadeOutButton(this.next_widget);
    },

    setModel: function(model) {
        if (this._pageChangedId != 0) {
            this._model.disconnect(this._pageChangedId);
            this._pageChangedId = 0;
        }

        this._model = model;
        this.bar_widget.document_model = model;

        if (this._model)
            this._pageChangedId = this._model.connect('page-changed', Lang.bind(this, this._updateVisibility));
    },

    _fadeInButton: function(widget) {
        if (!this._model)
            return;
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
        this.bar_widget.destroy();
        this.prev_widget.destroy();
        this.next_widget.destroy();
        this._tapGesture = null;
    }
});

const PreviewToolbar = new Lang.Class({
    Name: 'PreviewToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(previewView) {
        this._previewView = previewView;

        this.parent();
        this.toolbar.set_show_close_button(true);

        this._handleEvent = false;
        this._model = null;

        this._searchAction = Application.application.lookup_action('search');
        this._searchAction.enabled = false;

        this._gearMenu = Application.application.lookup_action('gear-menu');
        this._gearMenu.enabled = false;

        // back button, on the left of the toolbar
        let backButton = this.addBackButton();
        backButton.connect('clicked', Lang.bind(this,
            function() {
                Application.documentManager.setActiveItem(null);
                Application.modeController.goBack();
                this._searchAction.enabled = true;
            }));

        // menu button, on the right of the toolbar
        let previewMenu = this._getPreviewMenu();
        let menuButton = new Gtk.MenuButton({ image: new Gtk.Image ({ icon_name: 'open-menu-symbolic' }),
                                              menu_model: previewMenu,
                                              action_name: 'app.gear-menu' });
        this.toolbar.pack_end(menuButton);

        // search button, on the right of the toolbar
        this.addSearchButton();

        this._setToolbarTitle();
        this.toolbar.show_all();

        this.connect('destroy', Lang.bind(this,
            function() {
                this._searchAction.enabled = true;
            }));
    },

    _enableSearch: function() {
        if (!this._model)
            return;

        let evDoc = this._model.get_document();
        let hasPages = (evDoc.get_n_pages() > 0);
        let isFind = true;

        try {
            // This is a hack to find out if evDoc implements the
            // EvDocument.DocumentFind interface or not. We don't expect
            // the following invocation to work.
            evDoc.find_text();
        } catch (e if e instanceof TypeError) {
            isFind = false;
        } catch (e) {
        }

        this._handleEvent = (hasPages && isFind);
        this._searchAction.enabled = (hasPages && isFind);
    },

    _getPreviewMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/documents/preview-menu.ui');
        let menu = builder.get_object('preview-menu');

        let doc = Application.documentManager.getActiveItem();
        if (doc && doc.defaultAppName) {
            let section = builder.get_object('open-section');
            section.remove(0);
            section.prepend(_("Open with %s").format(doc.defaultAppName), 'app.open-current');
        }

        return menu;
    },

    createSearchbar: function() {
        return new PreviewSearchbar(this._previewView);
    },

    _setToolbarTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.toolbar.set_title(primary);
    },

    setModel: function(model) {
        if (!model)
            return;

        this._model = model;
        this._gearMenu.enabled = true;
        this._enableSearch();
        this._setToolbarTitle();
    }
});

const PreviewSearchbar = new Lang.Class({
    Name: 'PreviewSearchbar',
    Extends: Searchbar.Searchbar,

    _init: function(previewView) {
        this._previewView = previewView;
        this._previewView.connect('search-changed', Lang.bind(this, this._onSearchChanged));

        this.parent();
    },

    createSearchWidgets: function() {
        this._searchContainer = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                              spacing: 6,
                                              halign: Gtk.Align.CENTER});

        this._searchEntry = new Gtk.SearchEntry({ width_request: 500 });
        this._searchEntry.connect('activate', Lang.bind(this,
            function() {
                Application.application.activate_action('find-next', null);
            }));
        this._searchContainer.add(this._searchEntry);

        let controlsBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
        controlsBox.get_style_context().add_class('linked');
        controlsBox.get_style_context().add_class('raised');
        this._searchContainer.add(controlsBox);

        this._prev = new Gtk.Button({ action_name: 'app.find-prev' });
        this._prev.set_image(new Gtk.Image({ icon_name: 'go-up-symbolic',
                                             icon_size: Gtk.IconSize.MENU,
                                             margin: 2 }));
        this._prev.set_tooltip_text(_("Find Previous"));
        controlsBox.add(this._prev);

        this._next = new Gtk.Button({ action_name: 'app.find-next' });
        this._next.set_image(new Gtk.Image({ icon_name: 'go-down-symbolic',
                                             icon_size: Gtk.IconSize.MENU,
                                             margin: 2 }));
        this._next.set_tooltip_text(_("Find Next"));
        controlsBox.add(this._next);

        this._onSearchChanged(this._previewView, false);
    },

    _onSearchChanged: function(view, hasResults) {
        let findPrev = Application.application.lookup_action('find-prev');
        let findNext = Application.application.lookup_action('find-next');
        findPrev.enabled = hasResults;
        findNext.enabled = hasResults;
    },

    entryChanged: function() {
        this._previewView.view.find_search_changed();
        this._previewView.startSearch(this._searchEntry.get_text());
    },

    reveal: function() {
        this.parent();

        if (!this._searchEntry.get_text()) {
            this._searchEntry.set_text(this._previewView.lastSearch);
            this._searchEntry.select_region(0, -1);
        }

        this._previewView.view.find_set_highlight_search(true);
        this._previewView.startSearch(this._searchEntry.get_text());
    },

    conceal: function() {
        this._previewView.view.find_set_highlight_search(false);

        this.searchChangeBlocked = true;
        this.parent();
        this.searchChangeBlocked = false;
    }
});

const PreviewFullscreenToolbar = new Lang.Class({
    Name: 'PreviewFullscreenToolbar',
    Extends: Gtk.Revealer,

    _init: function(previewView) {
        this.parent({ valign: Gtk.Align.START });

        this._toolbar = new PreviewToolbar(previewView);

        this.add(this._toolbar);
        this.show();

        // make controls show when a toolbar action is activated in fullscreen
        let actionNames = ['gear-menu', 'search'];
        let signalIds = [];

        actionNames.forEach(Lang.bind(this,
            function(actionName) {
                let signalName = 'action-state-changed::' + actionName;
                let signalId = Application.application.connect(signalName, Lang.bind(this,
                    function(actionGroup, actionName, value) {
                        let state = value.get_boolean();
                        if (state)
                            this.emit('show-controls');
                    }));

                signalIds.push(signalId);
            }));

        this._toolbar.connect('destroy', Lang.bind(this,
            function() {
                signalIds.forEach(
                    function(signalId) {
                        Application.application.disconnect(signalId);
                    });
            }));
    },

    handleEvent: function(event) {
        this._toolbar.handleEvent(event);
    },

    setModel: function(model) {
        this._toolbar.setModel(model);
    },

    reveal: function() {
        this.set_reveal_child(true);
    },

    conceal: function() {
        this.set_reveal_child(false);
        Application.application.change_action_state('search', GLib.Variant.new('b', false));
    }
});
Signals.addSignalMethods(PreviewFullscreenToolbar.prototype);
