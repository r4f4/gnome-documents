/*
 * Copyright (c) 2011, 2012, 2014, 2015 Red Hat, Inc.
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

const Application = imports.application;
const Documents = imports.documents;
const Manager = imports.manager;
const Query = imports.query;

const Lang = imports.lang;
const Signals = imports.signals;

const GdPrivate = imports.gi.GdPrivate;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Tracker = imports.gi.Tracker;
const _ = imports.gettext.gettext;
const C_ = imports.gettext.pgettext;

function initSearch(context) {
    context.documentManager = new Documents.DocumentManager();
    context.sourceManager = new SourceManager(context);
    context.searchCategoryManager = new SearchCategoryManager(context);
    context.searchMatchManager = new SearchMatchManager(context);
    context.searchTypeManager = new SearchTypeManager(context);
    context.searchController = new SearchController(context);
    context.queryBuilder = new Query.QueryBuilder(context);
};

const SearchState = new Lang.Class({
    Name: 'SearchState',

    _init: function(searchMatch, searchType, source, str) {
        this.searchMatch = searchMatch;
        this.searchType = searchType;
        this.source = source;
        this.str = str;
    }
});

const SearchController = new Lang.Class({
    Name: 'SearchController',

    _init: function() {
        this._string = '';
    },

    setString: function(string) {
        if (this._string == string)
            return;

        this._string = string;
        this.emit('search-string-changed', this._string);
    },

    getString: function() {
        return this._string;
    },

    getTerms: function() {
        let escapedStr = Tracker.sparql_escape_string(this._string);
        let [tokens, ] = GLib.str_tokenize_and_fold(escapedStr, null);
        return tokens;
    }
});
Signals.addSignalMethods(SearchController.prototype);

const SearchCategoryStock = {
    ALL: 'all',
    FAVORITES: 'favorites',
    SHARED: 'shared',
    PRIVATE: 'private'
};

const SearchCategory = new Lang.Class({
    Name: 'SearchCategory',

    _init: function(params) {
        this.id = params.id;
        this.name = params.name;
        this.icon = params.icon;
    },

    getWhere: function() {
        if (this.id == SearchCategoryStock.FAVORITES)
            return '{ ?urn nao:hasTag nao:predefined-tag-favorite }';

        // require to have a contributor, and creator, and they should be different
        if (this.id == SearchCategoryStock.SHARED)
            return '{ ?urn nco:contributor ?contributor . ?urn nco:creator ?creator FILTER (?contributor != ?creator ) }';

        return '';
    },

    getFilter: function() {
        // require to be not local
        if (this.id == SearchCategoryStock.SHARED)
            return this._manager.context.sourceManager.getFilterNotLocal();

        return '(true)';
    }
});

const SearchCategoryManager = new Lang.Class({
    Name: 'SearchCategoryManager',
    Extends: Manager.BaseManager,

    _init: function(context) {
        this.parent(_("Category"), 'search-category', context);

        let category, recent;
        recent = new SearchCategory({ id: SearchCategoryStock.ALL,
        // Translators: this refers to new and recent documents
                                      name: _("All"),
                                      icon: '' });
        this.addItem(recent);

        category = new SearchCategory({ id: SearchCategoryStock.FAVORITES,
        // Translators: this refers to favorite documents
                                        name: _("Favorites"),
                                        icon: 'emblem-favorite-symbolic' });
        this.addItem(category);
        category = new SearchCategory({ id: SearchCategoryStock.SHARED,
        // Translators: this refers to shared documents
                                        name: _("Shared with you"),
                                        icon: 'emblem-shared-symbolic' });
        this.addItem(category);

        // Private category: currently unimplemented
        // category = new SearchCategory(SearchCategoryStock.PRIVATE, _("Private"), 'channel-secure-symbolic');
        // this._categories[category.id] = category;

        this.setActiveItem(recent);
    },

    getFilter: function(flags) {
        // Since we don't expose the SearchCategoryManager in the UI,
        // this is a placeholder for the moment.
        return '(true)';
    }
});

const SearchType = new Lang.Class({
    Name: 'SearchType',

    _init: function(params) {
        this.id = params.id;
        this.name = params.name;
        this._filter = (params.filter) ? (params.filter) : '(true)';
        this._where = (params.where) ? (params.where) : '';
    },

    getFilter: function() {
        return this._filter;
    },

    getWhere: function() {
        return this._where;
    }
});

const SearchTypeStock = {
    ALL: 'all',
    COLLECTIONS: 'collections',
    PDF: 'pdf',
    PRESENTATIONS: 'presentations',
    SPREADSHEETS: 'spreadsheets',
    TEXTDOCS: 'textdocs',
    EBOOKS: 'ebooks',
    COMICS: 'comics'
};

const SearchTypeManager = new Lang.Class({
    Name: 'SearchTypeManager',
    Extends: Manager.BaseManager,

    _init: function(context) {
        // Translators: "Type" refers to a search filter on the document type
        // (PDF, spreadsheet, ...)
        this.parent(C_("Search Filter", "Type"), 'search-type', context);

        this.addItem(new SearchType({ id: SearchTypeStock.ALL,
                                      name: _("All") }));
        if (!Application.application.isBooks) {
            this.addItem(new SearchType({ id: SearchTypeStock.COLLECTIONS,
                                          name: _("Collections"),
                                          filter: 'fn:starts-with(nao:identifier(?urn), \"gd:collection\")',
                                          where: '?urn rdf:type nfo:DataContainer .' }));
            this.addItem(new SearchType({ id: SearchTypeStock.PDF,
                                          name: _("PDF Documents"),
                                          filter: 'fn:contains(nie:mimeType(?urn), \"application/pdf\")',
                                          where: '?urn rdf:type nfo:PaginatedTextDocument .' }));
        } else {
            this.addItem(new SearchType({ id: SearchTypeStock.COLLECTIONS,
                                          name: _("Collections"),
                                          filter: 'fn:starts-with(nao:identifier(?urn), \"gb:collection\")',
                                          where: '?urn rdf:type nfo:DataContainer .' }));
            //FIXME we need to remove all the non-Comics PDFs here
        }

        if (!Application.application.isBooks) {
            this.addItem(new SearchType({ id: SearchTypeStock.PRESENTATIONS,
                                          name: _("Presentations"),
                                          where: '?urn rdf:type nfo:Presentation .' }));
            this.addItem(new SearchType({ id: SearchTypeStock.SPREADSHEETS,
                                          name: _("Spreadsheets"),
                                          where: '?urn rdf:type nfo:Spreadsheet .' }));
            this.addItem(new SearchType({ id: SearchTypeStock.TEXTDOCS,
                                          name: _("Text Documents"),
                                          filter: 'NOT EXISTS { ?urn a nfo:EBook }',
                                          where: '?urn rdf:type nfo:PaginatedTextDocument .' }));
        } else {
          this.addItem(new SearchType({ id: SearchTypeStock.EBOOKS,
                                        name: _("e-Books"),
                                        filter: '(nie:mimeType(?urn) IN (\"application/epub+zip\", \"application/x-mobipocket-ebook\", \"application/x-fictionbook+xml\", \"application/x-zip-compressed-fb2\"))',
                                        where: '?urn rdf:type nfo:EBook .' }));
          this.addItem(new SearchType({ id: SearchTypeStock.COMICS,
                                        name: _("Comics"),
                                        filter: '(nie:mimeType(?urn) IN (\"application/x-cbr\", \"application/x-cbz\", \"application/x-cbt\", \"application/x-cb7\"))',
                                        where: '?urn rdf:type nfo:EBook .' }));
        }


        this.setActiveItemById(SearchTypeStock.ALL);
    },

    getCurrentTypes: function() {
        let activeItem = this.getActiveItem();

        if (activeItem.id == SearchTypeStock.ALL)
            return this.getAllTypes();

        return [ activeItem ];
    },

    getDocumentTypes: function() {
        let types = [];

        if (!Application.application.isBooks) {
            types.push(this.getItemById(SearchTypeStock.PDF));
            types.push(this.getItemById(SearchTypeStock.PRESENTATIONS));
            types.push(this.getItemById(SearchTypeStock.SPREADSHEETS));
            types.push(this.getItemById(SearchTypeStock.TEXTDOCS));
        } else {
            types.push(this.getItemById(SearchTypeStock.EBOOKS));
            types.push(this.getItemById(SearchTypeStock.COMICS));
        }

        return types;
    },

    getAllTypes: function() {
        let types = [];

        this.forEachItem(function(item) {
            if (item.id != SearchTypeStock.ALL)
                types.push(item);
            });

        return types;
    }
});

const SearchMatchStock = {
    ALL: 'all',
    TITLE: 'title',
    AUTHOR: 'author'
};

const SearchMatch = new Lang.Class({
    Name: 'SearchMatch',

    _init: function(params) {
        this.id = params.id;
        this.name = params.name;
        this._term = '';
    },

    setFilterTerm: function(term) {
        this._term = term;
    },

    getFilter: function() {
        if (this.id == SearchMatchStock.TITLE)
            return ('fn:contains ' +
                    '(tracker:unaccent(tracker:case-fold' +
                    '(tracker:coalesce(nie:title(?urn), nfo:fileName(?urn)))), ' +
                    '"%s") || ' +
                    'fn:contains ' +
                    '(tracker:case-fold' +
                    '(tracker:coalesce(nie:title(?urn), nfo:fileName(?urn))), ' +
                    '"%s")').format(this._term, this._term);
        if (this.id == SearchMatchStock.AUTHOR)
            return ('fn:contains ' +
                    '(tracker:unaccent(tracker:case-fold' +
                    '(tracker:coalesce(nco:fullname(?creator), nco:fullname(?publisher)))), ' +
                    '"%s") || ' +
                    'fn:contains ' +
                    '(tracker:case-fold' +
                    '(tracker:coalesce(nco:fullname(?creator), nco:fullname(?publisher))), ' +
                    '"%s")').format(this._term, this._term);
        return '';
    }
});

const SearchMatchManager = new Lang.Class({
    Name: 'SearchMatchManager',
    Extends: Manager.BaseManager,

    _init: function(context) {
        // Translators: this is a verb that refers to "All", "Title" and "Author",
        // as in "Match All", "Match Title" and "Match Author"
        this.parent(_("Match"), 'search-match', context);

        this.addItem(new SearchMatch({ id: SearchMatchStock.ALL,
                                       name: _("All") }));
        this.addItem(new SearchMatch({ id: SearchMatchStock.TITLE,
        //Translators: "Title" refers to "Match Title" when searching
                                       name: C_("Search Filter", "Title") }));
        this.addItem(new SearchMatch({ id: SearchMatchStock.AUTHOR,
        //Translators: "Author" refers to "Match Author" when searching
                                       name: C_("Search Filter", "Author") }));

        this.setActiveItemById(SearchMatchStock.ALL);
    },

    getFilter: function(flags) {
        if ((flags & Query.QueryFlags.SEARCH) == 0)
            return '(true)';

        let terms = this.context.searchController.getTerms();
        let filters = [];

        for (let i = 0; i < terms.length; i++) {
            this.forEachItem(function(item) {
                item.setFilterTerm(terms[i]);
            });

            let filter;
            let item = this.getActiveItem();

            if (item.id == SearchMatchStock.ALL)
                filter = this.getAllFilter();
            else
                filter = item.getFilter();

            filters.push(filter);
        }
        return filters.length ? '( ' + filters.join(' && ') + ')' : '(true)';
    }
});

const SearchSourceStock = {
    ALL: 'all',
    LOCAL: 'local'
};

const TRACKER_SCHEMA = 'org.freedesktop.Tracker.Miner.Files';
const TRACKER_KEY_RECURSIVE_DIRECTORIES = 'index-recursive-directories';

const Source = new Lang.Class({
    Name: 'Source',

    _init: function(params) {
        this.id = null;
        this.name = null;
        this.icon = null;

        if (params.object) {
            this.object = params.object;
            let account = params.object.get_account();

            this.id = 'gd:goa-account:' + account.id;
            this.name = account.provider_name;
            this.icon = Gio.icon_new_for_string(account.provider_icon);
        } else {
            this.id = params.id;
            this.name = params.name;
        }

        this.builtin = params.builtin;
    },

    _getGettingStartedLocations: function() {
        if (Application.application.gettingStartedLocation)
            return Application.application.gettingStartedLocation;
        else
            return [];
    },

    _getTrackerLocations: function() {
        let settings = new Gio.Settings({ schema_id: TRACKER_SCHEMA });
        let locations = settings.get_strv(TRACKER_KEY_RECURSIVE_DIRECTORIES);
        let files = [];

        locations.forEach(Lang.bind(this,
            function(location) {
                // ignore special XDG placeholders, since we handle those internally
                if (location[0] == '&' || location[0] == '$')
                    return;

                let trackerFile = Gio.file_new_for_commandline_arg(location);

                // also ignore XDG locations if they are present with their full path
                for (let idx = 0; idx < GLib.UserDirectory.N_DIRECTORIES; idx++) {
                    let file = Gio.file_new_for_path(GLib.get_user_special_dir(idx));
                    if (trackerFile.equal(file))
                        return;
                }

                files.push(trackerFile);
            }));

        return files;
    },

    _getBuiltinLocations: function() {
        let files = [];
        let xdgDirs = [GLib.UserDirectory.DIRECTORY_DESKTOP,
                       GLib.UserDirectory.DIRECTORY_DOCUMENTS,
                       GLib.UserDirectory.DIRECTORY_DOWNLOAD];

        xdgDirs.forEach(Lang.bind(this,
            function(dir) {
                let path = GLib.get_user_special_dir(dir);
                if (path)
                    files.push(Gio.file_new_for_path(path));
            }));

        return files;
    },

    _buildFilterLocal: function() {
        let locations = this._getBuiltinLocations();
        locations = locations.concat(
            this._getTrackerLocations(),
            this._getGettingStartedLocations());

        let filters = [];
        locations.forEach(Lang.bind(this,
            function(location) {
                filters.push('(fn:contains (nie:url(?urn), "%s"))'.format(location.get_uri()));
            }));

        if (!Application.application.isBooks)
            filters.push('(fn:starts-with (nao:identifier(?urn), "gd:collection:local:"))');
        else
            filters.push('(fn:starts-with (nao:identifier(?urn), "gb:collection:local:"))');
        return '(' + filters.join(' || ') + ')';
    },

    getFilter: function() {
        let filters = [];

        if (this.id == SearchSourceStock.LOCAL) {
            filters.push(this._buildFilterLocal());
        } else if (this.id == SearchSourceStock.ALL) {
            filters.push(this._buildFilterLocal());
            filters.push(this._manager.getFilterNotLocal());
        } else {
            filters.push(this._buildFilterResource());
        }

        return '(' + filters.join(' || ') + ')';
    },

    _buildFilterResource: function() {
        let filter = '(false)';

        if (!this.builtin)
            filter = ('(nie:dataSource(?urn) = "%s")').format(this.id);

        return filter;
    }
});

const SourceManager = new Lang.Class({
    Name: 'SourceManager',
    Extends: Manager.BaseManager,

    _init: function(context) {
        this.parent(_("Sources"), 'search-source', context);

        let source = new Source({ id: SearchSourceStock.ALL,
        // Translators: this refers to documents
                                  name: _("All"),
                                  builtin: true });
        this.addItem(source);

        source = new Source({ id: SearchSourceStock.LOCAL,
        // Translators: this refers to local documents
                              name: _("Local"),
                              builtin: true });
        this.addItem(source);

        if (!Application.application.isBooks) {
            Application.goaClient.connect('account-added', Lang.bind(this, this._refreshGoaAccounts));
            Application.goaClient.connect('account-changed', Lang.bind(this, this._refreshGoaAccounts));
            Application.goaClient.connect('account-removed', Lang.bind(this, this._refreshGoaAccounts));

            this._refreshGoaAccounts();
        }

        this.setActiveItemById(SearchSourceStock.ALL);
    },

    _refreshGoaAccounts: function() {
        let newItems = {};
        let accounts = Application.goaClient.get_accounts();

        accounts.forEach(Lang.bind(this,
            function(object) {
                if (!object.get_account())
                    return;

                if (!object.get_documents())
                    return;

                let source = new Source({ object: object });
                newItems[source.id] = source;
            }));

        this.processNewItems(newItems);
    },

    getFilter: function(flags) {
        let item;

        if (flags & Query.QueryFlags.SEARCH)
            item = this.getActiveItem();
        else
            item = this.getItemById(SearchSourceStock.ALL);

        let filter;

        if (item.id == SearchSourceStock.ALL)
            filter = this.getAllFilter();
        else
            filter = item.getFilter();

        return filter;
    },

    getFilterNotLocal: function() {
        let sources = this.getItems();
        let filters = [];

        for (let idx in sources) {
            let source = sources[idx];
            if (!source.builtin)
                filters.push(source.getFilter());
        }

        if (filters.length == 0)
            filters.push('false');

        return '(' + filters.join(' || ') + ')';
    },

    hasOnlineSources: function() {
        let hasOnline = false;
        this.forEachItem(
            function(source) {
                if (source.object)
                    hasOnline = true;
            });

        return hasOnline;
    },

    hasProviderType: function(providerType) {
        let items = this.getForProviderType(providerType);
        return (items.length > 0);
    },

    getForProviderType: function(providerType) {
        let items = [];
        this.forEachItem(Lang.bind(this,
            function(source) {
                if (!source.object)
                    return;

                let account = source.object.get_account();
                if (account.provider_type == providerType)
                    items.push(source);
            }));

        return items;
    }
});

const OFFSET_STEP = 50;

const OffsetController = new Lang.Class({
    Name: 'OffsetController',

    _init: function() {
        this._offset = 0;
        this._itemCount = 0;
    },

    // to be called by the view
    increaseOffset: function() {
        this._offset += OFFSET_STEP;
        this.emit('offset-changed', this._offset);
    },

    // to be called by the model
    resetItemCount: function() {
        let query = this.getQuery();

        Application.connectionQueue.add
            (query.sparql, null, Lang.bind(this,
                function(object, res) {
                    let cursor = null;
                    try {
                        cursor = object.query_finish(res);
                    } catch (e) {
                        log('Unable to execute count query: ' + e.toString());
                        return;
                    }

                    cursor.next_async(null, Lang.bind(this,
                        function(object, res) {
                            let valid = object.next_finish(res);

                            if (valid) {
                                this._itemCount = cursor.get_integer(0);
                                this.emit('item-count-changed', this._itemCount);
                            }

                            cursor.close();
                        }));
                }));
    },

    getQuery: function() {
        log('Error: OffsetController implementations must override getQuery');
    },

    // to be called by the model
    resetOffset: function() {
        this._offset = 0;
    },

    getItemCount: function() {
        return this._itemCount;
    },

    getRemainingDocs: function() {
        return (this._itemCount - (this._offset + OFFSET_STEP));
    },

    getOffsetStep: function() {
        return OFFSET_STEP;
    },

    getOffset: function() {
        return this._offset;
    }
});
Signals.addSignalMethods(OffsetController.prototype);

const OffsetCollectionsController = new Lang.Class({
    Name: 'OffsetCollectionsController',
    Extends: OffsetController,

    _init: function() {
        this.parent();
    },

    getQuery: function() {
        let activeCollection = Application.documentManager.getActiveCollection();
        let flags;

        if (activeCollection)
            flags = Query.QueryFlags.NONE;
        else
            flags = Query.QueryFlags.COLLECTIONS;

        return Application.queryBuilder.buildCountQuery(flags);
    }
});

const OffsetDocumentsController = new Lang.Class({
    Name: 'OffsetDocumentsController',
    Extends: OffsetController,

    _init: function() {
        this.parent();
    },

    getQuery: function() {
        return Application.queryBuilder.buildCountQuery(Query.QueryFlags.DOCUMENTS);
    }
});

const OffsetSearchController = new Lang.Class({
    Name: 'OffsetSearchController',
    Extends: OffsetController,

    _init: function() {
        this.parent();
    },

    getQuery: function() {
        return Application.queryBuilder.buildCountQuery(Query.QueryFlags.SEARCH);
    }
});
