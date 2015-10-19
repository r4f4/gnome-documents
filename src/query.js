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

const Gd = imports.gi.Gd;
const GdPrivate = imports.gi.GdPrivate;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Search = imports.search;

const QueryColumns = {
    URN: 0,
    URI: 1,
    FILENAME: 2,
    MIMETYPE: 3,
    TITLE: 4,
    AUTHOR: 5,
    MTIME: 6,
    IDENTIFIER: 7,
    RDFTYPE: 8,
    RESOURCE_URN: 9,
    SHARED: 10,
    DATE_CREATED: 11
};

const QueryFlags = {
    NONE: 0,
    UNFILTERED: 1 << 0,
    COLLECTIONS: 1 << 1,
    DOCUMENTS: 1 << 2,
    SEARCH: 1 << 3
};

const LOCAL_BOOKS_COLLECTIONS_IDENTIFIER = 'gb:collection:local:';
const LOCAL_DOCUMENTS_COLLECTIONS_IDENTIFIER = 'gd:collection:local:';

const QueryBuilder = new Lang.Class({
    Name: 'QueryBuilder',

    _init: function(context) {
        this._context = context;
    },

    _createQuery: function(sparql) {
        return { sparql: sparql,
                 activeSource: this._context.sourceManager.getActiveItem() };
    },

    _buildFilterString: function(currentType, flags) {
        let filters = [];

        filters.push(this._context.searchMatchManager.getFilter(flags));
        filters.push(this._context.sourceManager.getFilter(flags));
        filters.push(this._context.searchCategoryManager.getFilter(flags));

        if (currentType) {
            filters.push(currentType.getFilter());
        }

        return 'FILTER (' + filters.join(' && ') + ')';
    },

    _buildOptional: function() {
        let sparql =
            'OPTIONAL { ?urn nco:creator ?creator . } ' +
            'OPTIONAL { ?urn nco:publisher ?publisher . } ';

        return sparql;
    },

    _buildWhere: function(global, flags) {
        let whereSparql = 'WHERE { ';
        let whereParts = [];
        let searchTypes = [];

        if (flags & QueryFlags.COLLECTIONS)
            searchTypes = [this._context.searchTypeManager.getItemById(Search.SearchTypeStock.COLLECTIONS)];
        else if (flags & QueryFlags.DOCUMENTS)
            searchTypes = this._context.searchTypeManager.getDocumentTypes();
        else if (flags & QueryFlags.SEARCH)
            searchTypes = this._context.searchTypeManager.getCurrentTypes();
        else
            searchTypes = this._context.searchTypeManager.getAllTypes();

        // build an array of WHERE clauses; each clause maps to one
        // type of resource we're looking for.
        searchTypes.forEach(Lang.bind(this,
            function(currentType) {
                let part = '{ ' + currentType.getWhere() + this._buildOptional();

                if ((flags & QueryFlags.UNFILTERED) == 0) {
                    if (global)
                        part += this._context.searchCategoryManager.getWhere() +
                                this._context.documentManager.getWhere();

                    part += this._buildFilterString(currentType, flags);
                }

                part += ' }';
                whereParts.push(part);
            }));

        // put all the clauses in an UNION
        whereSparql += whereParts.join(' UNION ');
        whereSparql += ' }';

        return whereSparql;
    },

    _buildQueryInternal: function(global, flags, offsetController, sortBy) {
        let whereSparql = this._buildWhere(global, flags);
        let tailSparql = '';

        // order results depending on sortBy
        if (global) {
            let offset = 0;
            let step = Search.OFFSET_STEP;

            if (offsetController) {
                offset = offsetController.getOffset();
                step = offsetController.getOffsetStep();
            }

            switch (sortBy) {
            case Gd.MainColumns.PRIMARY_TEXT:
                tailSparql += 'ORDER BY ASC(?title) ASC(?filename)';
                break;
            case Gd.MainColumns.SECONDARY_TEXT:
                tailSparql += 'ORDER BY ASC(?author)';
                break;
            case Gd.MainColumns.MTIME:
                tailSparql += 'ORDER BY DESC(?mtime)';
                break;
            default:
                tailSparql += 'ORDER BY DESC(?mtime)';
                break;
            }

            tailSparql += ('LIMIT %d OFFSET %d').format(step, offset);
        }

        let sparql =
            'SELECT DISTINCT ?urn ' + // urn
            'nie:url(?urn) ' + // uri
            'nfo:fileName(?urn) AS ?filename ' + // filename
            'nie:mimeType(?urn)' + // mimetype
            'nie:title(?urn) AS ?title ' + // title
            'tracker:coalesce(nco:fullname(?creator), nco:fullname(?publisher), \'\') AS ?author ' + // author
            'tracker:coalesce(nfo:fileLastModified(?urn), nie:contentLastModified(?urn)) AS ?mtime ' + // mtime
            'nao:identifier(?urn) ' + // identifier
            'rdf:type(?urn) ' + // type
            'nie:dataSource(?urn) ' + // resource URN
            '( EXISTS { ?urn nco:contributor ?contributor FILTER ( ?contributor != ?creator ) } ) ' + // shared
            'tracker:coalesce(nfo:fileCreated(?urn), nie:contentCreated(?urn)) ' + // date created
            whereSparql + tailSparql;

        return sparql;
    },

    buildSingleQuery: function(flags, resource) {
        let sparql = this._buildQueryInternal(false, flags);
        sparql = sparql.replace('?urn', '<' + resource + '>', 'g');

        return this._createQuery(sparql);
    },

    buildGlobalQuery: function(flags, offsetController, sortBy) {
        return this._createQuery(this._buildQueryInternal(true, flags, offsetController, sortBy));
    },

    buildCountQuery: function(flags) {
        let sparql = 'SELECT DISTINCT COUNT(?urn) ' +
            this._buildWhere(true, flags);

        return this._createQuery(sparql);
    },

    // queries for all the items which are part of the given collection
    buildCollectionIconQuery: function(resource) {
        let sparql =
            ('SELECT ' +
             '?urn ' +
             'tracker:coalesce(nfo:fileLastModified(?urn), nie:contentLastModified(?urn)) AS ?mtime ' +
             'WHERE { ?urn nie:isPartOf ?collUrn } ' +
             'ORDER BY DESC (?mtime)' +
             'LIMIT 4').replace('?collUrn', '<' + resource + '>');

        return this._createQuery(sparql);
    },

    // queries for all the collections the given item is part of
    buildFetchCollectionsQuery: function(resource) {
        let sparql =
            ('SELECT ' +
             '?urn ' +
             'WHERE { ?urn a nfo:DataContainer . ?docUrn nie:isPartOf ?urn }'
            ).replace('?docUrn', '<' + resource + '>');

        return this._createQuery(sparql);
    },

    // adds or removes the given item to the given collection
    buildSetCollectionQuery: function(itemUrn, collectionUrn, setting) {
        let sparql = ('%s { <%s> nie:isPartOf <%s> }'
                     ).format((setting ? 'INSERT' : 'DELETE'), itemUrn, collectionUrn);
        return this._createQuery(sparql);
    },

    // bumps the mtime to current time for the given resource
    buildUpdateMtimeQuery: function(resource) {
        let time = GdPrivate.iso8601_from_timestamp(GLib.get_real_time() / GLib.USEC_PER_SEC);
        let sparql = ('INSERT OR REPLACE { <%s> nie:contentLastModified \"%s\" }'
                     ).format(resource, time);

        return this._createQuery(sparql);
    },

    buildCreateCollectionQuery: function(name) {
        let application = Gio.Application.get_default();
        let collectionsIdentifier;
        if (application.isBooks)
            collectionsIdentifier = LOCAL_BOOKS_COLLECTIONS_IDENTIFIER;
        else
            collectionsIdentifier = LOCAL_DOCUMENTS_COLLECTIONS_IDENTIFIER;

        let time = GdPrivate.iso8601_from_timestamp(GLib.get_real_time() / GLib.USEC_PER_SEC);
        let sparql = ('INSERT { _:res a nfo:DataContainer ; a nie:DataObject ; ' +
                      'nie:contentLastModified \"' + time + '\" ; ' +
                      'nie:title \"' + name + '\" ; ' +
                      'nao:identifier \"' + collectionsIdentifier + name + '\" }');

        return this._createQuery(sparql);
    },

    buildDeleteResourceQuery: function(resource) {
        let sparql = ('DELETE { <%s> a rdfs:Resource }').format(resource);

        return this._createQuery(sparql);
    }
});
