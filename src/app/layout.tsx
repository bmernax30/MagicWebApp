import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Magic Merna | The shared game table', description: 'A shared Magic game scoreboard and phone controls.' };
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) { return <html lang="en"><body>{children}</body></html>; }
