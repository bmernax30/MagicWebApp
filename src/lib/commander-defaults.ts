import type { CommanderMetadata } from './types';
const mana = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
export function completeCommanderMetadata(value: Partial<CommanderMetadata>): CommanderMetadata {
    return {
        primary_name: '', image_path: '', attack_power: 0, defense_power: 0, colors: [],
        ...value, color_cost: { ...mana, ...value.color_cost },
        second_commander: {
            enabled: false, name: '', image_path: '', attack_power: 0, defense_power: 0, colors: [],
            ...value.second_commander, color_cost: { ...mana, ...value.second_commander?.color_cost },
        },
    };
}
