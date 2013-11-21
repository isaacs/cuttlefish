var cuttlefish = require('../')
var manta = require('manta')
var test = require('tap').test

var client = require('./client.js')

// get all the details from the fixtures
var fs = require('fs')
var path = require('path')
var fix = path.resolve(__dirname, 'fixtures')
var names = 'abcdef'.split('')
var files = names.map(function(n) {
  return [n, fs.statSync(fix + '/' + n)]
}).concat(names.map(function(n) {
  return ['dir/' + n, fs.statSync(fix + '/dir/' + n)]
})).reduce(function(set, kv) {
  set[kv[0]] = kv[1]
  kv[1].headers = {
    'x-cuttlefish-filename': kv[0]
  }
  return set
}, {})

var mpath = '~~/stor/cuttlefish-testing'
var expectsum = {
  a: 'YLcl8QychccNl4gN/oGRsw==',
  b: 'O11cNxKVUEIhIxYXPM83vg==',
  c: 'LNbuLHCwveU/vmysPIuLsQ==',
  d: '4pMR9vG/GvkH+e+fRLgyiw==',
  e: 'n/v0MSbjO+Us0r9+AdYn+Q==',
  f: 'morZLFDK45qixWBP0KttjA==',
  'dir/a': 'YLcl8QychccNl4gN/oGRsw==',
  'dir/b': 'O11cNxKVUEIhIxYXPM83vg==',
  'dir/c': 'LNbuLHCwveU/vmysPIuLsQ==',
  'dir/d': '4pMR9vG/GvkH+e+fRLgyiw==',
  'dir/e': 'n/v0MSbjO+Us0r9+AdYn+Q==',
  'dir/f': 'morZLFDK45qixWBP0KttjA=='
}

test('preclean', function(t) {
  client.rmr(mpath, function(er) {
    t.pass('cleaned')
    t.end()
  })
})

test('fs first sync', function(t) {
  var cf = cuttlefish({
    files: files,
    path: mpath,
    client: client,
    headers: {
      'x-tEsTiNg': 'true'
    },
    request: function(file, cb) {
      console.error('request(%s)', file)
      var f = path.resolve(__dirname, 'fixtures', file.name)
      cb(null, fs.createReadStream(f))
    },
    strict: true
  })
  cf.on('file', function(file, status, data) {
    t.equal(status, 'sent')
  })
  cf.on('complete', function(er, results) {
    if (er)
      throw er
    var res = Object.keys(results).sort().map(function(f) {
      return [f, results[f]['computed-md5']]
    }).reduce(function (set, kv) {
      set[kv[0]] = kv[1]
      return set
    }, {})
    t.same(res, expectsum)
    t.end()
  })
})

test('fs second sync', function(t) {
  var cf = cuttlefish({
    files: files,
    path: mpath,
    client: client,
    headers: {
      'x-tEsTiNg': 'true'
    },
    request: function(file, cb) {
      console.error('request(%s)', file)
      var f = path.resolve(__dirname, 'fixtures', file.name)
      cb(null, fs.createReadStream(f))
    },
    strict: true
  })
  cf.on('file', function(file, status, data) {
    t.equal(status, 'match')
    console.error('FILE EVENT %j', status, file)
  })
  cf.on('complete', function(er, results) {
    if (er)
      throw er
    console.error('RESULTS', results)
    var res = Object.keys(results).sort().map(function(f) {
      return [f, results[f].md5]
    }).reduce(function (set, kv) {
      set[kv[0]] = kv[1]
      return set
    }, {})
    t.same(res, expectsum)
    t.end()
  })
})

test('fs partial sync', function(t) {
  client.rmr(mpath + '/dir', function(er) {
    if (er)
      throw er

    var cf = cuttlefish({
      files: files,
      path: mpath,
      client: client,
      headers: {
        'x-tEsTiNg': 'true'
      },
      request: function(file, cb) {
        console.error('request(%s)', file)
        var f = path.resolve(__dirname, 'fixtures', file.name)
        cb(null, fs.createReadStream(f))
      },
      strict: true
    })
    cf.on('file', function(file, status, data) {
      if (file.name.match(/^dir/))
        t.equal(status, 'sent')
      else
        t.equal(status, 'match')
    })
    cf.on('complete', function(er, results) {
      if (er)
        throw er
      var res = Object.keys(results).sort().map(function(f) {
        return [f, results[f].md5 || results[f]['computed-md5']]
      }).reduce(function (set, kv) {
        set[kv[0]] = kv[1]
        return set
      }, {})
      t.same(res, expectsum)
      t.end()
    })
  })
})

test('postclean', function(t) {
  client.rmr(mpath, function(er) {
    client.close()
    t.pass('cleaned')
    t.end()
  })
})
