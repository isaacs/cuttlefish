# cuttlefish

A simple lowlevel synchronizing library for Joyent Manta.

## USAGE

```javascript
var cuttlefish = require('cuttlefish');

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
      // if type is omitted, then infer from extension, or leave blank
    },
    ...
  },

  // optional headers that get sent along with EVERY put reqest to manta
  headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET'
  },

  // Optionally emit an 'error' event on any errors. Note that this
  // will cause it to throw, which might not be what you want.
  // Default: strict=false
  strict: true

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

## Can it recursively add directories?

No.  You feed the cuttlefish a bunch of things that you want it to
sync.  It just figures out what to sync, and then tells you when its
all done.  Probably what you want is
[manta-sync](https://github.com/bahamas10/node-manta-sync).

## Why "cuttlefish"?

The Joyent Manta service has a venerable tradition of naming things
after sea creatures.  The cuttlefish is a little thing with tentacles
that stays on the bottom of the sea, and mirrors whatever it's placed
against, so it is a natural fit for a lowlevel synchronizing utility.
