SUBDIRS = icons

appdatadir = $(datadir)/appdata
appdata_DATA = $(appdata_in_files:.xml.in=.xml)
appdata_in_files = gnome-documents.appdata.xml.in

@INTLTOOL_XML_RULE@

desktopdir = $(datadir)/applications
desktop_DATA = $(desktop_in_files:.desktop.in=.desktop)
desktop_in_files = gnome-documents.desktop.in

searchproviderdir = $(datadir)/gnome-shell/search-providers
searchprovider_DATA = gnome-documents-search-provider.ini

@INTLTOOL_DESKTOP_RULE@

check-local: gnome-documents.desktop
	$(DESKTOP_FILE_VALIDATE) gnome-documents.desktop

gsettings_ENUM_NAMESPACE = org.gnome.Documents
gsettings_ENUM_FILES = \
    $(top_srcdir)/libgd/libgd/gd-main-view.h

gsettings_SCHEMAS = org.gnome.documents.gschema.xml
.PRECIOUS: $(gsettings_SCHEMAS)

@GSETTINGS_RULES@

EXTRA_DIST= \
    gnome-documents.desktop \
    $(appdata_in_files) \
    $(desktop_in_files) \
    $(searchprovider_DATA) \
    $(gsettings_SCHEMAS)

CLEANFILES = \
    $(appdata_DATA) \
    $(desktop_DATA)
