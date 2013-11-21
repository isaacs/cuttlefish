var fs = require('fs')
var files = 'abcdefg'.split('')
var fix = __dirname + '/fixtures'

require('./zz-cleanup.js')

fs.mkdirSync(fix)
fs.mkdirSync(fix + '/dir')
files.forEach(function(f) {
  fs.writeFileSync(fix + '/' + f, f + '\n', 'ascii')
  fs.writeFileSync(fix + '/dir/' + f, f + '\n', 'ascii')
})

console.log('ok')
