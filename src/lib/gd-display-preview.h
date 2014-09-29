/*
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

#ifndef __GD_DISPLAY_PREVIEW_H__
#define __GD_DISPLAY_PREVIEW_H__

#include <gtk/gtk.h>

#define GNOME_DESKTOP_USE_UNSTABLE_API
#include <libgnome-desktop/gnome-rr-config.h>

G_BEGIN_DECLS

typedef struct _GdDisplayPreview GdDisplayPreview;
typedef struct _GdDisplayPreviewClass GdDisplayPreviewClass;

#define GD_TYPE_DISPLAY_PREVIEW            (gd_display_preview_get_type ())
#define GD_DISPLAY_PREVIEW(obj)            (G_TYPE_CHECK_INSTANCE_CAST((obj), GD_TYPE_DISPLAY_PREVIEW, GdDisplayPreview))
#define GD_DISPLAY_PREVIEW_CLASS(klass)    (G_TYPE_CHECK_CLASS_CAST((klass),  GD_TYPE_DISPLAY_PREVIEW, GdDisplayPreviewClass))
#define GD_IS_DISPLAY_PREVIEW(obj)         (G_TYPE_CHECK_INSTANCE_TYPE((obj), GD_TYPE_DISPLAY_PREVIEW))
#define GD_IS_DISPLAY_PREVIEW_CLASS(klass) (G_TYPE_CHECK_CLASS_TYPE((klass),  GD_TYPE_DISPLAY_PREVIEW))
#define GD_DISPLAY_PREVIEW_GET_CLASS(obj)  (G_TYPE_INSTANCE_GET_CLASS((obj),  GD_TYPE_DISPLAY_PREVIEW, GdDisplayPreviewClass))

GType            gd_display_preview_get_type           (void) G_GNUC_CONST;

GtkWidget       *gd_display_preview_new                (GnomeRROutputInfo *info,
                                                        gboolean           clone);

G_END_DECLS

#endif /* __GD_DISPLAY_PREVIEW_H__ */
