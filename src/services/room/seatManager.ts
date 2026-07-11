import { Seat } from './types';

export class SeatManager {
    public static takeSeat(seats: Seat[], seatId: number, userId: string): Seat[] {
        return seats.map(seat => 
            seat.id === seatId ? { ...seat, userId, mic: true } : seat
        );
    }

    public static leaveSeat(seats: Seat[], seatId: number): Seat[] {
        return seats.map(seat => 
            seat.id === seatId ? { ...seat, userId: null, mic: false } : seat
        );
    }

    public static toggleMic(seats: Seat[], seatId: number): Seat[] {
        return seats.map(seat => 
            seat.id === seatId ? { ...seat, mic: !seat.mic } : seat
        );
    }

    public static lockSeat(seats: Seat[], seatId: number): Seat[] {
        return seats.map(seat => 
            seat.id === seatId ? { ...seat, isLocked: !seat.isLocked } : seat
        );
    }
}
