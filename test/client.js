var manta = require('manta')

if (!process.env.MANTA_KEY_ID ||
    !process.env.MANTA_USER ||
    !process.env.MANTA_URL) {
  console.error('not ok - need manta environs')
  process.exit(1)
}

if (!process.env.SSH_AUTH_SOCK) {
  console.error('not ok - only ssh-agent authentication is supported')
  process.exit(1)
}

module.exports = manta.createClient({
  sign: manta.sshAgentSigner({
    keyId: process.env.MANTA_KEY_ID,
    user: process.env.MANTA_USER
  }),
  user: process.env.MANTA_USER,
  url: process.env.MANTA_URL
})
