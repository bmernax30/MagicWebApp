import { GameTable } from '@/components/game-table';
export default async function GamePage({ params }: {
    params: Promise<{
        code: string;
    }>;
}) { return <GameTable code={(await params).code.toUpperCase()}/>; }
