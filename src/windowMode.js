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

const Gdk = imports.gi.Gdk;

const Lang = imports.lang;
const Signals = imports.signals;

const Application = imports.application;

const WindowMode = {
    NONE: 0,
    DOCUMENTS: 1,
    PREVIEW: 2,
    EDIT: 3,
    COLLECTIONS: 4,
    SEARCH: 5
};

const ModeController = new Lang.Class({
    Name: 'ModeController',

    _init: function() {
        this._mode = WindowMode.NONE;
        this._fullscreen = false;
        this._history = [];
    },

    goBack: function(steps) {
        if (!steps)
            steps = 1;

        let oldMode;

        for (let i = 0; i < steps; i++) {
            oldMode = this._history.pop();
            if (!oldMode || oldMode == WindowMode.NONE)
                return;
        }

        // Swap the old and current modes.
        let tmp = oldMode;
        oldMode = this._mode;
        this._mode = tmp;

        this._updateFullscreen();
        this.emit('window-mode-changed', this._mode, oldMode);
    },

    setWindowMode: function(mode) {
        let oldMode = this._mode;

        if (oldMode == mode)
            return;

        this._history.push(oldMode);
        this._mode = mode;

        this._updateFullscreen();
        this.emit('window-mode-changed', this._mode, oldMode);
    },

    getWindowMode: function() {
        return this._mode;
    },

    _updateFullscreen: function() {
        if (!this.getCanFullscreen() && this._fullscreen)
            this._setFullscreen(false);

        this.emit('can-fullscreen-changed');
    },

    setFullscreen: function(fullscreen) {
        if (this._fullscreen == fullscreen)
            return;

        this._fullscreen = fullscreen;
        this.emit('fullscreen-changed', this._fullscreen);
    },

    toggleFullscreen: function() {
        this.setFullscreen(!this._fullscreen);
    },

    getFullscreen: function() {
        return this._fullscreen;
    },

    getCanFullscreen: function() {
        return (this._mode == WindowMode.PREVIEW || this._mode == WindowMode.EDIT);
    }
});
Signals.addSignalMethods(ModeController.prototype);
