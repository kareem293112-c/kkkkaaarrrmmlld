export interface Seat {
    id: number;
    userId: string | null;
    mic: boolean;
    isLocked: boolean;
}

export interface RoomState {
    roomId: string;
    hostId: string;
    seats: Seat[];
    listeners: number;
    locked: boolean;
}

export type UserRole = 'Owner' | 'Admin' | 'Moderator' | 'Speaker' | 'Listener';

export interface User {
    id: string;
    name: string;
    role: UserRole;
}
