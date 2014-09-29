/* -*- Mode: C; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 8 -*-
 *
 * Copyright (C) 2014 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
 */

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include "gd-display-preview.h"

#include <glib.h>

#define GNOME_DESKTOP_USE_UNSTABLE_API
#include <libgnome-desktop/gnome-rr.h>
#include <libgnome-desktop/gnome-bg.h>

struct _GdDisplayPreview {
        GtkDrawingArea parent_instance;
        GnomeRROutputInfo *info;
        gboolean clone;
        gint width;
        gint height;
};

struct _GdDisplayPreviewClass {
        GtkDrawingAreaClass parent_class;
};

G_DEFINE_TYPE (GdDisplayPreview, gd_display_preview, GTK_TYPE_DRAWING_AREA);

#define TOP_BAR_HEIGHT 5
#define DISPLAY_PREVIEW_LIST_HEIGHT  55

enum {
        PROP_CLONE = 1,
        PROP_INFO,
        NUM_PROPERTIES
};

static gboolean
gd_display_preview_draw (GtkWidget *widget,
                         cairo_t   *cr)
{
        GdDisplayPreview *self = GD_DISPLAY_PREVIEW (widget);
        GdkPixbuf *pixbuf;
        GnomeRRRotation rotation;
        gboolean active;
        gint allocated_height;
        gint allocated_width;
        gint height;
        gint width;
        gint x, y;

        allocated_width = gtk_widget_get_allocated_width (widget);
        allocated_height = gtk_widget_get_allocated_height (widget);
        rotation = gnome_rr_output_info_get_rotation (self->info);

        x = y = 0;
        height = self->height;
        width = self->width;

        if ((rotation & GNOME_RR_ROTATION_90) || (rotation & GNOME_RR_ROTATION_270)) {
                gint tmp;

                /* swap width and height */
                tmp = width;
                width = height;
                height = tmp;
        }

        /* scale to fit allocation */
        if (width / (double) height < allocated_width / (double) allocated_height) {
                width = allocated_height * (width / (double) height);
                height = allocated_height;
        } else {
                height = allocated_width * (height / (double) width);
                width = allocated_width;
        }

        x = (allocated_width / 2.0) - (width / 2.0);
        cairo_set_source_rgb (cr, 0, 0, 0);
        cairo_rectangle (cr, x, y, width, height);
        cairo_fill (cr);

        if (gnome_rr_output_info_is_active (self->info)) {
                GdkScreen *screen;
                GnomeBG *bg;
                GnomeDesktopThumbnailFactory *factory;
                GSettings *settings;

                bg = gnome_bg_new ();
                settings = g_settings_new ("org.gnome.desktop.background");
                gnome_bg_load_from_preferences (bg, settings);

                factory = gnome_desktop_thumbnail_factory_new (GNOME_DESKTOP_THUMBNAIL_SIZE_NORMAL);
                screen = gdk_screen_get_default ();

                pixbuf = gnome_bg_create_thumbnail (bg, factory, screen, width, height);

                g_object_unref (factory);
                g_object_unref (settings);
                g_object_unref (bg);
        } else {
                pixbuf = NULL;
        }

        if (gnome_rr_output_info_get_primary (self->info) || self->clone) {
                y += TOP_BAR_HEIGHT;
                height -= TOP_BAR_HEIGHT;
        }

        if (pixbuf != NULL)
                gdk_cairo_set_source_pixbuf (cr, pixbuf, x + 1, y + 1);
        else
                cairo_set_source_rgb (cr, 0.3, 0.3, 0.3);

        cairo_rectangle (cr, x + 1, y + 1, width - 2, height - 2);
        cairo_fill (cr);

        g_clear_object (&pixbuf);

        return GDK_EVENT_STOP;
}

static void
gd_display_preview_set_property (GObject      *object,
                                 guint         prop_id,
                                 const GValue *value,
                                 GParamSpec   *pspec)
{
        GdDisplayPreview *self = GD_DISPLAY_PREVIEW (object);

        switch (prop_id) {
        case PROP_CLONE:
                self->clone = g_value_get_boolean (value);
                break;
        case PROP_INFO:
                self->info = g_value_dup_object (value);
                break;
        default:
                G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
                break;
        }
}

static void
gd_display_preview_constructed (GObject *object)
{
        GdDisplayPreview *self = GD_DISPLAY_PREVIEW (object);
        gint height;
        gint width;

        G_OBJECT_CLASS (gd_display_preview_parent_class)->constructed (object);

        if (gnome_rr_output_info_is_active (self->info)) {
                gnome_rr_output_info_get_geometry (self->info, NULL, NULL, &width, &height);
        } else {
                width = gnome_rr_output_info_get_preferred_width (self->info);
                height = gnome_rr_output_info_get_preferred_height (self->info);
        }

        gtk_widget_set_size_request (GTK_WIDGET (self),
                                     DISPLAY_PREVIEW_LIST_HEIGHT * (width / (gdouble) height),
                                     DISPLAY_PREVIEW_LIST_HEIGHT);
        self->height = height;
        self->width = width;
}

static void
gd_display_preview_dispose (GObject *object)
{
        GdDisplayPreview *self = GD_DISPLAY_PREVIEW (object);

        g_clear_object (&self->info);

        G_OBJECT_CLASS (gd_display_preview_parent_class)->dispose (object);
}

static void
gd_display_preview_class_init (GdDisplayPreviewClass *class)
{
        GObjectClass *oclass = G_OBJECT_CLASS (class);
        GtkWidgetClass *wclass = GTK_WIDGET_CLASS (class);

        oclass->constructed = gd_display_preview_constructed;
        oclass->dispose = gd_display_preview_dispose;
        oclass->set_property = gd_display_preview_set_property;
        wclass->draw = gd_display_preview_draw;

        g_object_class_install_property (oclass,
                                         PROP_CLONE,
                                         g_param_spec_boolean ("clone",
                                                               "Clone",
                                                               "Whether this is part of a cloned configuration",
                                                               FALSE,
                                                               G_PARAM_CONSTRUCT_ONLY |
                                                               G_PARAM_WRITABLE |
                                                               G_PARAM_STATIC_STRINGS));

        g_object_class_install_property (oclass,
                                         PROP_INFO,
                                         g_param_spec_object ("info",
                                                              "GnomeRROutputInfo",
                                                              "The info describing this display",
                                                              GNOME_TYPE_RR_OUTPUT_INFO,
                                                              G_PARAM_CONSTRUCT_ONLY |
                                                              G_PARAM_WRITABLE |
                                                              G_PARAM_STATIC_STRINGS));
}

static void
gd_display_preview_init (GdDisplayPreview *self)
{
}

/**
 * gd_display_preview_new:
 * @info:
 * @clone:
 *
 * Creates a new display preview widget.
 *
 * Returns: a new #GdDisplayPreview object.
 **/
GtkWidget *
gd_display_preview_new (GnomeRROutputInfo *info,
                        gboolean           clone)
{
        return g_object_new (GD_TYPE_DISPLAY_PREVIEW,
                             "halign", GTK_ALIGN_CENTER,
                             "valign", GTK_ALIGN_CENTER,
                             "clone", clone,
                             "info", info,
                             NULL);
}
