require("dotenv").config();
const express = require('express')
const app = express()
const port = process.env.PORT || 4000

app.get('/', (req, res) => {
  res.send('OK')
})

app.listen(port, "0.0.0.0", () => {
  console.log(`Example app listening on port ${port}`)
})

require("./Discord/bot.js")