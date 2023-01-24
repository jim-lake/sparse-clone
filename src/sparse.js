#!/usr/bin/env node
'use strict';

const fs = require('fs/promises');
exports.createFile = createFile;

if (require.main === module) {
  const yargs = require('yargs');
  yargs.scriptName('sparse');
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

  _run(argv._[0], parseInt(argv.size), argv.force);
}
async function _run(...args) {
  process.exit(await createFile(...args));
}

async function createFile(dest_path, size, force) {
  let handle;
  try {
    handle = await fs.open(dest_path, force ? 'w' : 'wx');
  } catch (e) {
    if (force) {
      console.error('error: file exists');
      return -1;
    } else {
      console.error('error: failed to create file');
      return -2;
    }
  }

  const buffer = Buffer.alloc(1, 0);
  try {
    await handle.write(buffer, 0, 1, size - 1);
    await handle.close();
    return 0;
  } catch (e) {
    console.error('error: failed to write to file:', e);
    return -3;
  }
}
