export function commanderDeckId(names: string[]) {
    return JSON.stringify(names.map(n => n.trim().normalize('NFC').toLocaleLowerCase('en-US')).sort());
}

export function scryfallSetupId(cards: import('./card-search').CardDetails[]) {
    return JSON.stringify(cards.map(c=>c.oracleId?'oracle:'+c.oracleId.toLowerCase():c.name.trim().normalize('NFC').toLocaleLowerCase('en-US')).sort());
}
