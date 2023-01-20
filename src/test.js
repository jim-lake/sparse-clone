#!node
'use strict';

const yargs = require('yargs');
const fs = require('fs/promises');
const { createFile } = require('./sparse');

yargs.scriptName('test');
yargs.usage('$0 <dest> [args]');
//yargs.boolean('force');
yargs.option('size', {
  alias: 's',
  demandOption: true,
  describe: 'size of file to create',
  type: 'string',
});
yargs.option('force', {
  alias: 'f',
  describe: 'force overwrite dest',
  type: 'boolean',
});
yargs.demandCommand(1, 1, 'dest required', 'too many arguments');
yargs.help();

const { argv } = yargs;
const dest_path = argv._[0];
const size = parseInt(argv.size);
const force = argv.force;
const block_size = argv.block_size ? parseInt(argv.block_size) : 10 * 1024;

_run();

async function _run() {
  const err = await createFile(dest_path, size, force);
  if (err) {
    console.log('failed to create with err:', err);
    process.exit(-1);
  }
  try {
    console.log('writing with block_size:', block_size);
    const handle = await fs.open(dest_path, 'r+');

    const buffer = Buffer.alloc(1, 0x42);
    for (let i = 0; i < size; i += block_size) {
      await handle.write(buffer, 0, 1, i);
    }
    await handle.close();
    console.log('wrote to blocks');
  } catch (e) {
    console.error('threw:', e);
  }
}
