import { RoomState } from './types';

export class RoomStateManager {
    private state: RoomState;

    constructor(initialState: RoomState) {
        this.state = initialState;
    }

    public getState(): RoomState {
        return this.state;
    }

    public updateState(newState: Partial<RoomState>) {
        this.state = { ...this.state, ...newState };
    }
}
