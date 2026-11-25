export type CardFace = {
    name: string; image: string; manaCost: string; type: string; text: string;
    power: string; toughness: string; loyalty: string; defense: string; flavor: string; artist: string;
};
export type CardDetails = {
    name: string; url: string; manaValue: number; set: string; number: string;
    rarity: string; released: string; legalities: Record<string, string>; faces: CardFace[];
};
