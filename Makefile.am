ACLOCAL_AMFLAGS = -I m4 -I libgd ${ACLOCAL_FLAGS}

SUBDIRS = help libgd src data po
if BUILD_DOCUMENTATION
SUBDIRS += man
endif

if ENABLE_GETTING_STARTED

SUBDIRS += getting-started

dist-hook-getting-started:
else
dist-hook-getting-started:
	@echo "*** --enable-getting-started must be specified in order to make dist"
	@false
endif

DISTCHECK_CONFIGURE_FLAGS = --enable-getting-started

EXTRA_DIST = \
    autogen.sh \
    COPYING \
    NEWS

stale-files-clean-local:
	-$(RM) $(abs_top_builddir)/*.la $(abs_top_builddir)/*.gir $(abs_top_builddir)/*.typelib

MAINTAINERCLEANFILES = \
    $(srcdir)/AUTHORS \
    $(srcdir)/INSTALL \
    $(srcdir)/ar-lib \
    $(srcdir)/aclocal.m4 \
    $(srcdir)/autoscan.log \
    $(srcdir)/compile \
    $(srcdir)/config.guess \
    $(srcdir)/config.h.in \
    $(srcdir)/config.sub \
    $(srcdir)/configure.scan \
    $(srcdir)/depcomp \
    $(srcdir)/install-sh \
    $(srcdir)/ltmain.sh \
    $(srcdir)/missing \
    $(srcdir)/mkinstalldirs \
    $(srcdir)/omf.make \
    $(srcdir)/xmldocs.make \
    $(srcdir)/gtk-doc.make \
    $(NULL)

GITIGNOREFILES = \
    m4 \
    config \
    $(NULL)

dist-hook: dist-hook-getting-started

-include $(top_srcdir)/git.mk
