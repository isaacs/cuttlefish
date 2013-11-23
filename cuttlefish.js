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

  if (options.concurrency != null &&
      (typeof options.concurrency !== 'number' || options.concurrency <= 0))
    throw new TypeError('options.concurrency must be number > 0')

  if (options.timeout != null &&
      (typeof options.timeout !== 'number' || options.timeout <= 0))
    throw new TypeError('options.timeout must be number > 0')

  this._concurrency = options.concurrency || 50
  this._timeout = options.timeout || -1
  this._headers = options.headers || {}
  this._files = canonize(options.files, this._headers)
  this._strict = !!options.strict
  this._onlyDelete = !!options.onlyDelete
  this._delete = !!options.delete || this._onlyDelete
  this._request = options.request
  this._client = options.client
  this._path = options.path
    .replace(/\/+$/, '')
    .replace(/^~~/, '/' + this._client.user)
  this._names = Object.keys(this._files)
  this._results = {}
  this._firstError = null
  this._walker = null

  this._tasks = []
  this._inFlight = {}
  this._processing = 0

  if (typeof cb === 'function')
    this.on('complete', cb)

  this._sync()
}


Cuttlefish.prototype._process = function process() {
  debug('process %d(%d) of %d',
        this._processing, this._concurrency, this._tasks.length)
  if (this._processing < this._concurrency) {
    var task = this._tasks.shift()
    if (task) {
      this._processing++
      this.emit(task.name, task.file)
      task.fn(this._afterProcess.bind(this, task))
    } else if (this._tasksDone && this._processing === 0)
      this._done()
  }
}

var taskId = 0
Cuttlefish.prototype._pushTask = function pushTask(task) {
  assert(task)
  // Either this is a new task, or a continuation of a started file
  assert(!this._tasksDone || (task.file && task.file.started))
  debug('pushTask', task)
  if (typeof task === 'function')
    task = { fn: task }
  if (task.file)
    task.file.started = true
  task.id = taskId++

  this._inFlight[task.id] = task
  if (this._timeout > 0) {
    task.timer = setTimeout(taskTimeout.bind(this, task), this._timeout)
    task.timer.unref()
  }
  this._tasks.push(task)
  this._process()
}

function taskTimeout(task) {
  if (this._inFlight[task.id]) {
    var er = new Error('timeout')
    er.task = task
    this.emit('error', er)
  }
}

Cuttlefish.prototype._tasksEnd = function tasksEnd() {
  debug('tasksEnd')
  assert(!this._tasksDone)
  this._tasksDone = true
  if (this._processing === 0)
    this._process()
}

Cuttlefish.prototype._afterProcess = function afterProcess(task, er, res) {
  this._processing--
  clearTimeout(task.timer)
  delete this._inFlight[task.id]
  task.error = er
  if (res && res.headers)
    res = res.headers

  if (res['content-length'])
    res.size = +res['content-length']

  if (res['content-md5'])
    res.md5 = res['content-md5']

  if (res['computed-md5'])
    res.md5 = res['computed-md5']

  task.result = res
  if (er) {
    er.task = task
    if (task.file) {
      task.file.status = 'error'
      task.file.error = er
      er.file = task.file
    }
    if (task.after)
      task.after(task)
    else
      this.emit('error', er)
  } else {
    if (task.file && task.status) {
      task.file.status = task.status
      this._results[task.file] = res || task.file
      this._results[task.file].status = task.status
      this.emit('file', task.file, task.status, res)
    }
    if (task.after)
      task.after(task)
  }
  this._process()
}

Cuttlefish.prototype._sync = function sync() {
  debug('start sync', this._names)

  // Nothing to send, and not deleting, so we're done! hooray!
  if (this._names.length === 0 && !this._delete)
    return process.nextTick(this._done.bind(this))

  this._startWalk()
}

Cuttlefish.prototype._startWalk = function startWalk() {
  debug('startWalk', this._path)
  var opt = {
    parallel: this._concurrency
  }
  this._client.ftw(this._path, opt, this._onWalk.bind(this))
}

Cuttlefish.prototype._onWalk = function onWalk(er, res) {
  debug('onWalk', er || 'ok')

  if (er && er.statusCode === 404)
    this._client.mkdir(this._path, this._sendUnsent.bind(this))
  else if (er)
    this.emit('error', er)
  else {
    this._walker = res
    this.emit('walkStart', res)
    res.on('entry', this._onWalkEntry.bind(this))
    res.on('end', this._sendUnsent.bind(this))
  }
}

Cuttlefish.prototype._onWalkEntry = function onWalkEntry(d) {
  debug('ftw entry', d)
  d._path = d.parent + '/' + d.name
  d._remote = d._path.substr(this._path.length + 1)
  d.toString = function() { return this._remote }
  if (d.type === 'directory') {
    if (this._delete)
      this._onWalkEntryDir(d)
  } else
    this._onWalkEntryObject(d)
}

Cuttlefish.prototype._onWalkEntryDir = function onWalkEntryDir(d) {
  debug('onWalkEntryDir', d)
  // check to see if anything needs this dir to exist.
  // if not, then kill it.
  for (var i = 0; i < this._names.length; i++) {
    if (this._names[i].indexOf(d._remote) === 0) {
      debug('dir is ok', d._remote)
      return // needs to be there
    }
  }
  this._pushTask({
    name: 'rmr',
    file: d,
    fn: this._client.rmr.bind(this._client, d._path),
    after: this._onDelete.bind(this)
  })
}

Cuttlefish.prototype._onDelete = function onDelete(task) {
  debug('onDelete', task)
  var remote = task.file
  remote.status = 'delete'
  this._results[remote._remote] = remote
  if (task.error && task.error.statusCode !== 404)
    this.emit('error', task.error)
  else
    this.emit('delete', remote._remote, remote)
}

Cuttlefish.prototype._onWalkEntryObject = function onWalkEntryObject(d) {
  var file = this._files[d._remote]
  debug('onWalkEntryObject', d, !!file, this._delete)
  if (!file) {
    if (this._delete)
      this._pushTask({
        fn: this._client.unlink.bind(this._client, d._path),
        name: 'unlink',
        file: d,
        after: this._onDelete.bind(this)
      })
  } else {
    // either a match, or not
    if (file.size !== null && file.size !== d.size) {
      debug('size mismatch local=%d remote=%d', file.size, d.size)
      this._send(file)
    } else if (file.md5) {
      debug('have md5, get info', file.md5)
      this._pushTask({
        name: 'info',
        fn: this._client.info.bind(this._client, d._path),
        after: this._onInfo.bind(this),
        file: file
      })
    } else if (file.size === null) {
      debug('no size, send anyway', file)
      this._send(file)
    } else {
      debug('match', file, d)
      this._match(file, d)
    }
  }
}

Cuttlefish.prototype._send = function(file) {
  debug('send', file)
  this._pushTask({
    name: 'sendFile',
    fn: this._sendFile.bind(this, file),
    file: file,
    status: 'sent'
  })
}

Cuttlefish.prototype._onInfo = function(task) {
  var file = task.file
  var remote = task.result
  debug('onInfo %s', file, remote)
  if (task.error && task.error.statusCode === 404)
    this._send(file)
  else if (task.error)
    this.emit('error', task.error)
  else if (remote.md5 === file.md5)
    this._match(file, remote)
  else if (!file.md5 && remote.size === file.size)
    this._match(file, remote)
  else
    this._send(file)
}

Cuttlefish.prototype._sendUnsent = function sendUnsent() {
  debug('sendUnsent')
  this._names.forEach(sendUnsentForeach, this)
  this._tasksEnd()
}

function sendUnsentForeach(f) {
  debug('-sendUnsent', this._files[f], this._results[f])
  if (!this._files[f].started)
    this._send(this._files[f])
}

Cuttlefish.prototype._match = function(file, remote) {
  remote.status = 'match'
  file.status = 'match'
  file.started = true
  this._results[file] = remote
  debug('match', file, remote)
  this.emit('file', file, 'match', remote)
}

Cuttlefish.prototype._done = function() {
  debug('done!')
  this.emit('complete', this._firstError, this._results)
}

Cuttlefish.prototype._sendFile = function(file, cb) {
  debug('_sendFile %s', file)
  // get this file, and then send it once we have it.
  this._request(file, this._onRequest.bind(this, file, cb))
}

Cuttlefish.prototype._onRequest = function onRequest(file, cb, er, stream) {
  debug('_onRequest %s', file, er || 'ok')
  if (er)
    cb(er)
  else
    this._sendFileStream(file, stream, cb)
}

Cuttlefish.prototype._sendFileStream = function(file, stream, cb) {
  debug('_sendFileStream %s', file)
  var mpath = this._path + '/' + file
  stream.on('error', cb)
  this._client.put(mpath, stream, file, cb)
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
File.prototype.started = false

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
