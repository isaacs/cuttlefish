module.exports = Cuttlefish

var manta = require('manta')
var EE = require('events').EventEmitter
var util = require('util')
var assert = require('assert')

var debug
if (util.debuglog)
  debug = util.debuglog('cuttlefish')
else
  debug = /\bcuttlefish\b/i.exec(process.env.NODE_DEBUG+'')
        ? console.error : function() {}

util.inherits(Cuttlefish, EE)

function Cuttlefish(options, cb) {
  if (!(this instanceof Cuttlefish))
    return new Cuttlefish(options, cb)

  EE.call(this)

  if (!options || typeof options !== 'object')
    throw new TypeError('options object required')

  if (!options.files || typeof options.files !== 'object')
    throw new TypeError('options.files object required')

  if (!options.path || typeof options.path !== 'string')
    throw new TypeError('options.path string required')

  if (!options.client || !(options.client instanceof manta.MantaClient))
    throw new TypeError('options.client of type MantaClient required')

  if (!options.request || typeof options.request !== 'function')
    throw new TypeError('options.request function required')

  this._headers = options.headers || {}
  this._files = canonize(options.files, this._headers)
  this._strict = !!options.strict
  this._onlyDelete = !!options.onlyDelete
  this._delete = !!options.delete || this._onlyDelete
  this._deleteFiles = []
  this._request = options.request
  this._client = options.client
  this._path = options.path
    .replace(/\/+$/, '')
    .replace(/^~~/, '/' + this._client.user)
  this._names = Object.keys(this._files)
  this._remaining = this._names.length
  this._results = {}
  this._firstError = null

  if (typeof cb === 'function')
    this.on('complete', cb)

  this._sync()
}

Cuttlefish.prototype._deleteExtras = function deleteExtras() {
  // only delete once!
  assert(this._delete)
  this._delete = false

  this.emit('deleteWalk')

  this._client.ftw(this._path, {}, this._onDeleteWalk.bind(this))
}

Cuttlefish.prototype._onDeleteWalk = function onDeleteWalk(er, res) {
  if (er)
    return this.emit('error', er)
  res.on('entry', this._onDeleteWalkEntry.bind(this))
  res.on('end', this._onDeleteWalkEnd.bind(this))
}

Cuttlefish.prototype._onDeleteWalkEntry = function onDeleteWalkEntry(d) {
  if (d.type !== 'object')
    return;

  // check if there's a file by that name.
  var f = d.parent + '/' + d.name
  f = f.substr(this._path.length + 1)

  if (!this._files[f]) {
    this._deleteFiles.push(f)
    this.emit('deleteAdd', f)
  }
}

Cuttlefish.prototype._onDeleteWalkEnd = function onDeleteWalkEnd() {
  if (!this._deleteFiles.length)
    this._done()
  else
    this._deleteStart()
}

Cuttlefish.prototype._deleteStart = function deleteStart() {
  this.emit('deleteStart', this._deleteFiles)
  this._remaining = this._deleteFiles.length
  this._deleteFiles.forEach(this._deleteFile, this)
}

Cuttlefish.prototype._deleteFile = function deleteFile(f) {
  var d = this._path + '/' + f
  this._client.unlink(d, {}, this._onDelete.bind(this, f))
}

Cuttlefish.prototype._onDelete = function onDelete(f, er, res) {
  debug('delete', f, er)
  if (er)
    this._error(f, er)
  else {
    this.emit('delete', f)
    this._maybeDone()
  }
}

Cuttlefish.prototype._sync = function sync() {
  debug('start sync', this._names)
  if (this._names.length === 0 || this._onlyDelete)
    return process.nextTick(this._done.bind(this))

  this._names.forEach(function(f) {
    this._syncFile(this._files[f])
  }, this)
}

Cuttlefish.prototype._syncFile = function syncFile(file) {
  debug('_syncFile %s', file)
  // if the manta checksum doesn't match, then call
  // options.request() to get the file.
  var remote = this._path + '/' + file
  this._client.info(remote, this._onInfo.bind(this, file))
}

Cuttlefish.prototype._onInfo = function(file, er, remote) {
  debug('info %s', file, er || remote)
  if (er && er.statusCode === 404)
    this._sendFile(file)
  else if (er)
    this._error(file, er)
  else if (remote.md5 === file.md5)
    this._match(file, remote)
  else if (!file.md5 && remote.size === file.size)
    this._match(file, remote)
  else
    this._sendFile(file)
}

Cuttlefish.prototype._match = function(file, remote) {
  debug('match! %s', file, remote)
  this._results[file] = remote
  this.emit('file', file, 'match', remote)
  this._maybeDone()
}

Cuttlefish.prototype._error = function(file, error) {
  debug('error! %s', file, error)
  this._results[file] = error
  file.error = error
  this._firstError = this._firstError || error
  if (this._strict)
    this.emit('error', error)
  this.emit('file', file, 'error', error)
  this._maybeDone()
}

Cuttlefish.prototype._sent = function(file, result, x) {
  debug('sent! %s', file, result.headers)
  this._results[file] = result.headers
  this.emit('file', file, 'sent', result.headers)
  this._maybeDone()
}

Cuttlefish.prototype._maybeDone = function() {
  debug('maybe done? %d', this._remaining)
  if (--this._remaining === 0)
    this._done()
}

Cuttlefish.prototype._done = function() {
  debug('done!')
  if (this._delete)
    this._deleteExtras()
  else
    this.emit('complete', this._firstError, this._results)
}

Cuttlefish.prototype._sendFile = function(file) {
  debug('_sendFile %s', file)
  // get this file, and then send it once we have it.
  this._request(file, this._onRequest.bind(this, file))
}

Cuttlefish.prototype._onRequest = function onRequest(file, er, stream) {
  debug('_onRequest %s', file, er || 'ok')
  if (er)
    this.emit('error', er)
  else
    this._sendFileStream(file, stream)
}

Cuttlefish.prototype._sendFileStream = function(file, stream) {
  debug('_sendFileStream %s', file)
  var mpath = this._path + '/' + file
  stream.on('error', this._error.bind(this, file))
  this._client.put(mpath, stream, file, this._onSend.bind(this, file))
}

Cuttlefish.prototype._onSend = function(file, er, result) {
  debug('_onSend %s', file, er || result.headers)
  this._results[file] = er || result.headers
  if (er)
    this._error(file, er)
  else
    this._sent(file, result)
}



// File class
// Because of toString = this.name, it can be used interchangeably
// as a string key, and also as the object represented by that

function File(fname, file, headers) {
  this.md5 = field(file, [
    'md5', 'content-md5', 'contentMd5',
    'content_md5', 'digest',
    'computed-md5', 'computedMd5', 'computed_md5'
  ])

  if (this.md5) {
    if (Buffer.isBuffer(this.md5))
      this.md5 = this.md5.toString('base64')
    else if (this.md5 && this.md5.match(/^md5-/))
      this.md5 = this.md5.replace(/^md5-/)

    if (this.md5.length === 32)
      this.md5 = new Buffer(this.md5, 'hex').toString('base64')
  }

  this.size = field(file, [
    'size', 'length', 'content-length',
    'contentLength', 'content_length'
  ])

  this.type = field(file, [
    'type', 'content-type', 'contentType',
    'content_type', 'mime-type', 'mimeType',
    'mime_type'
  ])

  if (headers || file.headers) {
    this.headers = {}
    if (headers && typeof headers === 'object') {
      Object.keys(headers).forEach(function(h) {
        this.headers[h] = headers[h]
      }, this)
    }
    if (file.headers && typeof file.headers === 'object') {
      Object.keys(file.headers).forEach(function(h) {
        return this.headers[h.toLowerCase()] = file.headers[h]
      }, this)
    }
  }

  this.name = fname
  this.mkdirs = true
}

File.prototype.toString = function() {
  return this.name
}

File.prototype.mkdirs = true
File.prototype.headers = null
File.prototype.md5 = null
File.prototype.size = null
File.prototype.type = null
File.prototype.name = null
File.prototype.error = null

function canonize(files, headers) {
  return Object.keys(files).map(function(fname) {
    return new File(fname, files[fname], headers)
  }).reduce(function(set, o) {
    set[o] = o
    return set
  }, {})
}

function field(obj, names) {
  for (var i = 0; i < names.length && !obj[names[i]]; i++);
  return obj[names[i]]
}
