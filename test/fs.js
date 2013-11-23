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
    'access-control-allow-origin': '*'
  }
  kv[1].type = 'text/plain'
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

var filesMd5 = Object.keys(files).reduce(function(set, f) {
  var o = {}
  for (var i in files[f]) o[i] = files[f][i]
  o.md5 = expectsum[f]
  set[f] = o
  return set
}, {})

test('preclean', function(t) {
  client.rmr(mpath, function(er) {
    t.pass('cleaned')
    t.end()
  })
})

test('fs first sync, no checksums', function(t) {
  var cf = cuttlefish({
    files: files,
    path: mpath,
    client: client,
    headers: {
      'access-control-allow-methods': 'GET'
    },
    delete: true,
    request: function(file, cb) {
      var f = path.resolve(__dirname, 'fixtures', file.name)
      cb(null, fs.createReadStream(f))
    }
  })
  cf.on('file', function(file, status, data) {
    t.equal(status, 'sent')
  })
  cf.on('complete', function(results) {
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

test('fs second sync, no checksums', function(t) {
  var expectStatus = Object.keys(expectsum).reduce(function(set, k) {
    set[k] = 'match'
    return set
  }, {})
  var cf = cuttlefish({
    files: files,
    path: mpath,
    client: client,
    headers: {
      'access-control-allow-methods': 'GET'
    },
    request: function(file, cb) {
      var f = path.resolve(__dirname, 'fixtures', file.name)
      cb(null, fs.createReadStream(f))
    }
  })
  cf.on('file', function(file, status, data) {
    t.equal(status, 'match')
  })
  cf.on('complete', function(results) {
    var res = Object.keys(results).sort().reduce(function(set, f) {
      set[f] = results[f].status
      return set
    }, {})
    t.same(res, expectStatus)
    t.end()
  })
})

test('fs second sync, with checksums', function(t) {
  var cf = cuttlefish({
    files: filesMd5,
    path: mpath,
    client: client,
    headers: {
      'access-control-allow-methods': 'GET'
    },
    request: function(file, cb) {
      var f = path.resolve(__dirname, 'fixtures', file.name)
      cb(null, fs.createReadStream(f))
    }
  })

  cf.on('file', function(file, status, data) {
    t.equal(status, 'match')
  })

  cf.on('complete', function(results) {
    var res = Object.keys(results).sort().reduce(function(set, f) {
      set[f] = results[f].md5 || results[f]['computed-md5']
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
        'access-control-allow-methods': 'GET'
      },
      request: function(file, cb) {
        var f = path.resolve(__dirname, 'fixtures', file.name)
        cb(null, fs.createReadStream(f))
      }
    })

    cf.on('file', function(file, status, data) {
      if (file.name.match(/^dir/))
        t.equal(status, 'sent')
      else
        t.equal(status, 'match')
    })

    cf.on('complete', function(results) {
      var expect = Object.keys(expectsum).sort().reduce(function(set, f) {
        if (f.match(/^dir/))
          set[f] = expectsum[f]
        else
          set[f] = 'match'
        return set
      }, {})

      var res = Object.keys(results).sort().map(function(f) {
        return [f, results[f].md5 || results[f].status]
      }).reduce(function (set, kv) {
        set[kv[0]] = kv[1]
        return set
      }, {})

      t.same(res, expect)
      t.end()
    })
  })
})

test('fs delete extra', function(t) {
  delete files['dir/a']
  delete files.a
  delete filesMd5['dir/a']
  delete filesMd5.a
  delete expectsum['dir/a']
  delete expectsum.a

  var deletedExpect = [ 'a', 'dir/a' ]

  var expect = Object.keys(expectsum).map(function(f) {
    return [f, expectsum[f]]
  }).concat(deletedExpect.map(function(f) {
    return [f, 'delete']
  })).reduce(function(set, kv) {
    set[kv[0]] = kv[1]
    return set
  }, {})

  var cf = cuttlefish({
    files: filesMd5,
    path: mpath,
    client: client,
    headers: {
      'access-control-allow-methods': 'GET'
    },
    request: function(file, cb) {
      var f = path.resolve(__dirname, 'fixtures', file.name)
      cb(null, fs.createReadStream(f))
    },
    delete: true
  })

  cf.on('file', function(file, status, data) {
    t.equal(status, 'match')
  })

  var deleted = []
  cf.on('delete', function(f) {
    deleted.push(f)
  })

  cf.on('complete', function(results) {
    t.same(deleted.sort(), deletedExpect, 'deleted the right files')

    var res = Object.keys(results).sort().reduce(function(set, f) {
      set[f] = results[f].md5 || results[f].status
      return set
    }, {})

    t.same(res, expect)
    t.end()
  })
})

test('dry-run test', function(t) {
  delete files['dir/b']
  delete files.b
  delete filesMd5['dir/b']
  delete filesMd5.b
  delete expectsum['dir/b']
  delete expectsum.b

  // delete a remote one so that we have a dry-run create as well.
  client.unlink(mpath + '/c', function(er, res) {
    if (er)
      throw er

    var cf = cuttlefish({
      delete: true,
      dryRun: true,
      files: files,
      client: client,
      request: function(file, cb) {
        throw new Error('Should not try to load any files: ' + file)
      },
      path: mpath
    })

    var expectMatch = [ 'd', 'e', 'f', 'dir/c', 'dir/d', 'dir/e', 'dir/f' ]
    var expectSent = [ 'c' ]
    var expectDeleted = [ 'b', 'dir/b' ]

    var deleted = []
    cf.on('delete', function(f) {
      deleted.push(f)
    })

    var sent = []
    cf.on('send', function(f) {
      sent.push(f.name)
    })

    var match = []
    cf.on('match', function(f) {
      match.push(f.name)
    })

    cf.on('complete', function(results) {
      t.same(deleted, expectDeleted)
      t.same(sent, expectSent)
      t.same(match, expectMatch)
      // make sure the deleted file is still there.
      client.info(mpath + '/' + deleted[0], function(er, info) {
        if (er)
          throw er
        t.ok(info)
        // make sure the sent file is still not there
        client.info(mpath + '/' + sent[0], function(er, info) {
          t.ok(er)
          t.equal(er.statusCode, 404)
          t.end()
        })
      })
    })
  })
})

test('fs only delete extra', function(t) {
  var deletedExpect = [ 'b', 'dir/b' ]

  var cf = cuttlefish({
    onlyDelete: true,
    files: files,
    path: mpath,
    client: client,
    headers: {
      'access-control-allow-methods': 'GET'
    },
    request: function(file, cb) {
      var f = path.resolve(__dirname, 'fixtures', file.name)
      cb(null, fs.createReadStream(f))
    }
  })

  var deleted = []
  cf.on('delete', function(f) {
    deleted.push(f)
  })

  cf.on('complete', function(results) {
    t.same(deleted.sort(), deletedExpect, 'deleted the right files')
    t.end()
  })
})

// make sure that we got the right headers
test('custom headers', function(t) {
  client.info(mpath + '/f', function(er, res) {
    if (er)
      throw er
    t.equal(res.headers['access-control-allow-origin'], '*')
    t.equal(res.headers['access-control-allow-methods'], 'GET')
    t.end()
  })
})

test('postclean', function(t) {
  client.rmr(mpath, function(er) {
    client.close()
    t.pass('cleaned')
    t.end()
  })
})
