var fs = require('fs')
var files = 'abcdefg'.split('')
var fix = __dirname + '/fixtures'

files.forEach(function(f) {
  try { fs.unlinkSync(fix + '/dir/' + f) } catch (e) {}
  try { fs.unlinkSync(fix + '/' + f) } catch (e) {}
})

try { fs.rmdirSync(fix + '/dir') } catch (e) {}
try { fs.rmdirSync(fix) } catch (e) {}

if (require.main === module)
  console.log('ok')
