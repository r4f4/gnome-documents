SUBDIRS = icons

appdir = $(pkgdatadir)

app_resource_files =							\
	$(shell $(GLIB_COMPILE_RESOURCES)				\
		--sourcedir=$(srcdir)					\
		--generate-dependencies					\
		$(srcdir)/org.gnome.Documents.data.gresource.xml	\
	)
org.gnome.Documents.data.gresource: org.gnome.Documents.data.gresource.xml $(app_resource_files)
	$(AM_V_GEN) $(GLIB_COMPILE_RESOURCES)				\
		--target=$@						\
		--sourcedir=$(srcdir) $<

resourcedir = $(pkgdatadir)
resource_DATA = org.gnome.Documents.data.gresource

appdatadir = $(datadir)/appdata
appdata_DATA = $(appdata_in_files:.xml.in=.xml)
appdata_in_files = \
	org.gnome.Documents.appdata.xml.in \
	org.gnome.Books.appdata.xml.in

@INTLTOOL_XML_RULE@

desktopdir = $(datadir)/applications
desktop_DATA = $(desktop_in_files:.desktop.in=.desktop)
desktop_in_files = org.gnome.Documents.desktop.in org.gnome.Books.desktop.in

searchproviderdir = $(datadir)/gnome-shell/search-providers
searchprovider_DATA = org.gnome.Documents.search-provider.ini

@INTLTOOL_DESKTOP_RULE@

check-local: org.gnome.Documents.desktop org.gnome.Books.desktop
	$(DESKTOP_FILE_VALIDATE) org.gnome.Documents.desktop
	$(DESKTOP_FILE_VALIDATE) org.gnome.Books.desktop

gsettings_ENUM_NAMESPACE = org.gnome.Documents
gsettings_ENUM_FILES = \
    $(top_srcdir)/libgd/libgd/gd-main-view.h

gsettings_SCHEMAS = org.gnome.documents.gschema.xml org.gnome.books.gschema.xml
.PRECIOUS: $(gsettings_SCHEMAS)

@GSETTINGS_RULES@

EXTRA_DIST= \
    $(appdata_in_files) \
    $(app_resource_files) \
    $(desktop_in_files) \
    $(searchprovider_DATA) \
    $(gsettings_SCHEMAS) \
    org.gnome.Documents.data.gresource.xml

CLEANFILES = \
    org.gnome.Documents.data.gresource \
    $(appdata_DATA) \
    $(desktop_DATA)

install-exec-hook:
	-rm -f $(appdir)/org.gnome.Books.data.gresource
	$(LN_S) $(appdir)/org.gnome.Documents.data.gresource $(DESTDIR)$(appdir)/org.gnome.Books.data.gresource
uninstall-hook:
	-rm -f $(appdir)/org.gnome.Books.data.gresource


-include $(top_srcdir)/git.mk
