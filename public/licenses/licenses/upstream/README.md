# Preserved upstream notices

`scripts/upstream-licenses.json` maps exact installed package versions to original upstream notice files missing from their installed distributions. Files under official repository paths retain their original bytes. Source commits, URLs, file hashes and, when relevant, source-archive hashes are recorded in the mapping. PyPI and npm archive members were read without installing or executing the archives.

The `notices` array contains recovered full texts. A shared monorepo notice can be referenced by more than one package. The `@react-pdf/hyphenate` registry metadata omits `gitHead`; the pinned renderer commit was checked to contain the exact package name and version before applying the monorepo notice.

The `unresolved` array has a different meaning. Its `evidenceFiles` preserve original published declarations and author/source metadata, rather than claiming to supply an absent full license. The six browser dependencies in this category are brotli, dfa, fontkit, hsl-to-hex, hsl-to-rgb-for-reals and media-engine. No generic MIT/ISC text or invented copyright line was substituted. In particular, the published hsl-to-hex 1.0.0 package metadata says MIT while its README says ISC. Both original declarations are retained without choosing one.

Brotli's decoder source explicitly contains a Google Copyright 2013 Apache-2.0 header. That header and its referenced Apache license text are preserved separately; they do not resolve the package wrapper's missing full MIT notice. The mapping identifies the header extraction and its complete source-file hash.

The unresolved development-only sharp/libvips binary bundle lists many component licenses. Its packaging repository's Apache license is not used to replace those native-library obligations. The native binary, development node_modules and Python virtual environment are not included in the source release. The published component table and versions remain available as evidence.

These records document what was actually found. They do not claim that upstream declarations are nonexistent licenses, that missing full texts were recovered, or that this inventory establishes every obligation of every future deployment artifact.
