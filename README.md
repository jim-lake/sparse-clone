# sparse-clone

Make sparse files and clone files.

APFS (and presumably modern linux filesystems) have great support for sparse files
and clone (COW) files.  Unfortunately doing the voodoo to make sure that files
are sparse and cloned optimally to not use extra file system space is a huge
pain.

These commands take existing files and turn them into the optimal versions
of themselves.

# sparsify

Usage: `sparsify <src> <dest>`

Takes a file and turns it into the sparse version of itself.

`du` on mac will show you actual space used by a file, so you can verify that
the tool is working as advertised.

Note: The sparse block size on APFS is 16KB, so if your file doesn't have at
least an (aligned!) 0's segment of at least 16KB no savings will be made.
APFS also has a minimum of 2000 blocks (32MB) for a sparse file, so operations
on files smaller than that will not result in any savings.

# clonify

Usage: `clonify <fileA> <fileB> ...`

Takes a set of files and performs the optimal set of operations to maximize
block reuse for the set of files provided on the command line.

Note: This operation happens in-place, file by file.  Make sure you have at
least enough free filespace to copy the largest file.

`du` unfortunately does not show the space gained by cloning.  You'll need to
perform `df` before and after and notice the change in free-space to see the
storage savings.
