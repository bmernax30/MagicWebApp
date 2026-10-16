/* eslint-disable @next/next/no-img-element */
import { assetUrl, type Commander } from '@/lib/types';

export function CommanderInfo({ commander }: { commander: Commander }) {
    const primary = commander.metadata;
    const cards = [
        { ...primary, name: primary.primary_name || commander.name },
        ...(primary.second_commander.enabled ? [primary.second_commander] : []),
    ];
    return <details className="commander-info">
        <summary>View commander info</summary>
        <div className="commander-info-content">
            <div className="commander-info-cards">
                {cards.map((card, index) => <figure key={index}>
                    {assetUrl(card.image_path) && <img loading="lazy" src={assetUrl(card.image_path)} alt={card.name || 'Partner commander'}/>}
                    <figcaption>
                        <h4>{card.name || 'Partner commander'}</h4>
                        <p>Power / toughness: {card.attack_power} / {card.defense_power}</p>
                        <p>Colors: {card.colors.join(', ') || 'Colorless'}</p>
                        <p>Mana cost: {Object.entries(card.color_cost).filter(([, amount]) => amount > 0).map(([color, amount]) => `${amount} ${color}`).join(', ') || 'Not specified'}</p>
                    </figcaption>
                </figure>)}
            </div>
            <h4>Rules text</h4>
            <p className="rules">{commander.rules || 'No rules text saved.'}</p>
            <p>Commander wins: {commander.wins}</p>
        </div>
    </details>;
}
