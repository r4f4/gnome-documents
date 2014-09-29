/*
 * Copyright (c) 2013, 2014 Red Hat, Inc.
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
 */

const EvDocument = imports.gi.EvinceDocument;
const EvView = imports.gi.EvinceView;
const GnomeDesktop = imports.gi.GnomeDesktop;
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

const PresentationWindow = new Lang.Class({
    Name: 'PresentationWindow',

    _init: function(model) {
        this._model = model;
        this._inhibitId = 0;

        let toplevel = Application.application.get_windows()[0];
        this.window = new Gtk.Window ({ type: Gtk.WindowType.TOPLEVEL,
                                        transient_for: toplevel,
                                        destroy_with_parent: true,
                                        title: _("Presentation"),
                                        hexpand: true });
        this.window.connect('key-press-event',
                            Lang.bind(this, this._onKeyPressEvent));

        this._model.connect('page-changed',
                            Lang.bind(this, this._onPageChanged));

        this._createView();
        this.window.fullscreen();
        this.window.show_all();
    },

    _onPageChanged: function() {
        this.view.current_page = this._model.page;
    },

    _onPresentationPageChanged: function() {
        this._model.page = this.view.current_page;
    },

    _onKeyPressEvent: function(widget, event) {
        let keyval = event.get_keyval()[1];
        if (keyval == Gdk.KEY_Escape)
            this.close();
    },

    setOutput: function(output) {
        let [x, y, width, height] = output.get_geometry();
        this.window.move(x, y);
    },

    _createView: function() {
        let doc = this._model.get_document();
        let inverted = this._model.inverted_colors;
        let page = this._model.page;
        let rotation = this._model.rotation;
        this.view = new EvView.ViewPresentation({ document: doc,
                                                  current_page: page,
                                                  rotation: rotation,
                                                  inverted_colors: inverted });
        this.view.connect('finished', Lang.bind(this, this.close));
        this.view.connect('notify::current-page', Lang.bind(this, this._onPresentationPageChanged));

        this.window.add(this.view);
        this.view.show();

        this._inhibitIdle();
    },

    close: function() {
        this._uninhibitIdle();
        this.window.destroy();
    },

    _inhibitIdle: function() {
        this._inhibitId = Application.application.inhibit(null,
                                                          Gtk.ApplicationInhibitFlags.IDLE,
                                                          _("Running in presentation mode"));
    },

    _uninhibitIdle: function() {
        if (this._inhibitId == 0)
            return;

        Application.application.uninhibit(this._inhibitId);
        this._inhibitId = 0;
    }
});

const PresentationOutputChooser = new Lang.Class({
    Name: 'PresentationOutputChooser',

    _init: function(outputs) {
        this.output = null;
        this._outputs = outputs;
        this._createWindow();
        this._populateList();
        this.window.show_all();
    },

    _populateList: function() {
        let sizeGroup = new Gtk.SizeGroup({ mode: Gtk.SizeGroupMode.HORIZONTAL });

        for (let i = 0; i < this._outputs.list.length; i++) {
            let row = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL,
                                     column_spacing: 12,
                                     border_width: 12});
            this._box.add(row);

            let output = this._outputs.list[i];
            row.output = output;

            let preview = new GdPrivate.DisplayPreview({ info: output, clone: this._outputs.clone });
            sizeGroup.add_widget(preview);
            row.add(preview);

            let label = new Gtk.Label({ label: output.get_display_name() });
            row.add(label);

            if (this._outputs.list.length > 1) {
                let status;

                if (this._outputs.clone)
                    // Translators: "Mirrored" describes when both displays show the same view
                    status = _("Mirrored");
                else if (output.get_primary())
                    status = _("Primary");
                else if (!output.is_active())
                    status = _("Off");
                else
                    status = _("Secondary");

                label = new Gtk.Label({ label: status,
                                        halign: Gtk.Align.END,
                                        hexpand: true });
                row.add(label);

                this._box.show_all();
            }

            if (!output.is_active())
                row.sensitive = false;
        }
    },

    _onActivated: function(box, row) {
        let output = row.get_child().output;
        if (!output.is_active())
            return;

        this.output = output;
        this.emit('output-activated', this.output);
        this.close();
    },

    close: function() {
        this.window.destroy();
    },

    _createWindow: function() {
        let toplevel = Application.application.get_windows()[0];
        this.window = new Gtk.Dialog ({ resizable: false,
                                        modal: true,
                                        transient_for: toplevel,
                                        destroy_with_parent: true,
                                        use_header_bar: true,
                                        title: _("Present On"),
                                        default_width: 300,
                                        default_height: 150,
                                        border_width: 5,
                                        hexpand: true });
        this.window.connect('response', Lang.bind(this,
            function(widget, response) {
                this.emit('output-activated', null);
            }));

        let frame = new Gtk.Frame({ shadow_type: Gtk.ShadowType.IN });

        this._box = new Gtk.ListBox({ hexpand: true,
                                      valign: Gtk.Align.CENTER,
                                      selection_mode: Gtk.SelectionMode.NONE });
        frame.add(this._box);
        this._box.connect('row-activated', Lang.bind(this, this._onActivated));
        this._box.set_header_func(Lang.bind(this,
            function(row, before) {
                if (!before)
                    return;

                let current = row.get_header();
                if (!current) {
                    current = new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL });
                    current.show();
                    row.set_header(current);
                }
            }));

        let contentArea = this.window.get_content_area();
        contentArea.pack_start(frame, true, false, 0);
    }
});
Signals.addSignalMethods(PresentationOutputChooser.prototype);

const PresentationOutputs = new Lang.Class({
    Name: 'PresentationOutputs',

    _init: function() {
        this.list = [];

        let gdkscreen = Gdk.Screen.get_default();
        this._screen = GnomeDesktop.RRScreen.new(gdkscreen, null);
        this._screen.connect('changed', Lang.bind(this, this._onScreenChanged));

        this._config = GnomeDesktop.RRConfig.new_current(this._screen);
        this.clone = this._config.get_clone();
        this._infos = this._config.get_outputs();

        this.load();
    },

    _onScreenChanged: function() {
        this.load();
    },

    load: function() {
        this.list = [];
        for (let idx in this._infos) {
            let info = this._infos[idx];
            let name = info.get_name();
            let output = this._screen.get_output_by_name(name);

            if (output.is_builtin_display())
                this.list.unshift(info);
            else
                this.list.push(info);
        }
    }
});
