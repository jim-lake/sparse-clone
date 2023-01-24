#!node
'use strict';

const yargs = require('yargs');
const fs = require('fs/promises');
const { createFile } = require('./sparse');

yargs.scriptName('sparcify');
yargs.usage('$0 <src> <dest> [args]');
yargs.demandCommand(2, 2, 'src and dest required', 'too many arguments');
yargs.help();

const { argv } = yargs;
const src_path = argv._[0];
const dest_path = argv._[1];
const block_size = argv.block_size ? parseInt(argv.block_size) : 16 * 1024;

_run();

async function _run() {
  try {
    const stats = await fs.stat(src_path);
    if (!stats) {
      console.error('error: src not found');
      process.exit(-1);
    }
    const { size } = stats;
    const err = await createFile(dest_path, size, false);
    if (err) {
      console.error('error: failed to create dest file:', dest_path);
      process.exit(-2);
    }
    const buffer = Buffer.alloc(block_size, 0);
    const read_handle = await fs.open(src_path, 'r');
    const write_handle = await fs.open(dest_path, 'r+');
    let block_count = 0;
    let copy_count = 0;
    let total_bytes = 0;
    let copy_bytes = 0;

    for (let i = 0; i < size; i += block_size) {
      const read_size = Math.min(size - i, block_size);
      block_count++;
      total_bytes += read_size;
      await read_handle.read(buffer, 0, read_size, i);
      if (!_isEmpty(buffer, read_size)) {
        copy_count++;
        copy_bytes += read_size;
        await write_handle.write(buffer, 0, read_size, i);
      }
    }
    await read_handle.close();
    await write_handle.close();
    console.log(
      'blocks:',
      block_count,
      'copied blocks:',
      copy_count,
      'empty blocks:',
      block_count - copy_count
    );
    console.log(
      'bytes:',
      total_bytes,
      'copied bytes:',
      copy_bytes,
      'empty bytes:',
      total_bytes - copy_bytes
    );
  } catch (e) {
    console.error('error: threw:', e);
  }
}
function _isEmpty(buffer, size) {
  for (let i = 0; i < size; i++) {
    if (buffer[i]) {
      return false;
    }
  }
  return true;
}
