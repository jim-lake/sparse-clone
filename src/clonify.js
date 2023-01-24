#!node
'use strict';

const crypto = require('crypto');
const yargs = require('yargs');
const fs = require('fs/promises');
const util = require('node:util');
const { parse: pathParse, join: pathJoin } = require('node:path');
const execFile = util.promisify(require('node:child_process').execFile);
const { createReadStream } = require('fs');

yargs.scriptName('clonify');
yargs.usage('$0 <file1> <file2> ... [args]');
yargs.option('verbose', {
  alias: 'v',
  describe: 'verbose',
  type: 'boolean',
});
yargs.demandCommand(
  2,
  9999999,
  'at least 2 files required',
  'too many arguments'
);
yargs.help();

const { argv } = yargs;
const { verbose } = argv;
const block_size = argv.block_size ? parseInt(argv.block_size) : 16 * 1024;
const min_match = argv.min_match ? parseInt(argv.min_match) : 10;

if (block_size < 1) {
  console.error('error: invalid block_size');
  process.exit(-99);
}
if (min_match < 1) {
  console.error('error: invalid min_match');
  process.exit(-99);
}

const file_list = argv._.map((path) => ({
  path,
  handle: null,
  size: 0,
  match_list: argv._.map(() => []),
  buffer: Buffer.alloc(block_size),
  is_done: false,
}));

_run();

async function _run() {
  let max_size = 0;
  try {
    const stat_list = await Promise.all(file_list.map((f) => fs.stat(f.path)));
    stat_list.forEach((stat, i) => {
      file_list[i].size = stat.size;
      max_size = Math.max(max_size, stat.size);
    });
    file_list.sort(_sortSize);
  } catch (e) {
    console.error('error: stat threw:', e.message);
    process.exit(-1);
  }

  try {
    const handle_list = await Promise.all(
      file_list.map((f) => fs.open(f.path, 'r'))
    );
    handle_list.forEach((handle, i) => (file_list[i].handle = handle));
  } catch (e) {
    console.error('error: open threw:', e.message);
    process.exit(-2);
  }

  try {
    for (let pos = 0; pos < max_size; pos += block_size) {
      const hash_list = await Promise.all(
        file_list.map((file) => _readBlockHash(file, pos))
      );
      for (let i = 0; i < file_list.length - 1; i++) {
        const block_a = hash_list[i];
        if (block_a) {
          for (let j = i + 1; j < file_list.length; j++) {
            const block_b = hash_list[j];
            if (block_b && block_a.equals(block_b)) {
              file_list[i].match_list[j].push(pos);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('error: read threw:', e.message);
    process.exit(-3);
  }
  if (verbose) {
    for (let i = 0; i < file_list.length - 1; i++) {
      const { path } = file_list[i];
      for (let j = i + 1; j < file_list.length; j++) {
        const { size, path: other_path } = file_list[j];
        const match_list = file_list[i].match_list[j];
        const match_count = match_list.length;
        const match_bytes = match_count * block_size;
        console.log(
          path,
          other_path,
          'matched blocks:',
          match_count,
          'matched bytes:',
          match_bytes,
          'match:',
          ((match_bytes / size) * 100).toFixed(4) + '%'
        );
      }
    }
  }
  let match;
  while ((match = _findBestMatch())) {
    const { file, other, match_list, match_length } = match;
    const match_bytes = match_length * block_size;
    console.log(
      'cloning:',
      file.path,
      '=>',
      other.path,
      'match %:',
      ((match_bytes / other.size) * 100).toFixed(4) + '%'
    );
    const err = await _clonifyFile(file.path, other.path, match_list);
    if (err) {
      console.error('error: clone failed with err:', err);
      process.exit(-3);
    }
    match.file.is_done = true;
    match.other.is_done = true;
  }
  process.exit(0);
}
function _sortSize(a, b) {
  return a.size - b.size;
}

async function _readBlockHash(file, position) {
  const { size, handle, buffer } = file;
  let ret = null;
  if (position + block_size <= size) {
    await handle.read(buffer, 0, block_size, position);
    const hash = crypto.createHash('sha256');
    hash.update(buffer);
    ret = hash.digest();
  }
  return ret;
}
function _findBestMatch() {
  let ret;
  const matches = [];
  for (let i = 0; i < file_list.length - 1; i++) {
    const file = file_list[i];
    for (let j = i + 1; j < file_list.length; j++) {
      const other = file_list[j];
      if (!file.is_done || !other.is_done) {
        const match_list = file.match_list[j];
        const match_length = match_list.length;
        if (match_length >= min_match) {
          const both_not_done = !file.is_done && !other.is_done;
          matches.push({
            match_length,
            both_not_done,
            file,
            other,
            match_list,
          });
        }
      }
    }
  }
  if (matches.length > 0) {
    matches.sort(_sortMatch);
    ret = matches[0];
  }
  return ret;
}
function _sortMatch(a, b) {
  let ret = b.match_length - a.match_length;
  if (a.both_not_done && !b.both_not_done) {
    ret = 1;
  } else if (b.both_not_done && !a.both_not_done) {
    ret = -1;
  }
  return ret;
}
async function _clonifyFile(parent, child, match_list) {
  let size;
  try {
    const stat = await fs.stat(child);
    size = stat.size;
  } catch (e) {
    console.error('error: stat threw:', e);
    return 'stat_fail';
  }

  const { dir } = pathParse(child);
  const temp = pathJoin(dir, '.' + crypto.randomUUID());
  try {
    await execFile('cp', ['-cn', parent, temp]);
  } catch (e) {
    console.error('error: copy threw:', e);
    await fs.rm(temp, { force: true });
    return 'copy_fail';
  }

  try {
    const buffer = Buffer.alloc(block_size);
    const read_handle = await fs.open(child, 'r');
    const write_handle = await fs.open(temp, 'r+');
    for (let i = 0; i < size; i += block_size) {
      if (i == match_list[0]) {
        match_list.shift();
      } else {
        const read_size = Math.min(size - i, block_size);
        await read_handle.read(buffer, 0, read_size, i);
        await write_handle.write(buffer, 0, read_size, i);
      }
    }
    await read_handle.close();
    await write_handle.close();
  } catch (e) {
    console.error('error: sync threw:', e);
    await fs.rm(temp, { force: true });
    return 'sync_fail';
  }
  try {
    const same = await _isFileIdentical(child, temp);
    if (same) {
      await fs.rename(temp, child);
    } else {
      return 'temp_not_matched';
    }
  } catch (e) {
    console.error('error: move threw:', e);
    await fs.rm(temp, { force: true });
    return 'rename_failed';
  }
}
async function _isFileIdentical(file_a, file_b) {
  const hash_list = await Promise.all([_hashFile(file_a), _hashFile(file_b)]);
  return hash_list[0].equals(hash_list[1]);
}
function _hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(file);

    let done = false;
    stream.on('error', (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.on('end', () => {
      if (!done) {
        done = true;
        resolve(hash.digest());
      }
    });
  });
}
