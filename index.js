require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const pretty = require('express-prettify')
const trello = require('./trello')

const options = {
    baseUrl: process.env.BASE_URL,
    port: process.env.PORT,
    trello: {
        key: process.env.TRELLO_KEY,
        token: process.env.TRELLO_TOKEN,
        boards: process.env.TRELLO_BOARDS.split(','),
        field: process.env.TRELLO_FIELD,
    }
}

const app = express()
app.use(bodyParser.json())
app.use(pretty({query: 'pretty'}))

app.get('/', (req, res) => res.send(`
    <h1>Trello Bot</h1>
    <p>
    Use 'pretty' uri parameter to output prettified json
    </p>
    <p><b>GET /</b><br>Help</p>
    <p><b>GET /boards</b><br>List available boards</p>
    <p><b>POST /webhook</b><br>Incoming Trello webhooks</p>
`))

app.get('/boards', async (req, res) => {
    const json = await trello.fetch('members/me/boards', {
        query: {
            fields: 'id,name'
        }
    })
    res.json(json)
})

app.head('/webhook', (req, res) => res.send())
app.post('/webhook', (req, res) => {
    res.send()
    trello.handleWebhook(req.body)
})

app.listen(options.port, () => console.log(`Listening on ${options.port}`))

trello.init(options)
