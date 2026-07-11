import { UserRole } from './types';

export class PermissionManager {
    public static canTakeAction(role: UserRole, action: string): boolean {
        // Simple role-based access control logic
        const permissions: Record<UserRole, string[]> = {
            'Owner': ['mute', 'lock', 'kick', 'leave', 'invite', 'takeSeat', 'openMic', 'closeMic'],
            'Admin': ['mute', 'lock', 'kick', 'leave', 'takeSeat', 'openMic', 'closeMic'],
            'Moderator': ['mute', 'kick', 'takeSeat', 'openMic', 'closeMic'],
            'Speaker': ['leave', 'takeSeat', 'openMic', 'closeMic'],
            'Listener': ['takeSeat']
        };

        return permissions[role]?.includes(action) || false;
    }
}
