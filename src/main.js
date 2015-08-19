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

pkg.initGettext();
pkg.initFormat();
// for libgd
pkg.initSubmodule('libgd');
// for gdprivate
pkg.initSubmodule('src');
pkg.require({ 'EvinceDocument': '3.0',
              'Gd': '1.0',
              'GdPrivate': '1.0',
              'Gio': '2.0',
              'GLib': '2.0',
              'Goa': '1.0',
              'Gtk': '3.0',
              'GObject': '2.0',
              'Tracker': '1.0',
              'TrackerControl': '1.0',
              'WebKit2': '4.0' });

const Application = imports.application;
const GLib = imports.gi.GLib;
const System = imports.system;

function main(args) {
    let application = new Application.Application(pkg.name == 'org.gnome.Books');
    if (GLib.getenv('DOCUMENTS_PERSIST'))
        application.hold();
    return application.run(args);
}
