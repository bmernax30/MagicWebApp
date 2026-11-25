// Explicitly approved corrections from MAGIC-004; never fuzzy-match historic stats.
const corrections:Record<string,string>={
    "Caeser, Legion's Emperor":"Caesar, Legion's Emperor",
    'Killian, Devisive Mentor':'Killian, Decisive Mentor',
    'Niki, Light of Hope':'Niko, Light of Hope',
    'Phelia, Exuberant Shephard':'Phelia, Exuberant Shepherd',
};
export const legacyPlaceholders=['Ben New Commander','New Commander','Strobel new commander.'];
export const canonicalLegacyName=(name:string)=>corrections[name]??name;
export const isLegacyPlaceholder=(name:string)=>legacyPlaceholders.includes(name);
