# Trello-Folds-Server

Quick and dirty companion server for the excellent [Trello-Folds](https://github.com/NordMagnus/Trello-Folds) Chrome extension.

## Purpose

Two way sync between a custom field and position in list.

- Move a card by changing the 'Status' custom field on a card.
- Change the 'Status' custom field on a card by moving the card to a section.

## Configuration

### Trello

Setup a 'Status' custom field in Trello, with a list of options, i.e:

- Todo
- Progress
- Done

Segment your lists with the same values:

- \#\# Todo
- \#\# Progress
- \#\# Done

### Server

.env or environment variables:

- `PORT`: Listen to this port
- `BASE_URL`: URL where this server can be reached from external network
- `TRELLO_KEY`: Your Trello API key
- `TRELLO_TOKEN`: You Trello API token
- `TRELLO_BOARDS`: Comma separated list of Trello board IDs
- `TRELLO_FIELD`: Name of the Trello custom field list to sync with Trello-Folds sections
