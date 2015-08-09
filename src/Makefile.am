AM_CPPFLAGS = \
    -I$(top_builddir)/config \
    -I$(top_srcdir)	\
    -L$(top_srcdir)/src \
    -DGNOME_DOCUMENTS_LIBDIR=\"$(libdir)\" \
    -DGNOME_DOCUMENTS_DATADIR=\"$(datadir)\" \
    -DGNOME_DOCUMENTS_PKGDATADIR=\"$(pkgdatadir)\" \
    -DGNOME_DOCUMENTS_TOP_SRCDIR=\"$(abs_top_srcdir)\" \
    -DGNOME_DOCUMENTS_BUILDDIR=\"$(abs_top_builddir)\"

girdir = $(pkgdatadir)/gir-1.0
typelibdir = $(pkglibdir)/girepository-1.0

appdir = $(pkgdatadir)
nodist_app_SCRIPTS = org.gnome.Documents org.gnome.Books

BUILT_SOURCES =
EXTRA_DIST =
CLEANFILES =
pkglib_LTLIBRARIES =
INTROSPECTION_GIRS =
gir_DATA =
typelib_DATA =
libexec_PROGRAMS =
libexec_SCRIPTS =

# convenience command for doing Makefile variable substitutions in non-Makefile
# files (scripts, service files, etc.)
do_subst = sed -e 's|@abs_top_srcdir[@]|$(abs_top_srcdir)|g' \
               -e 's|@abs_top_builddir[@]|$(abs_top_builddir)|g' \
               -e 's|@localedir[@]|$(localedir)|g' \
               -e 's|@bindir[@]|$(bindir)|g' \
               -e 's|@libdir[@]|$(libdir)|g' \
               -e 's|@libexecdir[@]|$(libexecdir)|g' \
               -e 's|@pkglibdir[@]|$(pkglibdir)|g' \
               -e 's|@pkgdatadir[@]|$(pkgdatadir)|g' \
               -e 's|@GJS[@]|$(GJS)|g' \
               -e 's|@PACKAGE_NAME[@]|$(PACKAGE_NAME)|g' \
               -e 's|@PACKAGE_VERSION[@]|$(PACKAGE_VERSION)|g' \
               -e 's|@GETTEXT_PACKAGE[@]|$(GETTEXT_PACKAGE)|g' \
               -e 's|@prefix[@]|$(prefix)|g'

include $(INTROSPECTION_MAKEFILE)
include Makefile-lib.am

documents_app_resource_files =						\
	$(shell $(GLIB_COMPILE_RESOURCES)				\
		--sourcedir=$(srcdir)					\
		--generate-dependencies					\
		$(srcdir)/org.gnome.Documents.src.gresource.xml		\
	)

org.gnome.Documents.src.gresource: org.gnome.Documents.src.gresource.xml $(documents_app_resource_files)
	$(AM_V_GEN) $(GLIB_COMPILE_RESOURCES)				\
		--target=$@						\
		--sourcedir=$(srcdir) $<

books_app_resource_files =						\
	$(shell $(GLIB_COMPILE_RESOURCES)				\
		--sourcedir=$(srcdir)					\
		--generate-dependencies					\
		$(srcdir)/org.gnome.Books.src.gresource.xml		\
	)

org.gnome.Books.src.gresource: org.gnome.Books.src.gresource.xml $(books_app_resource_files)
	$(AM_V_GEN) $(GLIB_COMPILE_RESOURCES)				\
		--target=$@						\
		--sourcedir=$(srcdir) $<

resourcedir = $(pkgdatadir)
resource_DATA = org.gnome.Documents.src.gresource org.gnome.Books.src.gresource

CLEANFILES += $(resource_DATA)
EXTRA_DIST += \
    $(documents_app_resource_files) \
    $(books_app_resource_files) \
    org.gnome.Documents.src.gresource.xml \
    org.gnome.Books.src.gresource.xml

gir_DATA += $(INTROSPECTION_GIRS)
typelib_DATA += $(gir_DATA:.gir=.typelib)

CLEANFILES += $(gir_DATA) $(typelib_DATA)

service_in_files = org.gnome.Documents.service.in org.gnome.Books.service.in
servicedir = $(datadir)/dbus-1/services
service_DATA = org.gnome.Documents.service org.gnome.Books.service

org.gnome.Documents.service: org.gnome.Documents.service.in
	$(AM_V_GEN) $(do_subst) $< > $@

org.gnome.Books.service: org.gnome.Books.service.in
	$(AM_V_GEN) $(do_subst) $< > $@

CLEANFILES += $(service_DATA)
EXTRA_DIST += $(service_in_files)

org.gnome.Documents: org.gnome.Documents.in
	$(AM_V_GEN) $(do_subst) $< > $@
	chmod +x $@

CLEANFILES += org.gnome.Documents
EXTRA_DIST += org.gnome.Documents.in

org.gnome.Books: org.gnome.Books.in
	$(AM_V_GEN) $(do_subst) $< > $@
	chmod +x $@

CLEANFILES += org.gnome.Books
EXTRA_DIST += org.gnome.Books.in

install-exec-hook:
	$(MKDIR_P) $(DESTDIR)$(bindir)
	-rm -f $(DESTDIR)$(bindir)/gnome-documents
	-rm -f $(DESTDIR)$(bindir)/gnome-books
	$(LN_S) $(appdir)/org.gnome.Documents $(DESTDIR)$(bindir)/gnome-documents
	$(LN_S) $(appdir)/org.gnome.Books $(DESTDIR)$(bindir)/gnome-books
uninstall-hook:
	-rm -f $(DESTDIR)$(bindir)/gnome-documents
	-rm -f $(DESTDIR)$(bindir)/gnome-books

-include $(top_srcdir)/git.mk
