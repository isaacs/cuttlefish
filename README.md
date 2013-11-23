# cuttlefish

A simple lowlevel synchronizing library for Joyent Manta.

## USAGE

```javascript
var cuttlefish = require('cuttlefish');

// Minimal options:
var fishy = cuttlefish({
  // The path on Manta where your stuff will be uploaded
  path: '/isaacs/stor/path/on/manta/to/stuff',

  // create your own manta client.  See the Manta SDK.
  client: myMantaClient,

  // Pass a getter function to fetch the file stream.
  request: function(filename, cb) {
    // load up the stream, call cb(er, stream)
  },

  // the list of file objects to sync up to manta
  files: {
    // the object can contain optionally size, type, and/or md5
    'filename.txt': {},

    // paths with / will create the necessary dirs
    'dir/a.txt': {,
      size: 1234,
      'md5': 'KwAEL3SBx7BWxLQQ0o8zzw==',
    }
  }
});

// With more optional options filled in
var fishy = cuttlefish({
  // The path on Manta where your stuff will be uploaded
  path: '/isaacs/stor/path/on/manta/to/stuff',

  // create your own manta client.  See the Manta SDK.
  client: myMantaClient,

  // Pass a getter function to fetch the file stream.
  request: function(filename, cb) {
    // load up the stream, call cb(er, stream)
  },

  // the list of file objects to sync up to manta
  files: {
    'filename.txt': {
      // All fields for each file are optional
      // will use md5 if provided, then size,
      // then assume that all files must be written
      size: 1234, // or content-length or length

      type: 'text/plain', // or content_type, content-type, or type

      // Multiple ways to specify md5, all work
      // md5 is not necessary
      'md5': 'KwAEL3SBx7BWxLQQ0o8zzw==',

      // hex or base64 or buffer, totally ok
      'md5': '2b00042f7481c7b056c4b410d28f33cf',
      'md5': new Buffer('2b00042f7481c7b056c4b410d28f33cf', 'hex'),

      // also supports this couchdb style 'digest' field
      digest: 'md5-KwAEL3SBx7BWxLQQ0o8zzw==',

      // optional headers for this one file when it gets mput'ed
      // Note that content-type and content-md5 are not really
      // necessary here.
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET',
        'x-fry-is': 'the greetest'
      },
    },
    'sub/folder/file.txt': {
      // if filename has slashes, then dirs will be made as needed
      // if type is omitted, then manta will infer from extension, or
      // use application/octet-stream by default
    },
    ...
  },

  // optional headers that get sent along with EVERY put reqest to manta
  headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET'
  },

  // Optionally delete files that are not in the list
  // Default: delete=false
  delete: true

  // Optionally ONLY delete missing files, but don't send anything
  // implies "delete"
  onlyDelete: true
}, cb) // optional cb arg gets registered as 'complete' event handler

fishy.on('file', function(status, file, data) {
  if (status === 'error')
    console.error('%s failed: %s', file.name, data.stack)
  else if (status === 'match')
    console.error('%s already there', file.name)
  else
    console.error('%s ok!', file.name)
})

fishy.on('complete', function(error, data) {
  if (error)
    console.error('it didnt went well. first error was %s', error.stack)
  else
    console.log('ok! %d files uploaded', Object.keys(data).length)
})
```

## Options

* `client` {MantaClient object} Required client for accessing Manta
* `files` {Object} The `{<name>:<details>,...}` hash
* `path` {String} The path on Manta where the stuf gets synced to
* `request` {Function} Function that gets a stream to send, if
  appropriate
* `concurrency` {Number} The max number of tasks to be doing at any
  one time.  Default = 50.
* `timeout` {Number} Optional max amount of time to wait for any remote
  task to complete, in ms.  Default = Infinity
* `headers` {Object} Optional headers to send with every `PUT`
  operation.  Does not check for or overwrite headers on pre-existing
  remote objects.
* `delete` {Boolean} Set to true to delete remote files that are not
  found in the `files` hash.  Default = false
* `onlyDelete` {Boolean} Set to true to **only** delete remote files
  that are not found in the `files` hash, but do not send any new
  files.  Implies `delete`.  Default = false

## File Objects

Cuttlefish's file objects have the following fields.  When you specify
one of the aliases, it'll be changed to the canonical name.

* `md5` The md5 checksum of the file.  Can be in Base64, Hex, or
  Buffer format, or come with a `md5-` prefix.  Aliases:
  `content-md5`, `computed-md5`, `digest`
* `size` The length of the file in bytes.  Aliases: `length`,
  `content-length`, `content_length`, `contentLength`
* `type` The type of the file.  Aliases: `content-type`,
  `contentType`, `content_type`, `mime-type`, `mime_type`, `mimeType`
* `headers` Additional headers to pass to the Manta PUT operation.
  Does not check against headers for pre-existing files.
* `name` The key in the `files` hash.  When file objects are cast to a
  string, their `name` field is returned.
* `mkdirs` Boolean `true`, but only because the file is passed as an
  argument to a Manta PUT operation.
* `started` Boolean `false` before the file is processed, `true` once
  it starts.
* `error` Error object or `null` depending on whether the file
  encountered an error.
* `status` Starts as `null`, but eventually changes to one of
  `'sent'`, `'match'`, or `'error'`

## Remote Objects

Remote objects will be either of the sort returned by Manta's `ftw`
operation, or returned by Manta's `info` operation if an md5 checksum
is provided and the `ftw` data does not contain it.  Additionally,
they will have the following fields:

* `status` One of `'sent'`, `'match'`, `'error'`, or `'deleted'`
* `_path` The full path of the remote object in Manta
* `_remote` The path relative to Cuttlefish's directory (corresponding
  to the local `file.name` property)

## Events

The cuttlefish object is an event emitter that emits the following
events.

### `error`

* `error` {Error object}

Emitted when there is a problem.  This means something bad has
happened, which is probably unrecoverable.  The `error` object may
have a `file` or `task` object attached with additional information.

### `complete`

* `results` {Object} Collection of result information

Emitted when the sync operation is finished.  The results object
contains as much information as cuttlefish has about all the remote
objects it saw, as well as the status of each remote object
(`'delete'`, `'sent'`, or `'match'`).

### `file`

* `file` {Object} An object representing the file that was processed
* `status` {String} Either the string `'sent'` or `'match'`
* `remote` {Object} An object representing the remote file

This is emitted whenever a local file is processed, to tell you that
either it was sent, or it was skipped because it matches the remote
file.

### `task`

* `task` {Object} The task being performed

This is emitted whenever a new async task is scheduled.

### `delete`

* `path` {String} The remote path that is deleted (relative to
  cuttlefish's root manta path)
* `remote` {Object} The remote object info

Emitted whenever a remote file or directory is deleted.

### `send`

* `file` {Object} The local file being sent
* `result` {Object} The results of the send operation

Emitted when a file is sent.

### `match`

* `file` {Obect} The local file that matches
* `remote` {Object} The remote data that it matches against

### `ftw`

* `path` {String} The remote path being walked

This is emitted when we're about to process the list of remote files.

It will usually be emitted.  The only time it *wouldn't* be emitted is
if there's an error instead, or if the remote path doesn't exist (so
there's nothing to walk), or in the trivial case where we're not
sending any files and not deleting extra files and folders.

### `entry`

* `entry` {Object} Remote object info

Emitted for each remote entry encountered in the ftw process.

### `unlink`

* `remote` {Object} The remote object info
* `result` {Object} The results of the unlink operation

Emitted when a remote object is unlinked.

### `rmr`

* `remote` {Object} The remote object info
* `result` {Object} The results of the rmr operation

Emitted when a remote directory is removed.

### `info`

* `file` {Object} The local file being queried for
* `result` {Object} The results of the info operation

Emitted when cuttlefish has to look up the detailed info about a
remote object.  Currently, this is only done when it is necessary to
compare the md5 value.


## FAQ

These questions may or may not be frequently asked, but I predict that
you might ask them, so here they are.

### Can it recursively add directories?

No.  You feed the cuttlefish a bunch of things that you want it to
sync.  It just figures out what to sync, and then tells you when its
all done.  Probably what you want is
[manta-sync](https://github.com/bahamas10/node-manta-sync).

### I have a billion files. The stats won't fit in memory!

Another way to approach this solution would have been to have a more
stream-like `fishy.addFile(file)` method, instead of requiring that
you provide all the file stat info up front.

However, that approach requires that an extra call be made for each
file to get the remote info, *and* a ftw at the end to clean up extra
files that need to be deleted.  And, in order to handle deleting files
at all, you have to keep the names around anyway, which would
eventually hit a memory limit (albeit a much higher one).

That approach would require about twice as many HTTP calls, and an ftw
walk.  If you have a small to medium number of files (ie, a million or
less), many of which are already present on Manta, and are typically
setting `delete: true`, then cuttlefish's approach is much more
efficient.

A similarly efficient approach would be to require that you provide
another getter function to provide the file stat information, and then
a second getter to provide the file stream if needed, so that nothing
is stored in memory, and everything flows through, synchronizing
elegantly.

That's a much fancier lib with a more elaborate API, which should be
called thaumoctopus.  If you have this use case, you should go write
it.

### Why "cuttlefish"?

The Joyent Manta service has a venerable tradition of naming things
after sea creatures.  The cuttlefish is a little thing with tentacles
that stays on the bottom of the sea, and mirrors whatever it's placed
against.  So it is a natural fit for a lowlevel synchronizing utility.
