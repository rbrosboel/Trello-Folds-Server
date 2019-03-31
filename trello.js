const nodeFetch = require('node-fetch')
const qs = require('querystring')

let options
let ignores

async function init(_options) {
    options = _options
    ignores = []

    await setupWebhooks()
}

async function fetch(endpoint, fetchOptions = {}) {
    const params = {
        key: options.trello.key,
        token: options.trello.token,
        ...fetchOptions.query
    }
    const uri = `https://api.trello.com/1/${endpoint}?${qs.encode(params)}`
    const res = await nodeFetch(uri, fetchOptions)

    if (!res.ok) {
        const message = await res.text()
        throw new Error(`Trello: ${message}`)
    }

    const json = await res.json()
    return json
}

function fetchBoard(idBoard) {
    return fetch(`boards/${idBoard}`, {
        query: {
            fields: 'id,name',
            cards: 'visible',
            card_fields: 'id,idList,name,pos',
            card_customFieldItems: true,
            lists: 'open',
            list_fields: 'id,name',
            members: 'all',
            member_fields: 'id,username,fullName',
            customFields: true,
        }
    })
}

async function setupWebhooks() {
    const callbackURL = `${options.baseUrl}/webhook`

    let webhooks = await fetch(`tokens/${options.trello.token}/webhooks`)

    // Delete unwanted webhooks
    webhooks = webhooks.filter(webhook => {
        const descriptionMatch = webhook.description === 'trello-notifications'
        const urlMatch = webhook.callbackURL === callbackURL
        const boardMatch = options.trello.boards.some(board => board === webhook.idModel)

        if (descriptionMatch && (!urlMatch || !boardMatch)) {
            console.log(`Board ${webhook.idModel}: Deleting webhook`)
            fetch(`webhooks/${webhook.id}`, {method: 'DELETE'})
            return false
        }
        return true
    })

    // Setup missing webhooks
    for (let idBoard of options.trello.boards) {
        if (webhooks.some(webhook => webhook.idModel === idBoard)) {
            console.log(`Board ${idBoard}: Webhook exists`)
        } else {
            let webhook = {
                description: 'trello-notifications',
                idModel: idBoard,
                callbackURL: callbackURL,
                active: true,
            }
            console.log(`Board ${webhook.idModel}: Creating webhook`)
            webhook = await fetch(`tokens/${options.trello.token}/webhooks`, {
                method: 'POST',
                query: webhook,
            })
            webhooks.push(webhook)
        }
    }

    // console.log(webhooks)
}

function updateCard(card, data) {
    return fetch(`cards/${card.id}`, {
        method: 'PUT',
        query: data
    })
}

function updateCardField(card, field, option) {
    return fetch(`card/${card.id}/customField/${field.id}/item`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            key: options.trello.key,
            token: options.trello.token,
            idValue: option ? option.id : '',
        })
    })
}

async function handleWebhook(event) {
    const {
        action,
    } = event
    const {
        type,
        data,
        display,
    } = action
    const {
        translationKey,
    } = display

    // console.log(`${type} / ${translationKey}`)

    // When cards move we will update value of custom field
    let updateStatus =
        type === 'createCard' ||
        (type === 'updateCard' && (data.old.pos || data.old.idList))

    // When custom field changes we will move card
    let updatePosition =
        type === 'updateCustomFieldItem' && data.customField.name === options.trello.field && data.customField.type === 'list'

    if (!updateStatus && !updatePosition) {
        return
    }

    // When updating or moving a card via Trello api, they send us a webhook reflecting the change. There's
    // no need to recheck for section/status sync in that case.
    let ignoreIndex = ignores.findIndex(i => 
        i.card === data.card.id && (i.updatePosition === !!updatePosition || i.updateStatus === !!updateStatus)
    )
    if (ignoreIndex !== -1) {
        ignores.splice(ignoreIndex, 1)
        return
    }
    

    // Make sure we act on updated data
    const board = await fetchBoard(data.board.id)
    const field = board.customFields.find(field => field.name === options.trello.field && field.type === 'list')
    const card = board.cards.find(card => card.id === data.card.id)
    const list = card && board.lists.find(list => list.id === card.idList)

    if (!board || !field || !card) {
        return
    }

    // Find the value of the custom field
    const cardFieldItem = card.customFieldItems.find(item => item.idCustomField === field.id)
    const cardFieldOption = cardFieldItem && field.options.find(option => option.id === cardFieldItem.idValue)
    const cardFieldValue = cardFieldOption && cardFieldOption.value.text.toLowerCase()

    // Current section
    const cards = board.cards.filter(listCard => listCard.idList === card.idList).sort((a,b) => a.pos - b.pos)
    let cardSection
    for (let c of cards) {
        if (c.pos > card.pos) {
            break
        }

        if (c.name.indexOf('##') === 0) {
            cardSection = c
        }
    }
    const cardSectionName = cardSection && cardSection.name.substring(2).trim().toLowerCase()
    const cardSectionFieldOption = cardSection && field && field.options.find(option => option.value.text.toLowerCase() === cardSectionName)

    // Update status
    if (updateStatus) {
        if (cardSectionFieldOption && (cardSectionFieldOption != cardFieldOption)) {
            // The card is in a section, but the card status does not match. Update the status
            console.log(`List '${list.name}': Card '${card.name}': Status changed to '${cardSectionName}'`)
            updateCardField(card, field, cardSectionFieldOption)
            ignores.push({updatePosition: true, card: card.id})
        } else if (!cardSectionFieldOption && cardFieldOption) {
            // The card is not in a section associated with a status. Clear the card status
            console.log(`List '${list.name}': Card '${card.name}': Status cleared`)
            updateCardField(card, field, null)
            ignores.push({updatePosition: true, card: card.id})
        }
    }

    // Update position
    if (updatePosition) {
        let cardFieldSection
        let cardFieldSectionFirst
        let cardFieldSectionLast
        let nextSection
        for (let card of cards) {
            let section = card.name.substring(0, 2) === '##' && card.name.substring(2).trim().toLowerCase()

            if (section) {
                if (section === cardFieldValue) {
                    cardFieldSection = card
                    continue
                }

                if (cardFieldSection) {
                    nextSection = card
                    break
                }
            }

            if (cardFieldSection) {
                if (!cardFieldSectionFirst) {
                    cardFieldSectionFirst = card
                }
                cardFieldSectionLast = card
            }
        }

        let top =
            cardFieldSectionFirst ? cardFieldSection.pos + ((cardFieldSectionFirst.pos - cardFieldSection.pos) / 2)
            : nextSection ? cardFieldSection.pos + ((nextSection.pos - cardFieldSection.pos) / 2)
            : cardFieldSection ? cardFieldSection.pos + 10000
            : undefined

        let bottom =
            cardFieldSectionLast && nextSection ? cardFieldSectionLast.pos + ((nextSection.pos - cardFieldSectionLast.pos) / 2)
            : nextSection ? cardFieldSection.pos + ((nextSection.pos - cardFieldSection.pos) / 2)
            : cardFieldSectionLast ? cardFieldSectionLast.pos + 10000
            : cardFieldSection ? cardFieldSection.pos + 10000
            : undefined

        const cardFieldSectionName = cardFieldSection && cardFieldSection.name.substring(2).trim().toLowerCase()
        const cardFieldSectionFieldOption = cardFieldSection && field && field.options.find(option => option.value.text.toLowerCase() === cardFieldSectionName)

        if (cardFieldSection && (cardFieldSection != cardSection)) {
            // There's a section for the status, but the card is not in it. Move the card
            console.log(`List '${list.name}': Card '${card.name}': Moved to section '${cardFieldSectionName}'`)
            updateCard(card, {pos: top})
            ignores.push({updateStatus: true, card: card.id})
        } else if (!cardFieldSection && cardSection && (cardFieldOption != cardSectionFieldOption)) {
            // There's no section for the status, but the card is in a section. Update card status to match the current section
            console.log(`List '${list.name}': Card '${card.name}': Status changed to '${cardSectionName}'`)
            updateCardField(card, field, cardSectionFieldOption)
            ignores.push({updatePosition: true, card: card.id})
        } else if (!cardFieldSection && !cardSection && cardFieldOption) {
            // There's no section for the status, and the card is not in a section. Clear the card status
            console.log(`List '${list.name}': Card '${card.name}': Status cleared`)
            updateCardField(card, field, null)
            ignores.push({updatePosition: true, card: card.id})
        }
    }
}

module.exports = {
    init,
    fetch,
    handleWebhook,
}
